/**
 * Step 12. The headers, in one place, so that the two mechanisms that ship them
 * cannot disagree.
 *
 * **There are two, and the split is not stylistic.** `proxy.ts` runs on a
 * matcher that deliberately excludes `_next/static`, `sw.js`, the manifest and
 * every image — a service worker that receives a redirect instead of JavaScript
 * fails to register, so those paths must not pass through it. Anything set only
 * in the proxy therefore misses exactly the assets an attacker would most like
 * sniffed or framed. So:
 *
 * - `FIXED_HEADERS` go in `next.config.ts`, which applies to every path.
 * - The CSP goes in the proxy, because it carries a **per-request nonce** and a
 *   static config cannot mint one.
 *
 * Both are exported from here and both are asserted by `e2e/headers.spec.ts`.
 */

/**
 * Headers with no per-request component. Shipped from `next.config.ts`.
 *
 * **HSTS is two years with `includeSubDomains` and deliberately no `preload`.**
 * Preload is compiled into browser binaries; withdrawing takes months of
 * release trains, and it commits every future subdomain to TLS forever. This
 * header, by contrast, expires on its own if it stops being sent. Revisit once
 * the custom domain is final.
 *
 * **`camera=()` will need opening in step 13.** Check-in photos are the one
 * feature that wants it, and the capture-versus-picker decision belongs to that
 * step, not this one. `build-plan.md` carries the reminder, because a
 * `getUserMedia` that fails from a config file is a bad afternoon.
 */
export const FIXED_HEADERS: readonly { key: string; value: string }[] = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },

  // `frame-ancestors 'none'` in the CSP says the same thing and supersedes this
  // in every browser that reads it. Kept because the CSP does not reach static
  // assets, and this does.
  { key: "X-Frame-Options", value: "DENY" },

  // Full URL to ourselves, origin only when crossing to another site, nothing
  // at all when downgrading. Invite tokens live in paths, so a bare `Referer`
  // leaving for `support.apple.com` would carry one.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Everything this app has no business asking for. An empty allowlist is a
  // refusal, not a default.
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "autoplay=()",
      "camera=()",
      "display-capture=()",
      "encrypted-media=()",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "usb=()",
      "xr-spatial-tracking=()",
    ].join(", "),
  },
]

/**
 * The second hop of the sign-in redirect chain. Named only in `form-action`.
 *
 * Deliberately **not** in `connect-src` or anywhere else: the app never talks
 * to Google, it hands the browser off to Supabase, which hands it to Google.
 */
const GOOGLE_AUTH_ORIGIN = "https://accounts.google.com"

/** Where violation reports are POSTed. Public: see `lib/supabase/proxy.ts`. */
export const CSP_REPORT_PATH = "/api/csp-report"

/** The `Reporting-Endpoints` group name, referenced by the CSP's `report-to`. */
export const CSP_REPORT_GROUP = "csp"

/**
 * Builds the policy for one request.
 *
 * **`nonce` must be fresh per request.** A reused nonce is worth no more than
 * `'unsafe-inline'`, since anything that can read one page can read the value.
 *
 * **`dev` relaxes two things and only two.** Turbopack compiles with `eval`,
 * and its HMR client opens a WebSocket to the dev server. Both would otherwise
 * make `npm run dev` unusable — which matters more than it sounds, because the
 * Playwright suite runs against dev unless `E2E_PROD=1`, so the strict policy
 * is *not* the one most test runs see. `e2e/headers.spec.ts` asserts the
 * invariants in both modes and the strict form only under `E2E_PROD`.
 */
