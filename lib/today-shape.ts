/**
 * What `TodayPanel` renders, in a module a client component can import.
 *
 * **Split out because the type was declared twice.** `lib/supabase/today.ts`
 * exported it and `today-panel.tsx` re-declared an identical copy, so step 13
 * added `entryId` and `photoUrl` to both by hand. Two shapes that must agree,
 * kept in sync by remembering, is the same failure `circle_roster` and
 * `can_view_checkin_photo` produced in migration 71.
 *
 * **It cannot live in `lib/supabase/today.ts`**, because that module is
 * `server-only` and a client component importing the type would drag the
 * runtime import in behind it — the build error step 13 already hit once with
 * `circle-roster.ts`. Types here; anything that talks to Supabase stays there.
 */

export type TodayGoal = {
  id: string
  title: string
  checkedIn: boolean
  color: string | null
  /**
   * Today's entry, or null when the goal is not checked in.
   *
   * A photo hangs off the entry rather than the goal, because the object key is
   * `{user_id}/{goal_id}/{entry_id}` and both storage policies read it
   * positionally. **So the row has to exist before a photo can be addressed at
   * all**, which is why the button only appears once the goal is checked off.
   */
  entryId: string | null
  /**
   * A signed URL for today's photo on this goal, or null.
   *
   * The bucket is private, so this is minted per render and expires within the
   * hour. The object *key* stays in `lib/supabase/`: a component that held one
   * would be a component that could build a URL, and only Storage gets to
   * decide who may read what.
   */
  photoUrl: string | null
}

export type TodayData = {
  goals: TodayGoal[]
  completedToday: boolean
  /** Settled days plus today, computed at display time. Never stored. */
  streak: number
  streakIncludesToday: boolean
}
