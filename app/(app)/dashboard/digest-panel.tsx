import Link from "next/link"

export type DigestRow = {
  groupId: string
  circleName: string
  date: string | null
  completed: number | null
  members: number | null
  groupStreak: number | null
}

/**
 * 8f-2. How yesterday ended, in every Circle at once.
 *
 * `/circles/[id]?tab=overview` already answers this for one Circle. Answering
 * it one Circle at a time is exactly what a dashboard exists to avoid.
 *
 * **The most recent snapshot, not literally yesterday.** Members are in
 * different timezones, `build_daily_digests` runs per rollover, and a Circle
 * made this morning has none at all. Filtering on yesterday's date produces
 * empty rows that look like a failure; "the latest, and say which day" does
 * not, which is why every row carries its own date.
 */
export function DigestPanel({ rows }: { rows: DigestRow[] }) {
  return (
    <section aria-label="Yesterday" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">How it went</h2>

      {rows.length === 0 ? (
        <p className="text-sm opacity-70">
          Join or start a Circle and this fills in after the first day ends.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.groupId} className="rounded border px-3 py-2 text-sm">
              <Link href={`/circles/${r.groupId}?tab=overview`} className="flex flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span>{r.circleName}</span>
                  {/*
                    A Circle with no snapshot gets a row saying so, rather than
                    being left out or shown as zeroes. Omitting it makes this
                    list disagree with the Circles tab, with no way to tell a
                    deliberate absence from a dropped row; zeroes would state
                    that nobody finished, when the day has not happened.
                  */}
                  {r.date === null ? (
                    <span className="shrink-0 opacity-60">no day has finished yet</span>
                  ) : (
                    <span className="shrink-0 opacity-70">
                      {r.completed ?? 0} of {r.members ?? 0} finished
                    </span>
                  )}
                </span>

                {r.date !== null ? (
                  <span className="text-xs opacity-60">
                    {r.date} · group streak {r.groupStreak ?? 0}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
