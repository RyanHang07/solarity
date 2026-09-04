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
  /**
   * The goal's category. **Present even when the goal is hidden**, which is a
   * masking decision rather than an oversight: nine categories with nine fixed
   * colours means the colour *is* the category, so a coloured untitled planet
   * tells a circle-mate what kind of thing you hid. Migration 109 records why
   * it was taken anyway and how to revert it.
   */
  category_slug: string
  /**
   * Whether this planet has a belt. Rolled once by migration 107's column
   * default and then permanent — a planet that changed shape on every load is
   * the kind of thing nobody reports and everybody notices.
   *
   * Also unmasked for hidden goals, and it is the sharper half of that
   * decision: the belt carries no meaning, but it makes a hidden planet
   * recognisably the same planet across days.
   */
  belt_visible: boolean
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
  /**
   * A signed URL, or null. **Not masked**, unlike titles, notes and photos.
   *
   * An avatar is not about a goal, and it is the same picture any signed-in
   * user can already open on the profile — so hiding a goal in this Circle has
   * nothing to say about it. Migration 90 carries the reasoning.
   */
  avatarUrl: string | null
  role: string
  is_self: boolean
  streak_grace: boolean
  circle_status: string
  /** Null while the Circle is live; the closing instant once it is not. */
  as_of: string | null
  checkin_date: string
  /**
   * When they joined this Circle.
   *
   * **The roster's own order cannot answer this**, because it puts the viewer
   * first: every member would see a different arrangement of the same sky. The
   * galaxy sorts by this instead, so a member's slot depends only on when they
   * joined and nobody moves when somebody else arrives.
   */
  joined_at: string
  checked_count: number
  total_count: number
  /**
   * `daily_completion.all_completed` for **their own** check-in date, the same
   * date the two counts above are computed against.
   */
  all_completed: boolean
  /**
   * Whether the whole Circle closed its day — `private.group_day_closed`, the
   * definition the group streak is stored from. The same value on every row.
   *
   * **It can disagree with every member's `all_completed` being true**, for a
   * member whose timezone puts them on a different date than the owner. That
   * split is older than the galaxy: it is the one between a member's row and
   * the Circle's streak.
   */
  sky_closed: boolean
  /** Achieved goals across the Circle's current members. The same on every row. */
  achievement_count: number
  /**
   * The sun colour this member chose, or `null` for "derive it from my id".
   *
   * **Unmasked, like `avatar_url` and for the same reason**: a sun colour is
   * not about a goal, so nothing in the hiding rules touches it.
   *
   * `null` is the common case and is not a missing value — it is what every
   * account looked like before migration 111, and what a new one looks like
   * until it reaches the picker. `sunPresetIdForMember` is the fallback and is
   * stable, so a null renders the same colour on every device.
   */
  sun_preset_id: string | null
  goals: RosterGoal[]
}

/** "3 of 5", or a sentence when there is nothing to count. */
export function formatProgress(member: RosterMember): string {
  // Not "0 of 0". The day still counts as incomplete for streak purposes, but
  // rendering a meaningless fraction says nothing and looks broken.
  if (member.total_count === 0) return "No goals yet"
  return `${member.checked_count} of ${member.total_count}`
}
