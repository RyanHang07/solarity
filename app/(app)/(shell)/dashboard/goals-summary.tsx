import Link from "next/link"
import { deadlineLabel, isOverdue } from "@/lib/goal-deadline"

type Goal = {
  id: string
  title: string
  deadline: string | null
  goal_categories: { name: string; color_hex: string } | null
}

/**
 * Step 16. What Overview says about your goals now.
 *
 * **Read-only, and that is the whole change.** Creating, deadlines, achieving,
 * archiving and per-Circle visibility moved to `/dashboard/goals`. Overview is about
 * today — what is checked off and what is left — and sixty visibility switches
 * were crowding the one screen you open every morning.
 *
 * What stays is the part you glance at: which goals are live, and whether any
 * of them are overdue. Everything else is one tap away.
 */
export function GoalsSummary({
  goals,
  today,
}: {
  /** Active goals only. The caller has already filtered. */
  goals: Goal[]
  today: string | null
}) {
  return (
    // Same landmark name as the panel it replaced, so locators and screen
    // readers still find "Your goals" where they always did.
    <section aria-label="Your goals" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Your goals</h2>
        <Link href="/dashboard/goals" className="text-sm underline opacity-70">
          View all goals
        </Link>
      </div>

      {goals.length === 0 ? (
        <p className="text-sm opacity-70">
          No active goals yet.{" "}
          <Link href="/dashboard/goals" className="underline">
            Add one
          </Link>
          .
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {goals.map((g) => {
            const label = deadlineLabel(g.deadline, today)
            const overdue = isOverdue(g.deadline, today)
            return (
              <li key={g.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className="inline-block size-3 shrink-0 rounded-full"
                  style={{ background: g.goal_categories?.color_hex }}
                />
                <span>{g.title}</span>
                {/* Only overdue is worth the space here. A deadline three weeks
                    out is not news on the screen you check in from; a missed one
                    is. The full label is on `/dashboard/goals`. */}
                {overdue && label ? (
                  <span className="text-xs text-red-600">{label}</span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
