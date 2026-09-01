import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import { signPhotos } from "./photo-urls"

/**
 * Step 16. What a goal actually was.
 *
 * **Entirely your own data.** `goals_select_own` and `progress_entries_select_own`
 * are both `user_id = auth.uid()`, so there is no RPC here and no policy to
 * add — the first feature in a while that touches no SQL. Every read below is
 * filtered by `user_id` anyway, because RLS bounds what you *may* read and
 * never what you *meant* to read.
 */

export type RetiredGoal = {
  id: string
  title: string
  category: string | null
  color: string | null
  createdAt: string
  deadline: string | null
  achievedAt: string | null
  archivedAt: string | null
  /** How many days were checked off, across the whole life of the goal. */
  checkins: number
}

export type RecordDay = {
  date: string
  note: string | null
  /** A signed URL, or null — the photo may never have existed, or may be purged. */
  photoUrl: string | null
}

/** One page of days. A daily goal kept for a year is 365 rows. */
export const RECORD_PAGE_SIZE = 60

/**
 * Retired goals, newest ending first.
 *
 * **Counted with a grouped query rather than one count per goal.** Ten retired
 * goals would otherwise be eleven round trips, and there is no cap on how many
 * a person accumulates — unlike active goals, which stop at ten.
 */
export async function getRetiredGoals(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<RetiredGoal[]> {
  const { data: goals, error } = await supabase
    .from("goals")
    .select(
      "id, title, created_at, deadline, achieved_at, archived_at, goal_categories(name, color_hex)",
    )
    .eq("user_id", userId)
    .or("achieved_at.not.is.null,archived_at.not.is.null")
    .order("achieved_at", { ascending: false, nullsFirst: false })
    .order("archived_at", { ascending: false, nullsFirst: false })

  if (error) {
    console.error("retired goals failed", error)
    return []
  }
  if (!goals?.length) return []

  /**
   * The check-in counts, in one query.
   *
   * PostgREST has no `group by`, so this reads the ids and counts them here.
   * Bounded by the number of check-ins across retired goals, which is the same
   * data the record pages already page through — worth watching if somebody
   * accumulates years of them, and not worth a view today.
   */
  const ids = goals.map((g) => g.id)
  const { data: entries } = await supabase
    .from("progress_entries")
    .select("goal_id")
    .eq("user_id", userId)
    .in("goal_id", ids)

  const counts = new Map<string, number>()
  for (const e of entries ?? []) {
    if (e.goal_id) counts.set(e.goal_id, (counts.get(e.goal_id) ?? 0) + 1)
  }

  return goals.map((g) => ({
    id: g.id,
    title: g.title,
    category: g.goal_categories?.name ?? null,
    color: g.goal_categories?.color_hex ?? null,
    createdAt: g.created_at,
    deadline: g.deadline,
    achievedAt: g.achieved_at,
    archivedAt: g.archived_at,
    checkins: counts.get(g.id) ?? 0,
  }))
}

/**
 * One goal and one page of its check-in days.
 *
 * Returns null when the goal is not yours — RLS already filters it out, and
 * `maybeSingle` turns that into an absence rather than an error, which is what
 * a 404 wants.
 */
export async function getGoalRecord(
  supabase: SupabaseClient<Database>,
  userId: string,
  goalId: string,
  page = 0,
) {
  const { data: goal } = await supabase
    .from("goals")
    .select(
      "id, title, created_at, deadline, achieved_at, archived_at, goal_categories(name, color_hex)",
    )
    .eq("id", goalId)
    .eq("user_id", userId)
    .maybeSingle()

  if (!goal) return null

  const from = page * RECORD_PAGE_SIZE
  const { data: entries, count } = await supabase
    .from("progress_entries")
    .select("check_in_date, note, photo_url", { count: "exact" })
    .eq("user_id", userId)
    .eq("goal_id", goalId)
    // Newest first: the last thing you did is the thing you remember.
    .order("check_in_date", { ascending: false })
    .range(from, from + RECORD_PAGE_SIZE - 1)

  // One request for every photo on the page. Signed as the caller, so Storage
  // stays the thing deciding — see `photo-urls.ts`.
  const urls = await signPhotos(
    supabase,
    (entries ?? []).map((e) => e.photo_url),
  )

  const days: RecordDay[] = (entries ?? []).map((e) => ({
    date: e.check_in_date,
    note: e.note,
    /**
     * **Null covers two different pasts**, and the page says so rather than
     * drawing a broken image: the day may never have had a photo, or the photo
     * may have passed the 90-day retention window, which nulls the column and
     * deletes the object. Neither is recoverable and neither is an error.
     */
    photoUrl: e.photo_url ? (urls.get(e.photo_url) ?? null) : null,
  }))

  return {
    goal: {
      id: goal.id,
      title: goal.title,
      category: goal.goal_categories?.name ?? null,
      color: goal.goal_categories?.color_hex ?? null,
      createdAt: goal.created_at,
      deadline: goal.deadline,
      achievedAt: goal.achieved_at,
      archivedAt: goal.archived_at,
    },
    days,
    total: count ?? 0,
    page,
    hasMore: from + RECORD_PAGE_SIZE < (count ?? 0),
  }
}
