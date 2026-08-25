import Link from "next/link"
import { CreateCircleForm } from "./create-circle-form"

export type CircleRow = {
  group_id: string
  role: string
  groups: { name: string; group_status: string } | null
}

/**
 * The `Circles` tab: the list, the create form, and retired Circles beneath.
 *
 * Moved off Overview wholesale in 8f-1. No behaviour changed; it is the same
 * markup under a tab.
 *
 * **The create form stays inside this panel rather than on Overview.** A new
 * account has no Circles, so if the form lived elsewhere this tab would render
 * as an empty page with no way out of it, which reads as broken rather than as
 * new.
 */
export function CirclesPanel({
  active,
  inactive,
}: {
  active: CircleRow[]
  inactive: CircleRow[]
}) {
  // The heading has to name what is actually in the list. `locked` lands here
  // too, and a Circle awaiting a renewal decision filed under "Archived" reads
  // as retired, which is the opposite of "needs your attention".
  const hasLocked = inactive.some((m) => m.groups?.group_status === "locked")
  const inactiveLabel = hasLocked ? "Locked and archived" : "Archived"

  return (
    <section aria-label="Your Circles" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Your Circles</h2>

      <CreateCircleForm />

      {!active.length ? (
        <p className="text-sm opacity-70">No active Circles yet. Start one above.</p>
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
  )
}
