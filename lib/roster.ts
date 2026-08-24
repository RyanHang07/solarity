/**
 * Shapes a screen needs, and the one thing it does with them.
 *
 * **Split out of `lib/supabase/circle-roster.ts` because a client component
 * needs it.** `today-roster.tsx` is `"use client"` and imports `formatProgress`,
 * which is a *value*, so the whole module it comes from lands in the browser
 * bundle. That was harmless until `getCircleRoster` started signing photo URLs
 * and pulled `server-only` in behind it, at which point the build refused —
 * correctly, and with an error naming a file nobody had touched.
 *
 * **Neither `tsc --noEmit` nor ESLint can see this class of problem.** It is a
 * bundler constraint, so `next build` is the only thing that catches it. Types
 * and pure functions live here; anything that talks to Supabase stays in
 * `lib/supabase/`, where `server-only` makes the boundary enforceable.
 */

/** One goal on a member's row. `title` is null when hidden in this Circle. */
export type RosterGoal = {
  id: string
  title: string | null
  hidden: boolean
  checked: boolean
  note: string | null
  /**
   * Yours only; null on everyone else's rows.
   *
   * A viewer who cannot act on a row has no use for its primary key, and
   * `note_shared` for someone else would leak the existence of a note they
   * chose to keep private.
   */
  entry_id: string | null
  note_shared: boolean
  /**
   * A signed URL for this check-in's photo, or null.
   *
   * **The object key never leaves this module.** `circle_roster` returns the
   * key; `getCircleRoster` exchanges it for a URL and hands on only that, so no
   * component ever holds a path it might be tempted to build a URL from.
   *
   * **Masked like `note`, minus the opt-in.** Yours always; someone else's only
   * when the goal is not hidden in this Circle. There is no `photo_shared` flag
   * and that is deliberate: `note_shared` exists because a note is a sentence
   * you might not want read, while a photo is the proof, so hiding the goal is
   * the whole control. Migration 79 carries the reasoning.
   *
   * **Two gates, not one.** The roster decides what to *offer*; Storage decides
   * what to *serve*, and they answer slightly different questions — Storage
   * serves a photo when any shared Circle can see the goal, because a Storage
   * request cannot say which Circle it is about. A key the roster offers but
   * Storage refuses simply fails to sign and arrives here as null.
   */
  photoUrl: string | null
}

export type RosterMember = {
  user_id: string
  username: string
  display_name: string | null
  role: string
  is_self: boolean
  streak_grace: boolean
  circle_status: string
  /** Null while the Circle is live; the closing instant once it is not. */
  as_of: string | null
  checkin_date: string
  checked_count: number
  total_count: number
  goals: RosterGoal[]
}

/** "3 of 5", or a sentence when there is nothing to count. */
export function formatProgress(member: RosterMember): string {
  // Not "0 of 0". The day still counts as incomplete for streak purposes, but
  // rendering a meaningless fraction says nothing and looks broken.
  if (member.total_count === 0) return "No goals yet"
  return `${member.checked_count} of ${member.total_count}`
}
