/**
 * The public origin, for the two files that must emit absolute URLs.
 *
 * `robots.txt` and `sitemap.xml` are the only places in this app that cannot
 * use a relative path — everything else routes through Next and never needs to
 * know its own hostname.
 *
 * **Ordered so a preview deployment describes itself rather than production.**
 * `NEXT_PUBLIC_SITE_URL` is the deliberate answer when there is a custom domain;
 * `VERCEL_PROJECT_PRODUCTION_URL` is the stable production host; `VERCEL_URL` is
 * the per-deployment one. The localhost fallback keeps `next build` working in
 * CI, which runs with **no environment variables at all** on purpose.
 *
 * No trailing slash, because every caller appends a path.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/$/, "")

  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  if (vercel) return `https://${vercel}`

  return "http://localhost:3000"
}
