import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import { signPhotos } from "./photo-urls"
import type { TodayData } from "@/lib/today-shape"

/**
 * Everything `TodayPanel` needs, read once and shared by both screens that show
 * it.
 *
 * **One implementation, deliberately.** `/dashboard` and `/today` render the
 * same panel from the same numbers; two copies of this read would drift, and a
 * rule implemented twice is the shape behind most of the bugs in this codebase.
 * See `patterns.md`.
 */

export type { TodayGoal, TodayData } from "@/lib/today-shape"

export async function getTodayData(
  supabase: SupabaseClient<Database>,
  userId: string,
  checkinDate: string | null,
): Promise<TodayData> {
  const [{ data: goals }, { data: entries }, { data: completion }, { data: stats }] =
    await Promise.all([
      supabase
        .from("goals")
        .select("id, title, archived_at, achieved_at, goal_categories(color_hex)")
        .eq("user_id", userId)
        .is("archived_at", null)
        .is("achieved_at", null)
        .order("created_at", { ascending: true }),

      // `?? ""` never matches a real date, so a failed lookup shows an empty day
      // rather than filtering on null and returning every row ever.
      supabase
        .from("progress_entries")
        .select("id, goal_id, photo_url")
        .eq("user_id", userId)
        .eq("check_in_date", checkinDate ?? ""),

      supabase
        .from("daily_completion")
        .select("all_completed")
        .eq("user_id", userId)
        .eq("date", checkinDate ?? "")
        .maybeSingle(),

      supabase
        .from("user_lifetime_stats")
        .select("current_streak")
        .eq("user_id", userId)
        .maybeSingle(),
    ])

  // Keyed by goal, because a goal has at most one entry per day: the unique
  // constraint on (goal_id, check_in_date) is what makes that safe to assume.
  const today = new Map((entries ?? []).map((e) => [e.goal_id, e]))
  const completedToday = completion?.all_completed ?? false

  // Your own photos still go through `createSignedUrl` as you, rather than
  // being trusted because they are yours. Migration 72 is the reason to be
  // careful here: `can_view_checkin_photo` once hid a user's own photo from
  // them, and a path that skipped the check would have hidden that bug too.
  const urls = await signPhotos(
    supabase,
    [...today.values()].map((e) => e.photo_url),
  )

  return {
    goals: (goals ?? []).map((g) => {
      const entry = today.get(g.id)
      return {
        id: g.id,
        title: g.title,
        checkedIn: Boolean(entry),
        color: g.goal_categories?.color_hex ?? null,
        entryId: entry?.id ?? null,
        photoUrl: entry?.photo_url ? (urls.get(entry.photo_url) ?? null) : null,
      }
    }),
    completedToday,
    /**
     * `current_streak` holds settled days only. Today is added here rather than
     * stored, because today's completion is reversible right up until the day
     * ends: undo a check-in and it flips back, add a goal and the denominator
     * grows. Storing it would mean a streak that can decrease, which is how
     * people stop trusting the number.
     */
    streak: (stats?.current_streak ?? 0) + (completedToday ? 1 : 0),
    streakIncludesToday: completedToday,
  }
}

/**
 * The streak that just ended: when, and how long it was.
 *
 * **Neither fact is stored.** `current_streak` is already 0 by the time anyone
 * would read this — the rollover zeroed it and recorded nothing about what it
 * zeroed. So both come from `daily_completion` history, walked backwards from
 * the most recent completed day.
 *
 * `null` means there is nothing to say: either you have never completed a day,
 * or your streak is alive and the caller should show the number instead.
 *
 * **Bounded at 400 rows.** Enough for the longest streak anyone will have for
 * the next year, and a bound rather than an unbounded scan on a page render.
 * A streak longer than that reports as 400, which is a lie nobody will meet
 * before this wants a stored column anyway.
 */
export async function lastStreak(
  supabase: SupabaseClient<Database>,
  userId: string,
  checkinDate: string | null,
): Promise<{ endedOn: string; length: number } | null> {
  if (!checkinDate) return null

  const { data } = await supabase
    .from("daily_completion")
    .select("date")
    .eq("user_id", userId)
    .eq("all_completed", true)
    .lt("date", checkinDate)
    .order("date", { ascending: false })
    .limit(400)

  const days = (data ?? []).map((d) => d.date)
  if (!days.length) return null

  let length = 1
  for (let i = 1; i < days.length; i++) {
    if (days[i] !== shiftDate(days[i - 1], -1)) break
    length++
  }

  return { endedOn: days[0], length }
}

/**
 * Date arithmetic on `YYYY-MM-DD`, in UTC.
 *
 * These are check-in **dates**, not instants: they were already resolved into
 * the user's timezone by `current_checkin_date()`. Parsing them in local time
 * would re-apply an offset that has already been applied, and shift the run by
 * a day for anyone west of UTC.
 */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
