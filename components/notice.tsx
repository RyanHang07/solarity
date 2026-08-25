import Link from "next/link"

/**
 * Query-param driven, so it needs no client state and clears itself on the
 * next navigation. `Dismiss` is the same route without the param.
 *
 * **Messages are looked up by key, never read from the URL.** Rendering
 * arbitrary query text would let anyone craft a link that puts words in the
 * app's mouth: `?notice=Your+account+was+suspended,+click+here` is a phishing
 * page hosted on your own domain.
 *
 * Lives in `components/` rather than beside the dashboard because `/join`
 * bounces a signed-out visitor to `/`, which is outside the `(app)` route
 * group and cannot import from it.
 */
const MESSAGES: Record<string, string> = {
  "circle-unavailable":
    "That Circle isn't available. You may have left it, or it may have been removed.",
  "circle-archived":
    "Circle archived. It's under Archived below, and everyone can still read its history.",

  // One message for four different refusals: unknown token, revoked, expired,
  // and orphaned Circle. Collapsing them is deliberate. Telling "no such token"
  // apart from "real token, turned off" confirms to anyone guessing that a
  // token was once real, and the person reading this can do exactly one thing
  // about it either way.
  //
  // Not "expired", which is only one of the four and the least common. The
  // usual cause is a Circle being archived, which disables its links by
  // trigger, and telling someone a link they were sent yesterday has expired
  // invites an argument.
  "invite-invalid":
    "That invite link is no longer valid. Ask whoever invited you for a new one.",

  // 9e. `/today` hands people to the dashboard for two very different reasons,
  // and an unexplained redirect reads as a bug in both cases.
  "day-done":
    "Everything's checked off for today. Come back after your next daily reset.",
  "no-checkin-date":
    "Couldn't work out today's date, so the check-in screen is unavailable. Everything else works; try again in a moment.",

  // 14e. Shown on `/`, because by the time this renders there is no account to
  // show it to and every signed-in route would bounce to sign-in — where an
  // unexplained landing looks like being logged out, not like having succeeded.
  //
  // **It says what survived.** Check-ins are kept anonymised so other members'
  // shared history stays intact, and a message claiming total erasure would be
  // the app's last word to that person and a false one.
  "account-deleted":
    "Your account is deleted. Your goals, notes and photos are gone; past check-ins remain, with your name removed, so your Circles' shared history still adds up.",
}

export function Notice({
  notice,
  href = "/dashboard",
}: {
  notice?: string
  /** Where Dismiss goes. The same route, minus the query. */
  href?: string
}) {
  const message = notice ? MESSAGES[notice] : undefined
  if (!message) return null

  return (
    <p
      role="status"
      className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
    >
      <span>{message}</span>
      <Link href={href} className="shrink-0 underline opacity-70">
        Dismiss
      </Link>
    </p>
  )
}