export function contentSecurityPolicy(opts: {
  nonce: string
  dev: boolean
  supabaseUrl: string
  secure: boolean
}): string {
  const { nonce, dev, supabaseUrl, secure } = opts

  // The API origin, and the same host over WebSocket. Realtime has no client
  // subscriber yet, but `notifications` is published to `supabase_realtime`,
  // and a socket blocked by CSP produces *silence* rather than an error — the
  // documented failure mode of realtime here, and the last place anyone would
  // look. Cheaper to allow the origin we already trust for REST.
  const api = originOf(supabaseUrl)
  const socket = api.replace(/^https:/, "wss:")

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],

    /**
     * **Production**: `'self'` plus a nonce, and deliberately **no
     * `'strict-dynamic'`**.
     *
     * `strict-dynamic` was the first cut, on the usual reasoning: it lets the
     * nonce carry to whatever the bootstrap loads, so hashed chunk filenames
     * need no allowlist. What it also does is **discard `'self'`**, so every
     * `<script src>` in the initial HTML must itself be nonced.
     *
     * **It was removed on a wrong diagnosis**, which is worth saying plainly:
     * the WebKit failure was `upgrade-insecure-requests` below, and this was
     * innocent. It went because dropping it was the cheapest way to change a
     * single variable, and the failure survived it.
     *
     * It stays out on its own merits rather than that one.
     *
     * **`'self'` is not a meaningful weakening here, and that is a fact about
     * this app rather than a general claim.** `strict-dynamic` earns its
     * complexity when an origin serves scripts you do not control. This one
     * serves no third-party scripts, uses no CDN, and hosts no user-uploaded
     * content on its own origin: photos live in Supabase storage. So the set of
     * scripts `'self'` admits is exactly the set the build produced.
     *
     * Revisit if any of those three facts stops being true.
     *
     * **Development**: `'unsafe-inline'` and `'unsafe-eval'`, no
     * `strict-dynamic`, and — the part that is easy to get wrong — **no nonce
     * either**. Turbopack compiles with `eval` and injects both scripts and
     * stylesheets at runtime.
     *
     * **A nonce anywhere in `script-src` switches `'unsafe-inline'` off.** That
     * is the rule, in every modern browser: the nonce is treated as the more
     * specific instruction and the blanket permission is discarded. So a dev
     * policy listing both is not belt-and-braces, it is the strict policy with
     * a decorative string beside it, and every inline script Next's dev server
     * injects without a nonce is blocked.
     *
     * The first cut did list both, on the theory that keeping the nonce in dev
     * would exercise the plumbing that carries it from the proxy to the layout.
     * Chromium tolerated it; **WebKit did not**, and the whole `mobile-safari`
     * project failed in a way that named nothing: four tests reporting missing
     * text and missing padding, because with client JS blocked Turbopack never
     * injected the stylesheets either. Nothing said "CSP" anywhere.
     *
     * The nonce is still minted and still sent as `x-nonce`, so the layout
     * stamps it and the plumbing is at least present. What it is not, in dev, is
     * *enforced*.
     *
     * The consequence, stated bluntly because it is the price of this: **a
     * normal local run is not testing the policy that ships.**
     * `e2e/headers.spec.ts` asserts the strict form only under `E2E_PROD`, and
     * that is the run that has to pass before this goes out.
     */
    "script-src": dev
      ? ["'self'", "'unsafe-inline'", "'unsafe-eval'"]
      : ["'self'", `'nonce-${nonce}'`],

    // **Not nonced, on purpose.** A nonce on `style-src` switches off
    // `'unsafe-inline'` for styles, and two things here need it: `next/font`
    // injects a `<style>` block, and every React `style={}` prop is an inline
    // style attribute. Nonce the scripts, where injection is a code-execution
    // bug; accept inline styles, where it is a defacement at worst.
    "style-src": ["'self'", "'unsafe-inline'"],

    // `data:` for the inlined icons Next emits. `blob:` for step 13, where
    // `browser-image-compression` hands back an object URL to preview.
    "img-src": ["'self'", "data:", "blob:", api],
    "font-src": ["'self'", "data:"],

    "connect-src": [
      "'self'",
      api,
      socket,
      ...(dev ? ["ws://localhost:*", "ws://127.0.0.1:*"] : []),
    ],

    /**
     * `'self'` for `sw.js`, which is served from /public.
     *
     * **`blob:` for the photo compressor**, and it is not optional.
     * `browser-image-compression` builds its worker with
     * `URL.createObjectURL(new Blob([...]))`, so `'self'` alone forbids it. The
     * failure is quiet in the worst way: the library catches the refusal on
     * some engines and silently falls back to the main thread, so it works on a
     * desktop and does nothing on a phone.
     *
     * **This is a real widening, and worth being clear about.** A `blob:`
     * worker runs script assembled at runtime, which is exactly what a nonce
     * exists to prevent elsewhere. It is accepted here because the blob is
     * built by a library in our own bundle from its own source — an attacker
     * who could plant a blob worker already has script execution, at which
     * point this directive is not the thing standing between them and the page.
     */
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],

    // Sign-in is a full-page redirect, not a popup or an iframe. Nothing in
    // this app frames anything, and nothing may frame it.
    "frame-src": ["'none'"],
    "frame-ancestors": ["'none'"],

    "object-src": ["'none'"],
    "base-uri": ["'none'"],

    /**
     * **`'self'` alone would break sign-in, in one narrow and very likely
     * window.**
     *
     * `form-action` is enforced against **redirect targets**, not just the
     * initial POST — Chrome does this, Safari and Firefox do not. The sign-in
     * page is a `<form action={signInWithGoogle}>`, a server action that ends
     * in `redirect(data.url)` to Supabase's `/auth/v1/authorize`, which
     * redirects again to Google.
     *
     * Once React has hydrated, the form is submitted by `fetch` and the
     * redirect is followed by the router, so `form-action` never applies. The
     * exposure is the **pre-hydration click**: a native form POST, on the first
     * page a signed-out visitor sees, which is the page where an early click is
     * most likely. It would fail with a CSP violation and no explanation.
     *
     * Both hops are named, because the policy is checked at each one.
     */
    "form-action": ["'self'", api, GOOGLE_AUTH_ORIGIN],
  }

  const parts = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  )

  /**
   * **Only when the request itself arrived over https**, which is not the same
   * question as "is this a production build".
   *
   * This directive rewrites every subresource URL from http to https before
   * fetching it. Over http it therefore points the page's own bundle and
   * stylesheet at `https://<host>` — a port that is not listening — and the
   * result is a page that loads, reports **no CSP violation at all**, and runs
   * nothing. It is not a block; it is a redirect to nowhere.
   *
   * **Chromium hides this and WebKit does not.** Chromium exempts
   * `localhost` as a potentially-trustworthy origin and skips the upgrade;
   * WebKit applies it literally. So `E2E_PROD=1` passed the entire Chromium
   * suite and failed every `mobile-safari` test, with the diagnostic reading
   * *12 scripts, all nonced, one stylesheet, no violations, body unstyled* —
   * every element present and none of them fetched.
   *
   * HSTS already forces https on the deployed origin, so nothing is lost by
   * skipping this where the connection is plain.
   */
  if (secure) parts.push("upgrade-insecure-requests")

  // **Both spellings.** `report-to` is the current one; Safari has never
  // supported it and reads only the deprecated `report-uri`. Sending one means
  // silently collecting nothing from the platform this app is most often used
  // on.
  parts.push(`report-uri ${CSP_REPORT_PATH}`)
  parts.push(`report-to ${CSP_REPORT_GROUP}`)

  return parts.join("; ")
}

/** The `Reporting-Endpoints` header that names the group `report-to` uses. */
export function reportingEndpoints(): string {
  return `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"`
}

/**
 * Scheme and host of a URL, with no trailing path.
 *
 * Defensive because `NEXT_PUBLIC_SUPABASE_URL` is a string from the
 * environment: a trailing slash or a stray path would otherwise be pasted into
 * the policy, where browsers treat a source with a path as a **prefix match**
 * and quietly narrow what is allowed. Falls back to the raw value rather than
 * throwing, since a thrown error in the proxy takes down every route.
 */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}
