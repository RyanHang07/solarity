/**
 * The facts the policy pages assert, in one module.
 *
 * **Everything here is a number the system actually enforces**, not a figure
 * chosen to sound reasonable. A privacy policy is a public claim about
 * behaviour, so each constant below is annotated with the thing that makes it
 * true — and if one of those changes, this file is what the change has to pass
 * through.
 */

/**
 * Last substantive edit, and the version a future `users.accepted_terms_version`
 * will compare against.
 *
 * **Nothing records acceptance yet, and that is honest rather than lazy.**
 * Google sign-in is the only way in and it never shows a terms checkbox, so
 * there is no moment at which anyone accepts anything. A column now would be
 * declared with no writer, which is the first shape in `patterns.md`. It lands
 * with the signup flow, and reads this.
 */
export const TERMS_VERSION = "2026-08-23"
export const PRIVACY_VERSION = "2026-08-23"

/** Where a person writes to ask for something the app cannot yet do. */
export const CONTACT_EMAIL = "ryanhang07@gmail.com"

/**
 * **18+.** Stated on both pages and unenforced today, because Google sign-in
 * asks nothing. The signup flow is where a confirmation goes.
 */
export const MINIMUM_AGE = 18

/**
 * Retention, in days.
 *
 * `PHOTOS` is `RETENTION_DAYS` in `purge-expired-photos`; `ACTIVITY` is the
 * `p_days` default on `run_retention_sweep`, which sweeps `notifications` and
 * `digest_snapshots`. Both currently 90, and they are separate constants
 * because they are separate jobs that could diverge.
 */
export const RETENTION_DAYS = { PHOTOS: 90, ACTIVITY: 90 } as const

/**
 * Everyone who processes data on Solarity's behalf.
 *
 * A privacy policy has to name them, and this is also the honest list of who
 * could see something if they chose to. Kept here so adding a service means
 * editing the list a page renders rather than remembering the page exists.
 */
export const PROCESSORS = [
  { name: "Supabase", role: "Database, file storage, and sign-in" },
  { name: "Vercel", role: "Hosting and request logs" },
  { name: "Upstash", role: "Rate limiting" },
  { name: "Google", role: "Sign-in, if you use it" },
  { name: "Brevo", role: "Transactional email" },
] as const

/** Rendered as "Last updated 23 August 2026". UTC-pinned, like every other date here. */
export function formatVersion(version: string): string {
  return new Date(`${version}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}
