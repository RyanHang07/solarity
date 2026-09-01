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
export const TERMS_VERSION = "2026-08-31"
export const PRIVACY_VERSION = "2026-08-31"

/** Where a person writes to ask for something the app cannot yet do. */
export const CONTACT_EMAIL = "ryanhang07@gmail.com"

/**
 * Who holds the data, by name.
 *
 * **GDPR wants a named controller, and there is no company to name.** "Run by
 * one person" says the scale and not the person, which is the one fact someone
 * handing over their photos is entitled to. A name without an address is the
 * usual position for an individual running something small: enough to know who
 * is responsible, without publishing where they live.
 *
 * If the legal name differs from the display name, this is the constant to
 * correct, and it is the only place it appears.
 */
export const CONTROLLER_NAME = "Ryan Hang"

/**
 * Days to answer a request that cannot be self-served.
 *
 * **The GDPR month, chosen over the CCPA's 45 days.** Export and deletion are
 * both instant and self-serve, so the only requests that arrive by hand are the
 * six things missing from the export, which is an afternoon at v1 volumes.
 * Promising longer than needed reads worse than the product behaves.
 *
 * This is a personal commitment with no team behind it. If that stops being
 * realistic, the number moves before it is missed rather than after.
 */
export const RESPONSE_DAYS = 30

/**
 * Where the data physically is.
 *
 * Supabase project `wyuadcnrxisqmzygzhzd` is in `us-west-1`, and Vercel and
 * Upstash are US-hosted too. For anyone in the EU or UK this is an
 * international transfer and has to be disclosed rather than inferred.
 */
export const DATA_REGION = "the United States"

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
 *
 * **What has no sweep, which the page now says out loud.** Avatars, reports and
 * `audit_log` are kept until something deletes them by hand or the account
 * goes. A retention section that lists only the things that expire reads as
 * though everything does.
 */
export const RETENTION_DAYS = { PHOTOS: 90, ACTIVITY: 90 } as const

/**
 * What `export_user_data()` actually returns, top-level key by top-level key.
 *
 * **Here because the page used to claim "everything Solarity holds about you"
 * and the function returns six things.** Notifications, push subscriptions,
 * blocks, reports, the notification and screen preferences on `users`, and the
 * email address in `auth.users` are all absent. That claim is the one a data
 * access request is judged against, so it is the worst sentence on the page to
 * have wrong.
 *
 * Adding a key to the RPC without adding it here leaves the page understating
 * the file, which is the harmless direction. Removing one without removing it
 * here is the direction that matters, and this list is where to look.
 */
export const EXPORT_CONTENTS = [
  "your profile and timezone",
  "your streaks and totals",
  "every goal, with its category, deadline and dates",
  "every check-in, with its note",
  "which days you completed in full",
  "the Circles you are in, your role, and when you joined",
] as const

/**
 * Everyone who processes data on Solarity's behalf.
 *
 * A privacy policy has to name them, and this is also the honest list of who
 * could see something if they chose to. Kept here so adding a service means
 * editing the list a page renders rather than remembering the page exists.
 *
 * **The roles name the data, not just the service.** "Rate limiting" did not
 * tell a reader that their IP address leaves the request; `clientIp()` uses it
 * as an Upstash key on the two paths that serve signed-out visitors.
 *
 * **Brevo stays, and the 31 Aug review nearly deleted it.** Nothing in this
 * repository sends email: `signInWithOAuth` is the only auth call, and no
 * route, action or Edge Function sends a message. But Brevo is configured as
 * Supabase's auth SMTP sender, outside the codebase, in project settings, so
 * the credentials and the capability are live even though Google-only sign-in
 * never triggers one. **A processor is named because of what it is wired to
 * receive, not because of what it happened to handle this month** — grepping
 * the repo would have removed it, and the answer was in `architecture/app.md`.
 * The role below says both halves.
 */
export const PROCESSORS = [
  { name: "Supabase", role: "Database, file storage, and sign-in" },
  { name: "Vercel", role: "Hosting. Its request logs include your IP address" },
  {
    name: "Upstash",
    role: "Rate limiting. Invite links are counted against an IP address, so signed-out attempts reach it",
  },
  { name: "Google", role: "Sign-in. It tells Solarity your email address and the name on the account" },
  {
    name: "Brevo",
    role: "Sends sign-in email. Configured and unused today, because Google is the only way in",
  },
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
