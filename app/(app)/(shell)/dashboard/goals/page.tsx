import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCheckinDate } from "@/lib/supabase/checkin-date"
import { GoalsPanel } from "../goals-panel"
import { readMemberships } from "../memberships"

export const metadata = { title: "Goals — Solarity" }

/**
 * Step 16. **Every control a goal has, in one place.**
 *
 * Creating, deadlines, achieving, archiving and per-Circle visibility all moved
 * here from Overview. Overview is about *today* — what is checked off and what
 * is left — and managing the list is a different job that was crowding it.
 *
 * The panel itself is unchanged and still lives beside the dashboard, because
 * `/today` and Overview both read from that folder. Moving the file would be a
 * rename with no reader asking for it.
 */
export default async function GoalsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")
  const userId = user.id

  const [{ active }, { data: goals }, { data: categories }, today] =
    await Promise.all([
      readMemberships(supabase, userId),

      supabase
        .from("goals")
        .select(
          "id, title, archived_at, achieved_at, deadline, hidden_everywhere, goal_categories(name, color_hex)",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),

      supabase.from("goal_categories").select("slug, name, color_hex").order("name"),

      // Overdue is measured against the check-in date, never the browser's
      // clock, or it disagrees with the streak either side of the 2 AM boundary.
      getCheckinDate(supabase),
    ])

  const activeGoals = (goals ?? []).filter((g) => !g.archived_at && !g.achieved_at)
  const retiredCount = (goals ?? []).length - activeGoals.length

  const ownGoalIds = activeGoals.map((g) => g.id)
  const { data: visibility } = ownGoalIds.length
    ? await supabase
        .from("goal_group_visibility")
        .select("goal_id, group_id")
        .in("goal_id", ownGoalIds)
        .eq("hidden", true)
    : { data: [] }

  const hiddenIn = new Map<string, string[]>()
  for (const row of visibility ?? []) {
    hiddenIn.set(row.goal_id, [...(hiddenIn.get(row.goal_id) ?? []), row.group_id])
  }

  return (
    <>
      <GoalsPanel
        goals={goals ?? []}
        categories={categories ?? []}
        circles={active.map((m) => ({
          id: m.group_id,
          name: m.groups?.name ?? "Circle",
        }))}
        hiddenIn={Object.fromEntries(hiddenIn)}
        today={today}
      />

      {/*
        **A link, not a `<details>`.** The retired list used to expand in place
        on Overview; it is a page now, because a goal you finished deserves more
        than a line and because an expandable list of them was clutter on the
        way somewhere else.
      */}
      <Link href="/dashboard/goals/archived" className="self-start text-sm underline">
        {retiredCount
          ? `Archived and achieved (${retiredCount})`
          : "Archived and achieved"}
      </Link>
    </>
  )
}
