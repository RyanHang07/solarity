import type { NextConfig } from "next";
import { FIXED_HEADERS } from "./lib/security-headers";

const nextConfig: NextConfig = {
  /**
   * Step 12. The headers with no per-request component.
   *
   * **Here rather than in `proxy.ts` for one specific reason.** The proxy's
   * matcher excludes `_next/static`, `sw.js`, the manifest and every image, and
   * that exclusion is load-bearing: a service worker handed a redirect instead
   * of JavaScript fails to register, which on iOS means no push at all. Headers
   * set there would therefore miss exactly the responses most worth protecting
   * from sniffing and framing. `headers()` has no such matcher.
   *
   * The CSP is **not** here, because it carries a per-request nonce. See
   * `lib/security-headers.ts`.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...FIXED_HEADERS],
      },
    ];
  },
};

export default nextConfig;
