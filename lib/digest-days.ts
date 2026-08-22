/**
 * Step 11a. Turning a flat list of digest snapshots into day boxes.
 *
 * **Pure, and separate from the read, so it can be tested.** Every failure this
 * function can have is silent: five days that are really four, a box dated a
 * day early, a Circle that quietly drops out. None of those throw, and none of
 * them look wrong in a screenshot unless you already know the answer.
 */

/** What a snapshot carries, once `summary` has been read defensively. */
export type DigestSnapshot = {
  groupId: string
  circleName: string
  /** `YYYY-MM-DD`. A check-in date, not an instant. See `formatDay`. */
  date: string
  completed: number
  members: number
  groupStreak: number
  /** Empty when the snapshot predates the roll call or its shape changed. */
  roster: RosterEntry[]
  /** Live state, not a fact about this day. See `needsAttention`. */
  needsAttention: boolean
  inactive: boolean
}

export type RosterEntry = {
  userId: string
  /** Frozen at write time. A rename does not relabel last Tuesday. */
  username: string
  completed: boolean
  streak: number
}

export type DigestDay = {
  date: string
  circles: DigestSnapshot[]
}

export const DAYS_SHOWN = 5

/**
 * The most recent `DAYS_SHOWN` days, newest first, each carrying its Circles.
 *
 * **Days, not rows.** Taking the newest N *rows* would silently drop a Circle
 * whose day happened to sort last, and would show fewer days the more Circles
 * someone is in — the panel would mean something different for every account.
 */
export function groupByDay(snapshots: DigestSnapshot[]): DigestDay[] {
  const byDate = new Map<string, DigestSnapshot[]>()
  for (const s of snapshots) {
    const list = byDate.get(s.date) ?? []
    list.push(s)
    byDate.set(s.date, list)
  }

  return [...byDate.keys()]
    // Lexicographic works and is deliberate: `YYYY-MM-DD` sorts as dates do,
    // and comparing strings avoids parsing a date only to sort it.
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, DAYS_SHOWN)
    .map((date) => ({ date, circles: orderCircles(byDate.get(date) ?? []) }))
}

/**
 * Circles needing you first, then alphabetical.
 *
 * **`needsAttention` is a fact about now, not about this day.** A Circle with a
 * pending streak decision therefore rises to the top of *every* box, including
 * one from last week. That reads as a sorting bug for a moment and is right on
 * reflection: the boxes are a place to scan, and the thing waiting on you
 * should not be halfway down the fourth one.
 *
 * `localeCompare` rather than `<`, so "Ā" and "a" sort where a reader expects
 * rather than where their code points fall.
 */
export function orderCircles(circles: DigestSnapshot[]): DigestSnapshot[] {
  return [...circles].sort((a, b) => {
    if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1
    return a.circleName.localeCompare(b.circleName)
  })
}

/**
 * A day, written the way a person reads one.
 *
 * **Pinned to UTC, and this is the trap the whole file exists to avoid.**
 * `new Date("2026-08-18")` parses as UTC midnight and formats in the viewer's
 * zone, so anyone west of UTC reads every box as the day before. These strings
 * are check-in *dates*: `current_checkin_date()` already resolved a timezone
 * into them, and formatting locally re-applies an offset that was applied once
 * already. Same rule as `shiftDate` in `lib/supabase/today.ts`.
 */
export function formatDay(date: string, today?: string): string {
  if (today && date === today) return "Today"
  if (today && date === addDays(today, -1)) return "Yesterday"

  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
}

/** UTC-pinned date arithmetic, for the same reason as `formatDay`. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * How a Circle's streak moved since the box below it.
 *
 * Free: the previous day is already loaded. It answers what a bare number
 * cannot — whether a streak of 3 is climbing, holding, or all that survived a
 * reset.
 *
 * `null` when there is no previous day to compare against, which is different
 * from "it did not move" and must not render as "held".
 */
export function streakDelta(
  days: DigestDay[],
  dayIndex: number,
  groupId: string,
): "up" | "reset" | "held" | null {
  const current = days[dayIndex]?.circles.find((c) => c.groupId === groupId)
  const previousDay = days[dayIndex + 1]
  if (!current || !previousDay) return null

  const previous = previousDay.circles.find((c) => c.groupId === groupId)
  if (!previous) return null

  if (current.groupStreak > previous.groupStreak) return "up"
  if (current.groupStreak < previous.groupStreak) return "reset"
  return "held"
}
