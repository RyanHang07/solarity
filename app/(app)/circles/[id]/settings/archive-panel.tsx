"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { archiveCircle } from "@/app/actions/circles"
import type { ActionResult } from "@/lib/errors"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-red-600 px-3 py-2 text-sm font-medium text-red-600 disabled:opacity-50"
    >
      {pending ? "Archiving…" : "Archive this Circle"}
    </button>
  )
}

/**
 * Owner only, and the one control in the app with no undo, so it sits behind a
 * confirmation that names the Circle rather than saying "are you sure".
 *
 * Not typing the name to confirm: that ceremony suits deleting an account, and
 * this destroys no history. Members keep the Circle and its record, it just
 * stops running.
 */
export function ArchivePanel({
  groupId,
  circleName,
}: {
  groupId: string
  circleName: string
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    archiveCircle,
    null,
  )
  const [confirming, setConfirming] = useState(false)

  return (
    <section className="flex flex-col gap-3 border-t pt-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Archive</h2>
        <p className="text-sm opacity-70">
          Ends the Circle for everyone. It stops counting streaks, stops taking
          members, and moves to the Archived list, where everyone can still read
          its history. This can&apos;t be undone.
        </p>
      </div>

      {confirming ? (
        <div className="flex flex-col gap-2 rounded border border-red-600 px-3 py-2">
          <p className="text-sm">
            Archive <strong>{circleName}</strong>? The current streak stops here
            and nobody can restart it.
          </p>
          <div className="flex gap-2">
            <form action={action}>
              <input type="hidden" name="groupId" value={groupId} />
              <Submit />
            </form>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded px-3 py-2 text-sm underline opacity-70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded border px-3 py-2 text-sm font-medium"
        >
          Archive this Circle
        </button>
      )}

      {/* On success the action redirects, so this only ever shows a failure. */}
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </section>
  )
}
