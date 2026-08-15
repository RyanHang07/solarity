import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCheckinDate } from "@/lib/supabase/checkin-date"
import { CreateCircleForm } from "./create-circle-form"
import { GoalsPanel } from "./goals-panel"
import { TodayPanel } from "./today-panel"
import { Notice } from "@/components/notice"

export const metadata = { title: "Solarity" }

/**
 * Placeholder shell. The v1 dashboard is the check-in panel, Circles list,
 * Overview and notifications — see product-and-design.md section 3.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>
}) {
  const { notice } = await searchParams
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
      // `.eq("user_id", …)` is load-bearing, and leaving it out was a bug.
      //
      // The SELECT policy is `private.is_group_member(group_id)`: you can read
      // every member row of every Circle you belong to, which is exactly what
      // the roster on `/circles/[id]` needs. So RLS scopes this to the caller's
      // **Circles**, not to the caller's **memberships**, and without the
      // filter a Circle of three came back as three rows and rendered three
      // times, each showing a different person's role.
      //
      // The general form: RLS is not a substitute for a WHERE clause. It bounds
      // what you *may* read, never what you *meant* to read.
      supabase
        .from("group_members")
        .select("group_id, role, groups(name, group_status)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: true }),

      // Goals are user-owned, and since migration 64 RLS agrees: `goals_select_own`
      // is `user_id = auth.uid()`. The filter is kept anyway because the policy
      // is a ceiling, not a statement of intent, and a reader should not have to
      // check the policy to know this panel shows your goals.
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

  // The heading has to name what is actually in the list. `locked` lands here
  // too, and a Circle awaiting a renewal decision filed under "Archived" reads
  // as retired, which is the opposite of "needs your attention".
  const hasLocked = inactive.some((m) => m.groups?.group_status === "locked")
  const inactiveLabel = hasLocked ? "Locked and archived" : "Archived"

  return (
    <div className="flex flex-col gap-8">
      <Notice notice={notice} />

      {/*
        Without a date, "nothing is checked in" and "we could not tell" are
        indistinguishable, and the streak would quietly under-report. So the
        panel is replaced rather than rendered with confidently wrong numbers.

        Only the panel, though. Returning this in place of the whole page also
        hid the goals list, the Circles list and the create form, none of which
        depend on today's date, while the copy claimed only today's progress was
        missing.
      */}
      {today ? (
        <TodayPanel
          goals={todayGoals}
          completedToday={completedToday}
          streak={displayStreak}
          streakIncludesToday={completedToday}
        />
      ) : (
        <p role="alert" className="text-sm text-red-600">
          Couldn&apos;t work out today&apos;s date, so today&apos;s progress and
          your streak aren&apos;t showing. Everything else below is fine. Reload
          in a moment.
        </p>
      )}

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
              <li key={m.group_id} className="rounded border text-sm">
                <Link
                  href={`/circles/${m.group_id}`}
                  className="flex justify-between px-3 py-2"
                >
                  <span>{m.groups?.name}</span>
                  <span className="opacity-60">{m.role}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {inactive.length ? (
          <details>
            <summary className="cursor-pointer text-sm opacity-70">
              {inactiveLabel} ({inactive.length})
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {inactive.map((m) => (
                <li key={m.group_id} className="rounded border text-sm opacity-60">
                  <Link
                    href={`/circles/${m.group_id}`}
                    className="flex justify-between px-3 py-2"
                  >
                    <span>{m.groups?.name}</span>
                    <span>{m.groups?.group_status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </div>
  )
}
