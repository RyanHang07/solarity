import { describe, expect, it } from "vitest"
import {
  CSP_REPORT_PATH,
  FIXED_HEADERS,
  contentSecurityPolicy,
  reportingEndpoints,
} from "./security-headers"

const SUPABASE = "https://abcdefgh.supabase.co"

function policy(overrides: Partial<Parameters<typeof contentSecurityPolicy>[0]> = {}) {
  return contentSecurityPolicy({
    nonce: "TESTNONCE",
    dev: false,
    supabaseUrl: SUPABASE,
    secure: true,
    ...overrides,
  })
}

/** `script-src ...` up to the next `;`. */
function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(name + " "))
}

describe("contentSecurityPolicy", () => {
  it("nonces scripts in production and does not fall back to unsafe-inline", () => {
    const script = directive(policy(), "script-src")!
    expect(script).toContain("'nonce-TESTNONCE'")

    // **`'self'` is kept and `'strict-dynamic'` is not**, because
    // `strict-dynamic` discards `'self'` and then requires Next to nonce every
    // `<script src>` in the initial HTML. Under a production build WebKit ran
    // no client JavaScript at all when it did. This app serves no third-party
    // scripts, no CDN, and no user content on its own origin, so `'self'`
    // admits exactly the scripts the build produced.
    expect(script).toContain("'self'")
    expect(script).not.toContain("'strict-dynamic'")

    // The failure this guards is subtle: adding `'unsafe-inline'` beside a
    // nonce does not error, it just means browsers that honour the nonce ignore
    // it and older ones allow everything. The policy would look strict and
    // enforce nothing.
    expect(script).not.toContain("'unsafe-inline'")
  })

  it("keeps the nonce out of the development policy entirely", () => {
    const devScript = directive(policy({ dev: true }), "script-src")!
    expect(devScript).toContain("'unsafe-eval'")
    expect(devScript).toContain("'unsafe-inline'")
    expect(devScript).not.toContain("'strict-dynamic'")

    // **The assertion this file exists for.** A nonce anywhere in `script-src`
    // switches `'unsafe-inline'` off, so listing both does not widen the policy
    // — it narrows it to the strict one and blocks every un-nonced script
    // Turbopack injects. Chromium tolerated the combination; WebKit ran no
    // client JavaScript at all and reported it as four tests missing text.
    expect(devScript).not.toContain("nonce-")

    const prodScript = directive(policy(), "script-src")!
    expect(prodScript).not.toContain("'unsafe-eval'")
    expect(prodScript).not.toContain("'unsafe-inline'")
  })

  it("allows the dev websocket only in development", () => {
    expect(directive(policy({ dev: true }), "connect-src")).toContain("ws://localhost:*")
    expect(directive(policy(), "connect-src")).not.toContain("ws://")
  })

  it("reaches Supabase over both https and wss", () => {
    const connect = directive(policy(), "connect-src")!
    expect(connect).toContain(SUPABASE)
    expect(connect).toContain("wss://abcdefgh.supabase.co")
  })

  it("keeps a trailing path out of the Supabase source", () => {
    // A source with a path is a **prefix match**, so `.../rest/v1` here would
    // silently forbid `/auth/v1` and sign-in would fail with a console error
    // nobody would trace back to an environment variable.
    const connect = directive(
      policy({ supabaseUrl: "https://abcdefgh.supabase.co/rest/v1/" }),
      "connect-src",
    )!
    expect(connect).toContain("https://abcdefgh.supabase.co ")
    expect(connect).not.toContain("/rest/v1")
  })

  it("survives an unparseable Supabase URL rather than throwing", () => {
    // This runs inside the proxy. A throw there is not a broken header, it is
    // every route returning 500.
    expect(() => policy({ supabaseUrl: "" })).not.toThrow()
    expect(() => policy({ supabaseUrl: "not a url" })).not.toThrow()
  })

  it("forbids framing, plugins, base tags and foreign form posts", () => {
    const csp = policy()
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'")
    expect(directive(csp, "object-src")).toBe("object-src 'none'")
    expect(directive(csp, "base-uri")).toBe("base-uri 'none'")

    /**
     * **`frame-src` was `'none'` until step 20h and is now one origin.**
     *
     * That is a real widening and this assertion is what makes it a *decision*
     * rather than a drift: the Turnstile challenge renders in an iframe, so the
     * host has to be named, and naming it here means the next person to add a
     * second origin has to change a test that says why.
     *
     * The guarantee this test was making is unchanged in the direction that
     * matters — **nothing may frame us**, which is `frame-ancestors` above.
     * `frame-src` governs what *we* may embed, and the answer is: one hosted
     * challenge, and nothing else. Asserted exactly in the `Turnstile` block
     * below, including that `'self'` is still absent.
     */
    expect(directive(csp, "frame-src")).toBe(
      "frame-src https://challenges.cloudflare.com",
    )
  })

  it("permits the whole sign-in redirect chain in form-action", () => {
    /**
     * **`form-action` is checked at every redirect hop**, not just the initial
     * POST, and Chrome enforces that where Safari and Firefox do not.
     *
     * `<form action={signInWithGoogle}>` is a server action ending in
     * `redirect()` to Supabase's `/auth/v1/authorize`, which redirects again to
     * Google. Hydrated, React submits by `fetch` and the router follows the
     * redirect, so none of this applies. The exposure is a **click before
     * hydration** on the first page a signed-out visitor sees — a native form
     * POST that Chrome would refuse, with a CSP violation and no explanation.
     */
    const form = directive(policy(), "form-action")!
    expect(form).toContain("'self'")
    expect(form).toContain(SUPABASE)
    expect(form).toContain("https://accounts.google.com")
  })

  it("does not let Google leak into any directive but form-action", () => {
    // The app never talks to Google. It hands the browser to Supabase, which
    // hands it to Google. A `connect-src` entry here would be a permission
    // granted for a request that is never made.
    const csp = policy()
    expect(directive(csp, "connect-src")).not.toContain("google")
    expect(directive(csp, "img-src")).not.toContain("google")
    expect(directive(csp, "script-src")).not.toContain("google")
  })

  it("lets the photo compressor build its worker", () => {
    /**
     * `browser-image-compression` creates its worker with
     * `URL.createObjectURL(new Blob([...]))`. With `worker-src 'self'` the
     * browser refuses it, and the library falls back to the main thread on some
     * engines and does nothing on others — so the upload works on a desktop and
     * silently fails on a phone. Found on a real iPhone.
     */
    expect(directive(policy(), "worker-src")).toContain("blob:")
    // Still not a free-for-all: `'self'` stays for `sw.js`, and nothing else
    // joins the list without a reason written beside it.
    expect(directive(policy(), "worker-src")).toBe("worker-src 'self' blob:")
  })

  it("sends both report spellings", () => {
    const csp = policy()
    // Safari has never supported `report-to`. Sending only it collects nothing
    // from the platform this PWA is most used on, and collects it silently.
    expect(csp).toContain(`report-uri ${CSP_REPORT_PATH}`)
    expect(csp).toContain("report-to csp")
    expect(reportingEndpoints()).toBe(`csp="${CSP_REPORT_PATH}"`)
  })

  it("upgrades insecure requests only over a secure connection", () => {
    expect(policy()).toContain("upgrade-insecure-requests")

    /**
     * **Keyed on the connection, not on the build**, and the distinction is the
     * whole bug. Over http this directive rewrites the page's own bundle and
     * stylesheet to `https://<host>`, a port that is not listening. The page
     * loads, raises **no violation**, and runs nothing.
     *
     * Chromium exempts localhost as potentially-trustworthy and skips the
     * upgrade; WebKit applies it literally. So a production build served over
     * http passed the whole Chromium suite and failed every `mobile-safari`
     * test — 12 scripts, all nonced, one stylesheet, no violations, unstyled
     * body. Every element present, none of them fetched.
     */
    expect(policy({ secure: false })).not.toContain("upgrade-insecure-requests")
    expect(policy({ dev: true, secure: true })).toContain("upgrade-insecure-requests")
  })

  it("mints a distinct policy per nonce", () => {
    expect(policy({ nonce: "a" })).not.toBe(policy({ nonce: "b" }))
  })
})

