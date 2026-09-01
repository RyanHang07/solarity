import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCheckinDate } from "@/lib/supabase/checkin-date"
import { getTodayData } from "@/lib/supabase/today"
import { getDigestDays } from "@/lib/supabase/digests"
import { GoalsSummary } from "./goals-summary"
import { TodayPanel } from "./today-panel"
import { DigestPanel } from "./digest-panel"
import { Notice } from "@/components/notice"
import { TAB_NOTIFICATION_TYPES } from "@/lib/notification-types"
import { readMemberships } from "./memberships"

export const metadata = { title: "Solarity" }

/**
 * Step 14a. **Overview, and only Overview.**
 *
 * The shell — the section bar, the unread badge, the `/today` gate — is in
 * `layout.tsx` and is not re-rendered when you move between sections. This file
 * is the body for `/dashboard` and nothing else knows about it.
 *
 * Where you stand: today's check-in, your goals, and how the last five days
 * ended in each Circle.
 *
 * **`?tab=` still works**, as a redirect. Bookmarks, existing specs and any link
 * written before this split keep landing in the right place, and an unrecognised
 * value falls through to here exactly as it did when this was one page.
 *
 * **`getCheckinDate` is read again here**, even though the layout read it for
 * the gate. There is no way to pass layout data to a page, and on a section
 * switch the layout does not run at all — so the alternative to one repeated
 * RPC on a full load is no date on the section that needs it most.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tab?: string }>
}) {
  const { notice, tab } = await searchParams

  // One line, and it keeps every URL written before 14a valid. `?tab=nonsense`
  // is not redirected: falling through to Overview is what it always did.
  if (tab === "circles") redirect("/dashboard/circles")
  if (tab === "notifications") redirect("/dashboard/notifications")

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")
  const userId = user.id

  const [{ active, inactive }, { data: goals }, { data: categories }, today] =
    await Promise.all([
      readMemberships(supabase, userId),

      // Goals are user-owned, and since migration 64 RLS agrees:
      // `goals_select_own` is `user_id = auth.uid()`. The filter is kept anyway
      // because the policy is a ceiling, not a statement of intent, and a
      // reader should not have to check the policy to know this panel shows
      // your goals.
      supabase
        .from("goals")
        .select(
          "id, title, archived_at, achieved_at, deadline, hidden_everywhere, goal_categories(name, color_hex)",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),

      supabase.from("goal_categories").select("slug, name, color_hex").order("name"),

      getCheckinDate(supabase),
    ])

  /**
   * The panel's numbers come from the shared read, not from four queries
   * written out again here.
   *
   * `/today` renders the same component, and two copies of "what is checked off
   * and what does that make the streak" would drift. The rule is one
   * implementation per rule; see `patterns.md`.
   */
  const todayData = await getTodayData(supabase, userId, today)

  // Active only, and the summary shows nothing else. Retired goals live at
  // `/dashboard/goals/archived`, where there is room for what they were.
  const overviewGoals = (goals ?? []).filter((g) => !g.archived_at && !g.achieved_at)

  /**
   * Step 11. Five days of digests, grouped into boxes.
   *
   * **Two reads, both cheap, and neither per Circle.** The snapshots are one
   * query; the attention signals are one more. The panel this replaced ran a
   * query per Circle to render a single row each.
   */
  const membership = [...active, ...inactive].map((m) => ({
    groupId: m.group_id,
    circleName: m.groups?.name ?? "Circle",
    inactive: m.groups?.group_status !== "active",
  }))

  /**
   * Which Circles want something from you, right now.
   *
   * **A fact about the present, not about the day in the box**, so a Circle
   * awaiting a decision rises to the top of every box including last week's.
   * That is deliberate: the boxes are a place to scan, and the thing waiting on
   * you should not be halfway down the fourth one.
   */
  const needsAttention = new Set<string>()
  for (const m of [...active, ...inactive]) {
    if (m.groups?.streak_decision_pending) needsAttention.add(m.group_id)
  }

  // Unread notifications, by Circle. `payload->>group_id` rather than reading
  // whole payloads: this needs one string per row, and payloads carry more.
  //
  // **The same type filter, and it is load-bearing.** Digests are never marked
  // read, so without it every Circle with a digest would count as "needing you"
  // forever, and the ordering would say nothing at all.
  const { data: unreadRows } = await supabase
    .from("notifications")
    .select("payload->>group_id")
    .eq("user_id", userId)
    .is("read_at", null)
    .in("type", TAB_NOTIFICATION_TYPES)

  for (const row of unreadRows ?? []) {
    const groupId = (row as { group_id: string | null }).group_id
    if (groupId) needsAttention.add(groupId)
  }

  const digestDays = await getDigestDays(supabase, membership, needsAttention)

  return (
    <>
      {/* Here rather than in the layout, because layouts do not receive
          `searchParams` — and every `?notice=` redirect in the codebase targets
          a bare `/dashboard`, so there is nothing to spread. */}
      <Notice notice={notice} />

      {/*
        Without a date, "nothing is checked in" and "we could not tell" are
        indistinguishable, and the streak would quietly under-report. So the
        panel is replaced rather than rendered with confidently wrong numbers.

        Only the panel, though. Returning this in place of the whole page also
        hid the goals list, which does not depend on today's date, while the copy
        claimed only today's progress was missing.
      */}
      {today ? (
        <TodayPanel
          goals={todayData.goals}
          userId={userId}
          completedToday={todayData.completedToday}
          streak={todayData.streak}
          streakIncludesToday={todayData.completedToday}
        />
      ) : (
        <p role="alert" className="text-sm text-red-600">
          Couldn&apos;t work out today&apos;s date, so today&apos;s progress and
          your streak aren&apos;t showing. Everything else below is fine. Reload
          in a moment.
        </p>
      )}

      {/*
        Step 16. **A summary, not the panel.** Every control moved to `/dashboard/goals`:
        Overview is about today, and managing the list is a different job that
        was crowding it.
      */}
      <GoalsSummary goals={overviewGoals} today={today} />

      <DigestPanel days={digestDays} viewerId={userId} today={today} />
    </>
  )
}
