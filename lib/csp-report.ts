/**
 * Step 12c. Reading a CSP violation report.
 *
 * **In `lib/` rather than beside the route** so that a test can import it
 * without dragging `next/server` and the rate limiter into a jsdom runner. The
 * route is then thin enough to read in one screen, which is the part that has
 * to stay obviously correct.
 */

/** What gets logged. One shape, whichever spelling produced it. */
export type CspViolation = {
  directive?: string
  blocked?: string
  document?: string
  line?: number
  sample?: string
}

/**
 * Normalises either body shape into a list.
 *
 * **The two spellings do not share field names**, which is the part that is
 * easy to get wrong and impossible to notice: `report-uri` sends
 * `"blocked-uri"`, the Reporting API sends `blockedURL`, and a parser that
 * knows only one produces a log line of `undefined` for every field rather than
 * an error. Both are read here, and `lib/csp-report.test.ts` feeds a real body
 * of each.
 *
 * Defensive at every step and deliberately non-throwing: this parses
 * attacker-controlled JSON from an unauthenticated endpoint whose URL is
 * published in every response header. The only correct response to a shape it
 * does not recognise is to log nothing.
 */
export function parseCspReport(raw: string): CspViolation[] {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return []
  }

  // `report-to`: an array of reports, of which only the CSP ones matter.
  if (Array.isArray(body)) {
    return body
      .filter(isRecord)
      .filter((r) => r.type === undefined || r.type === "csp-violation")
      .map((r) => r.body)
      .filter(isRecord)
      .map(normalise)
  }

  // `report-uri`: one report, wrapped.
  if (isRecord(body) && isRecord(body["csp-report"])) {
    return [normalise(body["csp-report"])]
  }

  return []
}

function normalise(v: Record<string, unknown>): CspViolation {
  return {
    directive: str(
      v["effective-directive"] ?? v.effectiveDirective ?? v["violated-directive"],
    ),
    blocked: str(v["blocked-uri"] ?? v.blockedURL),
    document: str(v["document-uri"] ?? v.documentURL),
    line: num(v["line-number"] ?? v.lineNumber),
    // The first 120 characters of the offending inline source. Enough to
    // recognise a script; short enough not to paste a page into a log.
    sample: str(v["script-sample"] ?? v.sample)?.slice(0, 120),
  }
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
