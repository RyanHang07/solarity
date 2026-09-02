import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import type { Database } from "@/lib/database.types"
import {
  CSP_REPORT_PATH,
  contentSecurityPolicy,
  reportingEndpoints,
} from "@/lib/security-headers"

/**
 * Refreshes the auth session, applies the CSP, and redirects anonymous
 * requests. Called from `proxy.ts`. See architecture/app.md section 2b.
 *
 * `response` must be the object that gets returned — building a fresh
 * NextResponse instead would discard the refreshed cookies and log people out
 * at random.
 *
 * **The nonce (step 12) has the same hazard, one layer down.** Next reads it
 * from the *request* headers it receives, not from anything we return, and
 * stamps it onto the inline `<script>` tags it streams for the RSC payload.
 * Those tags exist on every page, so a nonce that fails to reach the request is
 * not a partial failure: the browser blocks Next's own bootstrap and the app
 * does not hydrate. Nothing errors on the server. You find out by loading a
 * page.
 *
 * Which is why every `NextResponse.next()` below goes through `nextWithNonce`
 * rather than being written out by hand. The cookie callback rebuilds the
 * response, and a rebuild that forgot the header would silently drop it.
 */
export async function updateSession(request: NextRequest) {
  // 16 random bytes, base64. Fresh per request: a reused nonce is worth no more
  // than 'unsafe-inline', since whoever can read one page can read the value.
  //
  // `getRandomValues` and `btoa`, not `Buffer` — this runs on the Edge runtime,
  // where the Web Crypto globals are the ones guaranteed to be there.
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const nonce = btoa(String.fromCharCode(...bytes))
  const csp = contentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV !== "production",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    // **The connection, not the build.** `upgrade-insecure-requests` hangs on
    // this, and sending it over http breaks every subresource without raising a
    // violation. `x-forwarded-proto` first, because behind Vercel the proxy
    // terminates TLS and the request reaching this code is plain http.
    //
    // The two sources spell it differently — the header says `https`, the URL
    // says `https:` — so both are trimmed rather than compared as they come.
    secure: (
      request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol
    )
      .split(",")[0]
      .trim()
      .replace(/:$/, "") === "https",
  })

  /**
   * A `NextResponse.next()` that always carries the nonce forward.
   *
   * **Rebuilt from `request.headers` each time rather than closed over once.**
   * `request.cookies.set` writes through to the request's `cookie` header, so a
   * headers object captured before the refresh would pin the *stale* cookie and
   * hand the page a session that was just replaced. Copy late; re-add the two
   * synthetic headers every time.
   */
  const nextWithNonce = () => {
    const headers = new Headers(request.headers)
    // Read by the root layout, for our one inline script.
    headers.set("x-nonce", nonce)
    // Read by Next itself. It parses this off the request and applies the nonce
    // to the script tags it generates.
    headers.set("Content-Security-Policy", csp)
    return NextResponse.next({ request: { headers } })
  }

  /**
   * **The report endpoint never reaches the session refresh.**
   *
   * `updateSession` calls `getUser()` unconditionally, which is one Supabase
   * auth request per pass. A page whose CSP is wrong emits a report per blocked
   * resource per load, so leaving reports on this path would let a policy
   * mistake spend the project's **auth** rate limit — the budget documented in
   * `testing.md` that cannot be cleared and whose exhaustion signs people out
   * several requests later. A reporting endpoint must not be able to break the
   * thing it is reporting on.
   *
   * It needs no policy of its own either: the response is an empty 204 that
   * renders nothing.
   */
  if (request.nextUrl.pathname === CSP_REPORT_PATH) return NextResponse.next()

  let response = nextWithNonce()

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = nextWithNonce()
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getUser, not getSession: getSession reads the cookie without verifying it.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))

  if (!user && !isPublic) {
    // Path *and* query. `sw.js` deep-links to `/circles/<id>?tab=overview`, so
    // sending only the path silently drops people on the wrong tab of the right
    // page after signing in. `safeRedirect` already permits a query string; it
    // rejects on the leading characters, which a search string cannot change.
    const url = request.nextUrl.clone()
    url.pathname = "/auth/sign-in"
    url.search = ""
    url.searchParams.set("next", path + request.nextUrl.search)
    // A redirect carries no body and so needs no policy of its own, but it is
    // still a response from this origin and gets one for consistency: a header
    // present on some responses and absent on others is the kind of gap that
    // takes an hour to notice.
    return withPolicy(NextResponse.redirect(url), csp)
  }

  return withPolicy(response, csp)
}

/**
 * Everything reachable without signing in. **Deny by default**: this enumerates
 * what is *public*, so a route nobody thought about fails closed as a redirect
 * rather than open as a leak.
 *
 * Matched as a whole path or a path segment — `startsWith(p)` alone would make
 * `/termsomething` public because `/terms` is.
 *
 * | | |
 * |---|---|
 * | `/` | The landing page, which also carries the notice a dead invite link produces |
 * | `/auth` | Sign-in, the OAuth callback, and the error screen |
 * | `/join` | An invite has to *preview* before sign-in, or the link is useless to someone who has never heard of Solarity |
 * | `/privacy`, `/terms` | **Google's OAuth consent screen will not publish without a reachable privacy URL.** A page behind a redirect does not qualify |
 * | `/robots.txt`, `/sitemap.xml` | A crawler is by definition signed out. Both were missing and both were being redirected to sign-in |
 * | `/_next` | Framework assets |
 *
 * `/api/csp-report` is deliberately absent: it returns above and never reaches
 * this check. Were that early return removed it would have to be added here,
 * because browsers POST violation reports with no credentials and the redirect
 * would discard every one of them while the endpoint looked healthy.
 *
 * **On the two that were missing.** `app/robots.ts` and `app/sitemap.ts` shipped
 * with the public surface, and the proxy's matcher excludes `sw.js`, the
 * manifest and image extensions but not `.txt` or `.xml` — so every request for
 * either got a 307 to `/auth/sign-in?next=/robots.txt`. The file was written,
 * served by a route that worked, and unreachable by the only clients that exist
 * for it.
 *
 * **The sitemap test did not catch it, and that is the sharper lesson.** It
 * asserts the response contains `/privacy` and `/terms` and does not contain
 * `/join` — and all three are true of the **sign-in page**, because
 * `legal-footer.tsx` puts a Privacy and a Terms link on it. Three assertions,
 * every one of them passing, against a document that was not a sitemap. A test
 * that checks for content without ever checking the *kind* of document it got
 * can be satisfied by the redirect it was meant to detect.
 */
const PUBLIC_PREFIXES = [
  "/",
  "/auth",
  "/join",
  "/privacy",
  "/terms",
  // Step 20d. Reachable signed out, because half of what it explains — how to
  // delete an account, what a photo's retention is — is what somebody wants to
  // read *before* signing up, and the other half is what somebody who cannot
  // sign in needs.
  "/support",
  "/robots.txt",
  "/sitemap.xml",
  "/_next",
]

/**
 * Stamps the enforcing policy onto a response.
 *
 * Separate from the request-side header above, and both are needed: the request
 * copy is what Next reads to nonce its own scripts, the response copy is what
 * the browser actually enforces. Setting only the first protects nothing;
 * setting only the second blocks Next's bootstrap.
 */
function withPolicy(response: NextResponse, csp: string): NextResponse {
  response.headers.set("Content-Security-Policy", csp)
  response.headers.set("Reporting-Endpoints", reportingEndpoints())
  return response
}
