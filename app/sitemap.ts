import type { MetadataRoute } from "next"
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal"
import { siteUrl } from "@/lib/site-url"

/**
 * Only what a stranger should be able to find.
 *
 * **`/join/[token]` is absent, permanently.** Invite tokens are bearer
 * credentials; listing one would publish it. This file has no way to enumerate
 * them and must never gain one — `e2e/legal.spec.ts` asserts the served XML
 * contains no `/join` path, so an accidental `groups.map(...)` here fails a
 * test rather than leaking a Circle.
 *
 * Nothing behind sign-in is listed either. A sitemap is a hint to crawlers, not
 * a menu for people.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl()
  return [
    { url: base, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/privacy`, lastModified: PRIVACY_VERSION, changeFrequency: "yearly" },
    { url: `${base}/terms`, lastModified: TERMS_VERSION, changeFrequency: "yearly" },
  ]
}
