import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCheckinDate } from "@/lib/supabase/checkin-date"
import { CreateCircleForm } from "./create-circle-form"
import { GoalsPanel } from "./goals-panel"
import { TodayPanel } from "./today-panel"

export const metadata = { title: "Solarity" }

/**
 * Placeholder shell. The v1 dashboard is the check-in panel, Circles list,
 * Overview and notifications — see product-and-design.md section 3.
 */
export default async function DashboardPage() {
  const supabase = await createClient()

  // The layout above has already established there is a session, so this is a
  // cached call rather than a second round trip. Guarded rather than asserted
  // anyway: a `user!` here would become a runtime TypeError if the session
  // expired between the layout and this render, and TypeScript cannot see the
  // layout's guarantee.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const [{ data: circles }, { data: goals }, { data: categories }] =
    await Promise.all([
      // No `.eq("user_id", …)`: RLS already restricts this to the caller's
      // Circles, and a second copy of the rule would only be a weaker one.
      supabase
        .from("group_members")
        .select("group_id, role, groups(name, group_status)")
        .order("joined_at", { ascending: true }),

      // Goals are user-owned. RLS widens reads to circle-mates' goals too, so
      // this filter is what keeps the panel to your own.
      supabase
        .from("goals")
        .select("id, title, archived_at, achieved_at, goal_categories(name, color_hex)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),

      supabase.from("goal_categories").select("slug, name, color_hex").order("name"),
    ])

  // One implementation of the 2 AM boundary rule, in the database, shared by
  // this read path and the INSERT policy that guards writes.
  const today = await getCheckinDate(supabase)

  const [{ data: entries }, { data: completion }, { data: stats }] =
    await Promise.all([
      // `today ?? ""` never matches a real date, so a failed lookup shows an
      // empty day rather than filtering on null and returning every row ever.
      supabase
        .from("progress_entries")
        .select("goal_id")
        .eq("user_id", user.id)
        .eq("check_in_date", today ?? ""),
      supabase
        .from("daily_completion")
        .select("all_completed")
        .eq("user_id", user.id)
        .eq("date", today ?? "")
        .maybeSingle(),
      supabase
        .from("user_lifetime_stats")
        .select("current_streak")
        .eq("user_id", user.id)
        .maybeSingle(),
    ])

  // Without a date, "nothing is checked in" and "we could not tell" are
  // indistinguishable, and the streak would quietly under-report. Say so
  // instead of rendering a confidently wrong number.
  if (!today) {
    return (
      <p role="alert" className="text-sm text-red-600">
        Couldn&apos;t work out today&apos;s date, so today&apos;s progress
        isn&apos;t showing. Reload in a moment.
      </p>
    )
  }

  const completedToday = completion?.all_completed ?? false

  /**
   * `current_streak` contains settled days only. Today is added here rather
   * than stored, because today's completion is reversible right up until the
   * day ends: undo a check-in and it flips back, add a goal and the
   * denominator grows. Storing it would mean a streak that can decrease,
   * which is how people stop trusting the number.
   *
   * architecture.md section 5.
   */
  const displayStreak = (stats?.current_streak ?? 0) + (completedToday ? 1 : 0)

  const checkedIn = new Set((entries ?? []).map((e) => e.goal_id))
  const activeGoals = (goals ?? []).filter((g) => !g.archived_at && !g.achieved_at)
  const todayGoals = activeGoals.map((g) => ({
    id: g.id,
    title: g.title,
    checkedIn: checkedIn.has(g.id),
    color: g.goal_categories?.color_hex ?? null,
  }))

  // `locked` and `archived` move beneath rather than disappearing: locked is
  // awaiting a renewal decision, archived is retired, and both are still
  // history the owner may want. product-and-design.md section 3.
  const active = circles?.filter((m) => m.groups?.group_status === "active") ?? []
  const inactive = circles?.filter((m) => m.groups?.group_status !== "active") ?? []

  return (
    <div className="flex flex-col gap-8">
      <TodayPanel
        goals={todayGoals}
        completedToday={completedToday}
        streak={displayStreak}
        streakIncludesToday={completedToday}
      />

      <GoalsPanel goals={goals ?? []} categories={categories ?? []} />

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Your Circles</h2>

        <CreateCircleForm />

        {!active.length ? (
          <p className="text-sm opacity-70">
            No active Circles yet. Start one above.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {active.map((m) => (
              <li key={m.group_id} className="rounded border px-3 py-2 text-sm">
                {m.groups?.name} · {m.role}
              </li>
            ))}
          </ul>
        )}

        {inactive.length ? (
          <details>
            <summary className="cursor-pointer text-sm opacity-70">
              Archived ({inactive.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {inactive.map((m) => (
                <li
                  key={m.group_id}
                  className="rounded border px-3 py-2 text-sm opacity-60"
                >
                  {m.groups?.name} · {m.groups?.group_status} · {m.role}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  )
}
