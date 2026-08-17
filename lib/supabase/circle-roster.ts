import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

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

/**
 * Every member of a Circle with their counts for **their own** check-in date.
 *
 * **The third and last exemption from the "RPCs only in `app/actions/`" rule.**
 * That rule exists so a call cannot skip rate limiting; this is a read during
 * render on a page that already reads four other tables unmetered, and metering
 * a page view would be the wrong control anyway. A server action was the
 * alternative and is worse: it would publish a POST endpoint for something
 * never submitted.
 *
 * **All the masking happens inside the function**, which is the point of
 * migration 64. `goals` and `progress_entries` are `user_id = auth.uid()`, so
 * this is the only way to see a circle-mate's progress at all, and a hidden
 * goal's title never leaves the database.
 *
 * Membership is checked by the RPC itself rather than here, because it is
 * `SECURITY DEFINER` and would otherwise hand any Circle's roster to anyone who
 * guessed an id.
 *
 * Returns null rather than throwing. A roster that fails to load is a panel
 * that says so, not a 500 for the whole page.
 */
export async function getCircleRoster(
  supabase: SupabaseClient<Database>,
  groupId: string,
): Promise<RosterMember[] | null> {
  const { data, error } = await supabase.rpc("circle_roster", {
    p_group_id: groupId,
  })

  if (error) {
    console.error("circle_roster failed", error)
    return null
  }

  return (data ?? []) as unknown as RosterMember[]
}

/** "3 of 5", or a sentence when there is nothing to count. */
export function formatProgress(member: RosterMember): string {
  // Not "0 of 0". The day still counts as incomplete for streak purposes, but
  // rendering a meaningless fraction says nothing and looks broken.
  if (member.total_count === 0) return "No goals yet"
  return `${member.checked_count} of ${member.total_count}`
}
