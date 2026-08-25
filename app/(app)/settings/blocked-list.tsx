"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { unblockUser } from "@/app/actions/moderation"
import type { ActionResult } from "@/lib/errors"

function Unblock() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending} className="text-xs underline opacity-70">
      {pending ? "…" : "Unblock"}
    </button>
  )
}

/**
 * Step 15d. The accounts you have blocked.
 *
 * **This list exists because blocking hides the thing it is undone from.**
 * Mutual invisibility means a blocked person's profile returns a 404 to you, so
 * the Unblock control cannot live where the Block control did. Migration 87 is
 * a `SECURITY DEFINER` function for the same reason: `users_select_self_or_groupmate`
 * would not return their username once you no longer share a Circle, and a list
 * of uuids is not a list anyone can act on.
 *
 * **No confirmation on Unblock.** It is the reversible direction — the Block
 * button is one click away again — and a confirmation on every safe action is
 * how people learn to click through the unsafe ones.
 */
export function BlockedList({
  blocked,
}: {
  blocked: { user_id: string; username: string | null; display_name: string | null }[]
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    unblockUser,
    null,
  )

  return (
    <section aria-label="Blocked accounts" className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Blocked</h2>

      {blocked.length === 0 ? (
        // Rendered rather than hidden. An empty section says the feature exists
        // and that you have not used it; a missing one says nothing at all, and
        // someone looking for where to undo a block would not find this page.
        <p className="text-sm opacity-70">
          You haven&apos;t blocked anyone. Blocking is on someone&apos;s profile.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {blocked.map((b) => (
            <li
              key={b.user_id}
              className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
            >
              {/* Username leads, as everywhere one person is named to another:
                  `display_name` is not unique. */}
              <span>
                {b.username ?? "an account"}
                {b.display_name ? (
                  <span className="opacity-60"> · {b.display_name}</span>
                ) : null}
              </span>
              <form action={action}>
                <input type="hidden" name="userId" value={b.user_id} />
                <Unblock />
              </form>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs opacity-60">
        Blocking hides each of you from the other&apos;s profile. You still share
        any Circles you were both in, and nobody is told either way.
      </p>

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </section>
  )
}
