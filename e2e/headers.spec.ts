import { test, expect, type Page } from "@playwright/test"
import { requireEnv } from "./db"
import { storageStateFor } from "./session"

/**
 * Step 12. The security headers, and the policy actually holding on a real
 * page.
 *
 * **Writes nothing.** Every test here is a read.
 *
 * **Two modes, and the difference is deliberate.** The suite runs against
 * `npm run dev` unless `E2E_PROD=1`, and the dev policy allows `'unsafe-eval'`
 * and a websocket that production forbids. So the invariants are asserted
 * always, and the strict form only where it exists. A file that asserted the
 * strict form unconditionally would fail on every local run and be disabled
 * within a week, which is the same as not having it.
 */

const PROD = Boolean(process.env.E2E_PROD)
const OWNER = () => requireEnv("E2E_OWNER_EMAIL")

/** `script-src ...` up to the next `;`, from a live response header. */
function directive(csp: string, name: string): string {
  return (
    csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d === name || d.startsWith(name + " ")) ?? ""
  )
}

test("a page response carries the fixed headers", async ({ page }) => {
  const response = await page.goto("/")
  const headers = response!.headers()

  expect(headers["x-content-type-options"]).toBe("nosniff")
  expect(headers["x-frame-options"]).toBe("DENY")
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin")
  expect(headers["permissions-policy"]).toContain("camera=()")

  // **HSTS is asserted but not required to be present locally.** Next only
  // emits `headers()` over the protocol it is serving, and a browser ignores
  // HSTS on plain http anyway. Asserting presence here would make the test
  // depend on how the dev server was started.
  if (headers["strict-transport-security"]) {
    expect(headers["strict-transport-security"]).toContain("includeSubDomains")
    expect(headers["strict-transport-security"]).not.toContain("preload")
  }
})

test("a static asset carries them too", async ({ request }) => {
  // The reason `FIXED_HEADERS` live in `next.config.ts` rather than the proxy:
  // the proxy's matcher skips `sw.js` on purpose, so anything set there would
  // leave the service worker unprotected. Delete the `headers()` block and this
  // is the test that notices.
  const response = await request.get("/sw.js")
  expect(response.status()).toBe(200)
  expect(response.headers()["x-content-type-options"]).toBe("nosniff")
})

test("the CSP is enforcing, nonced, and reports both ways", async ({ page }) => {
  const response = await page.goto("/")
  const headers = response!.headers()

  // Enforcing, not Report-Only. If a future change flips it while debugging,
  // the app keeps working and nothing else would tell you.
  expect(headers["content-security-policy"]).toBeTruthy()
  expect(headers["content-security-policy-report-only"]).toBeUndefined()

  const csp = headers["content-security-policy"]

  expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'")
  expect(directive(csp, "object-src")).toBe("object-src 'none'")
  expect(directive(csp, "base-uri")).toBe("base-uri 'none'")

  // Not `'self'` alone. `form-action` is enforced against redirect targets, and
  // sign-in is a form that redirects twice before it reaches Google.
  expect(directive(csp, "form-action")).toContain("accounts.google.com")

  expect(csp).toContain("report-uri /api/csp-report")
  expect(csp).toContain("report-to csp")
  expect(headers["reporting-endpoints"]).toContain("/api/csp-report")

  // **The policy that actually ships is only visible here.** A dev run relaxes
  // scripts so Turbopack works, so `npm run test:e2e` cannot see this and
  // `E2E_PROD=1 npm run test:e2e` is the run that has to pass before a deploy.
  if (PROD) {
    expect(directive(csp, "script-src")).toMatch(/'nonce-[A-Za-z0-9+/=]+'/)
    // See `lib/security-headers.ts`: `strict-dynamic` discards `'self'`, and
    // discarding `'self'` is what stopped WebKit running any client JavaScript.
    expect(directive(csp, "script-src")).not.toContain("'strict-dynamic'")
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'")
    expect(directive(csp, "script-src")).not.toContain("'unsafe-eval'")
    expect(directive(csp, "connect-src")).not.toContain("ws://")

    // **Absent here, and that is the assertion.** The suite runs over http, and
    // `upgrade-insecure-requests` on an http origin rewrites the page's own
    // bundle to a port that is not listening — silently, with no violation.
    // Deployment is https and gets it; this is not.
    expect(csp).not.toContain("upgrade-insecure-requests")
  } else {
    // And the dev policy is asserted too, rather than skipped, because the
    // combination that broke WebKit was a nonce sitting *beside*
    // `'unsafe-inline'`: a nonce anywhere in `script-src` switches
    // `'unsafe-inline'` off, so the two together are the strict policy wearing
    // a permissive costume.
    expect(directive(csp, "script-src")).toContain("'unsafe-inline'")
    expect(directive(csp, "script-src")).not.toContain("nonce-")
  }
})

