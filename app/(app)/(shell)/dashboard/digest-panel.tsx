import Link from "next/link"
import {
  formatDay,
  streakDelta,
  type DigestDay,
  type DigestSnapshot,
} from "@/lib/digest-days"

/**
 * Step 11. One box per day, newest first, five days.
 *
 * ## What this replaced, and why
 *
 * It used to be the latest snapshot per Circle: one row each, no history. That
 * answered "how did yesterday go" and nothing else, and digests were also
 * filling the Notifications tab — 69 of 70 rows — burying the four
 * notifications that might actually need a response. Digests live here now and
 * only here.
 *
 * ## Two levels, both in the markup
 *
 * Collapsed is a line per Circle. Expanded is a `<details>` holding the roll
 * call the snapshot has carried since it was written.
 *
 * **`<details>` rather than client state**, the same choice as the goal
 * visibility panel: no client component, it works with JavaScript off, and the
 * hidden content is in the document for search and for a screen reader rather
 * than conjured on click.
 *
 * ## The date is never parsed locally
 *
 * `formatDay` pins to UTC. These are check-in dates with a timezone already
 * applied; parsing them locally re-applies an offset and dates every box a day
 * early for anyone west of UTC.
 */
export function DigestPanel({
  days,
  viewerId,
  today,
}: {
  days: DigestDay[]
  viewerId: string
  today: string | null
}) {
  return (
    <section aria-label="Recent days" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">How it went</h2>

      {days.length === 0 ? (
        <p className="text-sm opacity-70">
          Join or start a Circle and this fills in after the first day ends.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {days.map((day, dayIndex) => (
            <li
              key={day.date}
              // A test id, deliberately: day boxes and Circle lines are both
              // list items, so `getByRole("listitem")` matches nested ones and
              // `.nth(1)` lands inside the first box rather than on the second.
              data-testid="digest-day"
              className="flex flex-col gap-2 rounded border px-3 py-2"
            >
              {/* The box is titled with its day, which is the whole point of
                  grouping: a Circle's number means little without one. */}
              <h3 className="text-sm font-semibold">{formatDay(day.date, today ?? undefined)}</h3>

              <ul className="flex flex-col gap-1">
                {day.circles.map((circle) => (
                  <CircleLine
                    key={circle.groupId}
                    circle={circle}
                    delta={streakDelta(days, dayIndex, circle.groupId)}
                    viewerId={viewerId}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function CircleLine({
  circle,
  delta,
  viewerId,
}: {
  circle: DigestSnapshot
  delta: "up" | "reset" | "held" | null
  viewerId: string
}) {
  const everyone = circle.members > 0 && circle.completed >= circle.members
  const nobody = circle.completed === 0

  return (
    <li data-testid="digest-circle" className="text-sm">
      <details className="group">
        <summary className="flex cursor-pointer items-baseline justify-between gap-3">
          <span className="flex items-baseline gap-2">
            <span>{circle.circleName}</span>
            {/* Said quietly rather than hidden. The day it reported still
                happened; without a word here, a Circle that stops appearing in
                newer boxes looks like a dropped row. */}
            {circle.inactive ? (
              <span className="text-xs opacity-50">inactive</span>
            ) : null}
          </span>

          <span className="shrink-0 opacity-70">
            {circle.completed} of {circle.members} finished
          </span>
        </summary>

        <div className="mt-1 flex flex-col gap-1 pl-1">
          <p className="text-xs opacity-60">
            Group streak {circle.groupStreak}
            {/* `null` is not "held": with no day beneath this one there is
                nothing to compare, and saying "held" would be inventing a fact. */}
            {delta === "up" ? " · up from yesterday" : null}
            {delta === "reset" ? " · reset" : null}
            {delta === "held" ? " · unchanged" : null}
          </p>

          {circle.roster.length === 0 ? (
            // A snapshot written before the roll call existed, or one whose
            // shape changed. The counts above are still true.
            <p className="text-xs opacity-60">No member detail for this day.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {circle.roster.map((member) => (
                <li key={member.userId} className="flex items-baseline gap-2 text-xs">
                  <span aria-hidden className="opacity-70">
                    {member.completed ? "✓" : "✗"}
                  </span>
                  {/* The visible tick is decorative; the words carry it for a
                      screen reader, which cannot infer meaning from a glyph. */}
                  <span className="sr-only">
                    {member.completed ? "finished" : "did not finish"}
                  </span>
                  <span className={member.completed ? "" : "opacity-70"}>
                    {member.username}
                    {member.userId === viewerId ? " (you)" : null}
                  </span>
                  <span className="opacity-50">
                    {member.streak > 0 ? `streak ${member.streak}` : "no streak"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Link
            href={`/circles/${circle.groupId}?tab=overview`}
            className="text-xs underline opacity-70"
          >
            Open {circle.circleName}
          </Link>
        </div>
      </details>

      {/* Outside the summary so it is not part of the toggle's accessible
          name, which would otherwise read as one long sentence. */}
      {everyone || nobody ? (
        <p className="sr-only">
          {everyone ? "Everyone finished" : "Nobody finished"} in {circle.circleName}
        </p>
      ) : null}
    </li>
  )
}
