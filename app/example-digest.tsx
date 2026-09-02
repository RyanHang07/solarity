import { formatDay } from "@/lib/digest-days"

/**
 * Step 20i. What a day looks like, shown rather than described.
 *
 * ## Why this is a rendered component and not a screenshot
 *
 * The daily-batched model is the least obvious thing about the product: nothing
 * is live, everybody's day is summarised once, and you read it the next
 * morning. That is much weaker in prose than on screen — and a screenshot goes
 * stale the first time the digest changes, silently, in the one place a visitor
 * is deciding whether to trust the description.
 *
 * ## It deliberately does not import `DigestPanel`
 *
 * The real panel takes `DigestDay[]`, a viewer id and a `today`, all of which
 * would have to be faked here, and it renders `<details>` elements holding a
 * roll call this page has no room for. Reusing it would couple a marketing page
 * to a component that answers to the dashboard, and the first change to either
 * would break the other.
 *
 * **`formatDay` is shared**, because the date format is the part a reader
 * compares against what they later see, and two ways of writing "Yesterday"
 * would be a small visible lie.
 */
const EXAMPLE = {
  circle: "Morning Runners",
  done: 3,
  total: 4,
  members: [
    { name: "you", finished: true },
    { name: "priya", finished: true },
    { name: "sam", finished: true },
    { name: "alex", finished: false },
  ],
}

export function ExampleDigest() {
  // A fixed date rather than `new Date()`: this is an illustration, and a
  // component that renders differently on every request is one that cannot be
  // reasoned about or snapshotted.
  const day = formatDay("2026-08-31")

  return (
    <div
      aria-label="An example day"
      className="flex flex-col gap-2 rounded border px-3 py-2 text-sm"
    >
      <h3 className="text-sm font-semibold">{day}</h3>

      <div className="flex items-baseline justify-between gap-3">
        <span>{EXAMPLE.circle}</span>
        <span className="shrink-0 opacity-70">
          {EXAMPLE.done} of {EXAMPLE.total} finished
        </span>
      </div>

      <ul className="flex flex-col gap-0.5">
        {EXAMPLE.members.map((m) => (
          <li key={m.name} className="flex items-baseline gap-2 text-xs">
            <span aria-hidden className="opacity-70">
              {m.finished ? "✓" : "✗"}
            </span>
            <span className="sr-only">
              {m.finished ? "finished" : "did not finish"}
            </span>
            <span className={m.finished ? "opacity-70" : ""}>{m.name}</span>
          </li>
        ))}
      </ul>

      <p className="text-xs opacity-60">
        Group streak 6 · up from yesterday
      </p>
    </div>
  )
}