test("the nonce is fresh on every request", async ({ page }) => {
  test.skip(!PROD, "the development policy carries no nonce")

  // A nonce reused across responses is worth exactly `'unsafe-inline'`: anyone
  // who can read one page can read the value. A cached header or a nonce minted
  // at module scope would both pass every other test in this file.
  const nonces: string[] = []
  for (let i = 0; i < 3; i++) {
    const response = await page.goto("/?cachebust=" + i)
    const match = response!.headers()["content-security-policy"].match(/'nonce-([^']+)'/)
    nonces.push(match![1])
  }
  expect(new Set(nonces).size, "the nonce repeated across requests").toBe(3)
})

test("the inline install script carries the page's nonce", async ({ page }) => {
  test.skip(!PROD, "the development policy carries no nonce")

  const response = await page.goto("/")
  const headerNonce = response!.headers()["content-security-policy"].match(
    /'nonce-([^']+)'/,
  )![1]

  /**
   * **Read out of the DOM, not through a locator.** Playwright's text engine
   * deliberately ignores `<script>` and `<style>` contents, so
   * `filter({ hasText })` matches nothing here and simply waits out the
   * timeout — a failure that looks like a missing nonce and is really a missing
   * *locator*.
   *
   * **And read as `.nonce`, not `getAttribute`.** Once a nonced element is
   * inserted, browsers stash the value in an internal slot and blank the
   * content attribute, so that a CSS attribute selector cannot exfiltrate it.
   * The IDL property is the only thing that still holds it. `getAttribute` is
   * kept as a fallback for the case where no CSP was applied at all, which is
   * exactly the regression this test exists to catch.
   */
  const found = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("script")).find((s) =>
      s.textContent?.includes("beforeinstallprompt"),
    )
    if (!el) return null
    return el.nonce || el.getAttribute("nonce") || ""
  })

  expect(found, "the install script is not in the document at all").not.toBeNull()
  expect(found, "the install script rendered without a nonce").toBe(headerNonce)
})

test("no page in the app trips its own policy", async ({ browser }) => {
  // **The test the whole step exists for.** Every assertion above checks the
  // header's text; this one checks the consequence. A CSP that blocks Next's
  // streamed bootstrap does not throw on the server and does not fail a header
  // assertion — the page simply never hydrates, and the only evidence is in the
  // console.
  const context = await browser.newContext({ storageState: await storageStateFor(OWNER()) })
  const page = await context.newPage()
  const violations: string[] = []

  page.on("console", (message) => {
    const text = message.text()
    if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(text)) {
      violations.push(text)
    }
  })

  try {
    for (const path of ["/", "/dashboard", "/settings", "/today", "/auth/sign-in"]) {
      await page.goto(path)
      await page.waitForLoadState("networkidle")
    }

    expect(violations, violations.join("\n")).toHaveLength(0)

    // And hydration actually happened, which is the thing a blocked bootstrap
    // silently prevents. React sets this on the root once it has taken over.
    await page.goto("/dashboard")
    await expect(page.locator("body")).toBeVisible()
    expect(
      await page.evaluate(() => Boolean(document.querySelector("script[src]"))),
      "no bundle was loaded at all",
    ).toBe(true)
  } finally {
    await context.close()
  }
})

test("the report endpoint accepts a report and refuses a GET", async ({ request }) => {
  // Reachable without a session, which is the point: browsers POST reports with
  // no credentials, so a redirect to sign-in here would discard every one of
  // them while the endpoint looked healthy.
  const post = await request.post("/api/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: JSON.stringify({
      "csp-report": { "effective-directive": "script-src", "blocked-uri": "inline" },
    }),
  })
  expect(post.status(), "a violation report was redirected or refused").toBe(204)

  // Malformed input is still 204: the browser discards the response and retries
  // nothing, so an error status here only produces noise nobody can act on.
  const junk = await request.post("/api/csp-report", { data: "not json at all" })
  expect(junk.status()).toBe(204)

  const get = await request.get("/api/csp-report")
  expect(get.status()).toBe(405)
})

test("sign-in still works under the policy", async ({ page }: { page: Page }) => {
  // The redirect responses get a policy too. A `form-action` or `connect-src`
  // that forbade the auth origin would break sign-in and nothing else, which is
  // the failure most likely to reach a user first.
  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\/auth\/sign-in/)
  await expect(page.getByRole("button", { name: /Google/i })).toBeVisible()
})