describe("FIXED_HEADERS", () => {
  const byKey = (key: string) =>
    FIXED_HEADERS.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value

  it("sets HSTS for two years across subdomains, without preload", () => {
    const hsts = byKey("Strict-Transport-Security")!
    expect(hsts).toContain("max-age=63072000")
    expect(hsts).toContain("includeSubDomains")
    // Preload is baked into browser binaries and takes months to undo. The day
    // it becomes deliberate, this assertion is the thing that has to change
    // with it.
    expect(hsts).not.toContain("preload")
  })

  it("denies camera until step 13 opens it", () => {
    expect(byKey("Permissions-Policy")).toContain("camera=()")
  })

  it("sets nosniff, DENY and a referrer policy", () => {
    expect(byKey("X-Content-Type-Options")).toBe("nosniff")
    expect(byKey("X-Frame-Options")).toBe("DENY")
    expect(byKey("Referrer-Policy")).toBe("strict-origin-when-cross-origin")
  })
})

/**
 * Step 20h. Turnstile is the one origin the policy lets in.
 *
 * **Both directives, because the widget needs both and the failure modes
 * differ.** A missing `script-src` entry blocks the loader and the widget never
 * appears; a missing `frame-src` entry loads the script, mounts the element,
 * and renders nothing — no error, no challenge, no token. The second is the
 * quiet one, and it surfaces as `no captcha_token found` from Supabase, which
 * points at the form rather than at the policy.
 */
describe("Turnstile", () => {
  const TURNSTILE = "https://challenges.cloudflare.com"

  it("is allowed to load and to frame, in both environments", () => {
    for (const dev of [true, false]) {
      expect(directive(policy({ dev }), "script-src"), `dev=${dev}`).toContain(TURNSTILE)
      expect(directive(policy({ dev }), "frame-src"), `dev=${dev}`).toContain(TURNSTILE)
    }
  })

  it("did not widen the policy beyond that one host", () => {
    // `frame-src` was `'none'` before this. It must now name exactly one
    // origin rather than having been opened up.
    expect(directive(policy(), "frame-src")).toBe(`frame-src ${TURNSTILE}`)

    // And nothing may frame *us*, which is a separate directive and unchanged.
    expect(directive(policy(), "frame-ancestors")).toContain("'none'")
  })
})
