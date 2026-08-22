import { NextResponse, type NextRequest } from "next/server"
import { RateLimitError, enforce } from "@/lib/ratelimit"
import { clientIp } from "@/lib/request-identity"
import { parseCspReport } from "@/lib/csp-report"

/**
 * Step 12c. Where CSP violations land.
 *
 * **Logging only.** Nothing is written to Postgres or Redis beyond the rate
 * limiter's own counter. The body arrives from the browser, unauthenticated, at
 * a URL an attacker can read straight out of the policy header, so it is
 * untrusted input in the strictest sense — and the cheapest way to keep it from
 * becoming a storage or injection problem is to give it nowhere to go.
 *
 * **Always answers 204, whatever happens.** The browser is not listening: it
 * discards the response and retries nothing. A 500 here would show up as noise
 * in whatever monitors the deployment, blamed on a route that by design cannot
 * affect a user. Every failure below is therefore swallowed on purpose, and the
 * cost of each is a report that goes unlogged.
 *
 * **Two body shapes, because there are two spellings of the header.** `report-
 * to` POSTs `application/reports+json`, an *array* of `{ type, body }`.
 * `report-uri` POSTs `application/csp-report`, a single
 * `{ "csp-report": {...} }`. `lib/security-headers.ts` sends both, because
 * Safari reads only the second, so this has to read both too.
 */

// Node, not Edge: `@upstash/ratelimit` and this route's logging both behave
// predictably there, and nothing here is latency-sensitive.
export const runtime = "nodejs"

// A report is a few hundred bytes. Anything past this is not a browser.
const MAX_BODY = 64 * 1024

export async function POST(request: NextRequest) {
  try {
    // **Read the body before the limiter**, so an oversized POST is refused on
    // a length check rather than after a Redis round trip.
    const raw = await request.text()
    if (raw.length === 0 || raw.length > MAX_BODY) return noContent()

    /**
     * **A refusal stops the logging; a broken limiter must not.**
     *
     * Refusal is silent by design: on localhost there is no
     * `x-forwarded-for`, so every request shares one bucket — the trap
     * documented in `lib/ratelimit.ts` — and a noisy run must not start failing
     * requests, only stop logging.
     *
     * But `Redis.fromEnv()` throws when the Upstash variables are absent, and
     * catching that the same way would mean an environment with no Upstash
     * config silently discards **every** report while the endpoint answers 204
     * and looks healthy. That is the exact failure this endpoint exists to
     * prevent, reproduced inside it. So only a real `RateLimitError` stops the
     * log; anything else falls through and the report is still written.
     */
    try {
      await enforce("cspReport", await clientIp())
    } catch (err) {
      if (err instanceof RateLimitError) return noContent()
    }

    for (const violation of parseCspReport(raw)) {
      // `console.warn`, not `error`: a blocked resource is a policy question,
      // not a crash, and routing it to the error channel would train everyone
      // to ignore that channel. Structured so a log search can group by
      // directive without parsing prose.
      console.warn("[csp]", violation)
    }
  } catch {
    // Malformed JSON, a stream that ends early, a missing Upstash variable at
    // module load. None of them are the browser's problem.
  }

  return noContent()
}

/**
 * Everything else, refused.
 *
 * A GET here would otherwise render Next's 405 page, which is a real page with
 * a real CSP, at a URL published in every response header. Cheaper to answer
 * nothing.
 */
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } })
}

function noContent() {
  return new NextResponse(null, { status: 204 })
}
