import type { MetadataRoute } from "next"
import { siteUrl } from "@/lib/site-url"

/**
 * **`/join/` is disallowed, and that is the only line here that matters.**
 *
 * An invite token is a bearer credential: anyone holding the URL can join the
 * Circle. A crawler that fetches one puts it in a log, a cache, and possibly a
 * search index. The page already sets `robots: noindex`, but that is a request
 * a crawler reads *after* fetching; this stops the fetch.
 *
 * `/settings` and `/dashboard` are disallowed too. They redirect a signed-out
 * crawler to sign-in anyway, so this saves a request rather than protecting
 * anything.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/join/", "/api/", "/dashboard", "/settings", "/today", "/circles"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
