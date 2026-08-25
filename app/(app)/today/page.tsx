import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCheckinDate } from "@/lib/supabase/checkin-date"
import { getTodayData, lastStreak } from "@/lib/supabase/today"
import { hasUnfinishedDay } from "@/lib/today-gate"
import { leaveToday } from "@/app/actions/today"
import { TodayPanel } from "@/app/(app)/(shell)/dashboard/today-panel"
import { StreakHeader } from "./streak-header"
import { MarkSeen } from "./mark-seen"

export const metadata = { title: "Today — Solarity" }

/**
 * Step 9. One screen, one job: finish today.
 *
 * **This route never redirects to itself.** The gate that sends people here
 * lives on `/dashboard`, because `/today` is inside `(app)` and a condition in
 * that layout would fire on this page too. `e2e/gates.spec.ts` asserts the loop
 * cannot happen.
 *
 * It does redirect **away** when there is nothing to do, which is a different
 * thing: a finished day has no check-in screen, so arriving by link or bookmark
 * hands you to the dashboard rather than showing an empty list.
 *
 * **The panel is the dashboard's, unchanged.** Both screens render the same
 * component from the same read, so checking off here and there cannot diverge.
 */
export default async function TodayPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const { data: profile } = await supabase
    .from("users")
    .select("today_screen_mode")
    .eq("id", user.id)
    .maybeSingle()

  const today = await getCheckinDate(supabase)

  // Without a date, "nothing is checked in" and "we could not tell" are
  // indistinguishable. The dashboard degrades to a warning; this screen has
  // nothing left to be, so it hands over rather than guessing.
  if (!today) redirect("/dashboard?notice=no-checkin-date")

  const unfinished = await hasUnfinishedDay(supabase, user.id, today)

  // Not gated on `today_screen_mode`: `never` stops the dashboard diverting
  // you, it does not stop you coming here on purpose.
  //
  // **With a notice, because a silent redirect reads as a broken link.** Anyone
  // arriving here has typed the URL, followed a bookmark, or finished their
  // last goal a second ago; all three deserve a sentence rather than finding
  // themselves somewhere else.
  if (!unfinished) redirect("/dashboard?notice=day-done")

  const [data, broken] = await Promise.all([
    getTodayData(supabase, user.id, today),
    lastStreak(supabase, user.id, today),
  ])

  const mode = profile?.today_screen_mode ?? "once_daily"
  const leave = leaveToday.bind(null, mode)

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6">
      {/* Records that this device has seen it, once the page has painted. */}
      <MarkSeen mode={mode} />

      <StreakHeader
        streak={data.streak}
        streakIncludesToday={data.streakIncludesToday}
        // Only when there is no live run. A streak of 5 and a broken run of 12
        // are both true facts, and showing them together says nothing useful.
        broken={data.streak === 0 ? broken : null}
      />

      <TodayPanel
        goals={data.goals}
        userId={user.id}
        completedToday={data.completedToday}
        streak={data.streak}
        streakIncludesToday={data.streakIncludesToday}
        // The panel carries its own streak line on the dashboard, where it is
        // the only thing that does. Here the header above owns it.
        hideStreak
      />

      <div className="flex flex-col gap-2">
        <form action={leave}>
          <button type="submit" className="text-sm underline opacity-70">
            Skip for now
          </button>
        </form>

        {/* Points at the control itself, not at the top of a page with four
            sections on it. */}
        <Link href="/settings#check-in-screen" className="text-xs underline opacity-60">
          Change how often you see this
        </Link>
      </div>
    </div>
  )
}
