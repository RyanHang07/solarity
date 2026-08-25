/**
 * Step 14d. What a goal's deadline says, and whether it has passed.
 *
 * **Pure and UTC-pinned, for the reason `lib/digest-days.ts` already learned
 * the hard way.** Both arguments are calendar dates as `YYYY-MM-DD`: the
 * deadline is a `date` column since migration 84, and `today` comes from
 * `current_checkin_date()`, which has already resolved the person's timezone
 * and the 2 AM boundary. Formatting either one with a local `new Date(s)`
 * re-applies an offset that was applied once already, and dates it a day early
 * for anyone west of UTC.
 *
 * No component imports `Date.now()` to answer any of this. The day a deadline
 * is measured against is the same day a check-in is measured against, or the
 * two would disagree at exactly the hours that matter.
 */

/**
 * **The deadline day is fully playable**, so overdue means strictly before
 * today.
 *
 * The same rule `/circles/[id]` states for a Circle's deadline: "a deadline of
 * the 15th means the 15th is fully playable". Two deadline concepts in one app
 * that disagreed about whether the last day counts would be worse than either
 * choice.
 *
 * Comparison is on the strings, which is exact rather than lucky: `YYYY-MM-DD`
 * is fixed-width and zero-padded, so lexical order is calendar order.
 */
export function isOverdue(
  deadline: string | null,
  today: string | null,
): boolean {
  if (!deadline || !today) return false
  return deadline < today
}

/** UTC-pinned, so the string is the day that was chosen. */
function format(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/**
 * What the goal row shows beside the date input.
 *
 * **"Due today" is called out, and yesterday is not.** A deadline is a thing
 * you are working toward, so the last day it is still achievable is worth
 * naming; the day after is just one of many days it has been overdue, and
 * "Overdue since yesterday" would need a second special case to avoid reading
 * oddly the day after that.
 *
 * Returns `null` when there is nothing to say, so the caller renders nothing
 * rather than an empty element.
 */
export function deadlineLabel(
  deadline: string | null,
  today: string | null,
): string | null {
  if (!deadline) return null

  // **Without today's date, state the deadline and claim nothing about it.**
  // `getCheckinDate` returns null when the RPC fails, and "Overdue" computed
  // from a missing today would be a confident wrong answer on a screen that is
  // otherwise working.
  if (!today) return `Due ${format(deadline)}`

  if (deadline === today) return "Due today"
  if (isOverdue(deadline, today)) return `Overdue since ${format(deadline)}`
  return `Due ${format(deadline)}`
}
