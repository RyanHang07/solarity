import { describe, expect, it } from "vitest"
import { parseCspReport as parse } from "./csp-report"

/**
 * Step 12c. The two body shapes a browser can POST.
 *
 * **Real bodies, copied from the spec rather than invented**, because the whole
 * risk here is field names: `report-uri` sends `"blocked-uri"`, the Reporting
 * API sends `blockedURL`, and a parser that handles one logs `undefined` for
 * every field of the other. That failure produces log lines, not errors, so
 * nothing about it looks broken.
 */

const REPORT_URI_BODY = JSON.stringify({
  "csp-report": {
    "document-uri": "https://solarity.app/dashboard",
    referrer: "",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "script-src 'self'",
    disposition: "enforce",
    "blocked-uri": "inline",
    "line-number": 42,
    "script-sample": "console.log('hi')",
    "status-code": 200,
  },
})

const REPORT_TO_BODY = JSON.stringify([
  {
    age: 0,
    type: "csp-violation",
    url: "https://solarity.app/dashboard",
    body: {
      documentURL: "https://solarity.app/dashboard",
      effectiveDirective: "script-src-elem",
      blockedURL: "inline",
      lineNumber: 42,
      sample: "console.log('hi')",
      disposition: "enforce",
    },
  },
])

describe("parse", () => {
  it("reads a report-uri body", () => {
    expect(parse(REPORT_URI_BODY)).toEqual([
      {
        directive: "script-src-elem",
        blocked: "inline",
        document: "https://solarity.app/dashboard",
        line: 42,
        sample: "console.log('hi')",
      },
    ])
  })

  it("reads a Reporting API body into the same shape", () => {
    expect(parse(REPORT_TO_BODY)).toEqual(parse(REPORT_URI_BODY))
  })

  it("ignores non-CSP reports in a Reporting API batch", () => {
    // The same endpoint could receive deprecation or intervention reports if
    // another group is ever pointed at it. Logging those as CSP violations
    // would send someone hunting a policy bug that does not exist.
    const mixed = JSON.stringify([
      { type: "deprecation", body: { id: "SomeApi" } },
      JSON.parse(REPORT_TO_BODY)[0],
    ])
    expect(parse(mixed)).toHaveLength(1)
  })

  it("truncates a long sample", () => {
    const long = JSON.stringify({
      "csp-report": { "script-sample": "x".repeat(500) },
    })
    expect(parse(long)[0].sample).toHaveLength(120)
  })

  it("returns nothing rather than throwing on hostile input", () => {
    // Unauthenticated, attacker-controlled, at a URL published in every
    // response header. Each of these must be a quiet empty list.
    for (const raw of [
      "",
      "not json",
      "null",
      "[]",
      "{}",
      "[1,2,3]",
      '{"csp-report":"a string"}',
      '{"csp-report":null}',
      '[{"body":null}]',
      '{"csp-report":{"line-number":"forty-two"}}',
    ]) {
      expect(() => parse(raw), raw).not.toThrow()
    }

    // And the one that parses but carries a wrong-typed field still yields a
    // record, with that field simply absent.
    expect(parse('{"csp-report":{"line-number":"forty-two"}}')).toEqual([
      { directive: undefined, blocked: undefined, document: undefined, line: undefined, sample: undefined },
    ])
  })
})
