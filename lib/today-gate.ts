import "server-only"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

/**
 * Whether `/today` should divert someone away from the dashboard, and the
 * cookies that remember the answer.
 *
 * ## Where the gate runs, and why not in the layout
 *
 * `(app)/layout.tsx` already redirects to `/onboarding`. A second condition
 * there would fire on **`/today` itself**, which lives inside `(app)`, and
 * redirect it to `/today` forever. `/onboarding` escapes that today only
 * because it sits outside the route group.
 *
 * So this runs on `/dashboard` and nowhere else: the screen it is diverting
 * people away from. `e2e/gates.spec.ts` holds the loop check.
 *
 * ## Why the marker is a cookie
 *
 * "I have seen it today" is a device fact, not an account fact. A column would
 * mean writing during a page render, which no read path in this app does. The
 * cost is seeing the screen once per device per day, which is defensible: you
 * check in from whichever device you have.
 */

/** Keyed to a check-in date, so it expires with the day rather than at midnight. */
const DAY_COOKIE = "solarity_today_seen"

/** No `maxAge`, so the browser drops it when it closes. That is what "opens the app" means. */
const SESSION_COOKIE = "solarity_today_session"

export type TodayMode = Database["public"]["Enums"]["today_screen_mode"]

/**
 * The day is unfinished **and** there is something to finish.
 *
 * The second half matters. `recompute_daily_completion` records a goal-less day
 * as incomplete — correct for streak purposes, and it would otherwise divert
 * someone with no goals to a screen listing nothing, once a day, forever.
 */
export async function hasUnfinishedDay(
  supabase: SupabaseClient<Database>,
  userId: string,
  checkinDate: string | null,
): Promise<boolean> {
  if (!checkinDate) return false

  const [{ count: activeGoals }, { data: completion }] = await Promise.all([
    supabase
      .from("goals")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("archived_at", null)
      .is("achieved_at", null),
    supabase
      .from("daily_completion")
      .select("all_completed")
      .eq("user_id", userId)
      .eq("date", checkinDate)
      .maybeSingle(),
  ])

  if (!activeGoals) return false
  return !(completion?.all_completed ?? false)
}

/**
 * Has this device already been shown the screen for this day or session?
 *
 * Read-only, so it is safe in a server component. Writing happens in
 * `markTodaySeen`, which is a server action.
 */
export async function alreadySeen(
  mode: TodayMode,
  checkinDate: string | null,
): Promise<boolean> {
  if (mode === "never") return true

  const jar = await cookies()

  if (mode === "every_open") return jar.get(SESSION_COOKIE)?.value === "1"

  // `once_daily`. The stored value is the check-in date it was set for, so a
  // skip at 01:00 still holds at 01:30 and stops holding after the 2 AM
  // rollover — comparing against midnight would release it two hours early.
  return jar.get(DAY_COOKIE)?.value === checkinDate
}

/** Called from a server action once `/today` has actually been shown. */
export async function writeSeen(mode: TodayMode, checkinDate: string | null) {
  // Nothing to remember. `alreadySeen` short-circuits on the mode, so a cookie
  // written here would be a value with no reader.
  if (mode === "never") return

  const jar = await cookies()

  if (mode === "every_open") {
    jar.set(SESSION_COOKIE, "1", { httpOnly: true, sameSite: "lax", path: "/" })
    return
  }

  if (!checkinDate) return

  jar.set(DAY_COOKIE, checkinDate, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Two days rather than one. The value is compared against the current
    // check-in date, so a stale cookie can never suppress the wrong day; the
    // lifetime only needs to outlast the day it names.
    maxAge: 60 * 60 * 48,
  })
}
