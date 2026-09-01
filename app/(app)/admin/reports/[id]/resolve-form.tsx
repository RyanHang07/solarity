"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { resolveReport } from "@/app/actions/admin"
import type { ActionResult } from "@/lib/errors"

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  )
}

/**
 * Step 17. Triage.
 *
 * **Three outcomes and no fourth.** Actioned means a human did something about
 * it outside this screen; the dashboard deliberately cannot remove content or
 * suspend an account, so it must not imply that pressing a button did.
 *
 * **Reopen exists** because a decision made in thirty seconds is one somebody
 * will want back. It clears `reviewed_at` and `reviewed_by`, which the table's
 * own CHECK requires of anything `pending`.
 */
export function ResolveForm({
  reportId,
  current,
}: {
  reportId: string
  current: string
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    resolveReport,
    null,
  )

  const choices =
    current === "pending"
      ? [
          { value: "reviewed", label: "Mark reviewed" },
          { value: "actioned", label: "Mark actioned" },
          { value: "dismissed", label: "Dismiss" },
        ]
      : [{ value: "pending", label: "Reopen" }]

  return (
    <section aria-label="Outcome" className="flex flex-col gap-2 border-t pt-4">
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <form key={c.value} action={action}>
            <input type="hidden" name="reportId" value={reportId} />
            <input type="hidden" name="status" value={c.value} />
            <Submit label={c.label} />
          </form>
        ))}
      </div>

      <p className="text-xs opacity-60">
        {/*
          Says what the buttons do not do. Somebody marking a report "actioned"
          on a screen with no removal control could reasonably assume the
          content is gone.
        */}
        Marking a report does not remove anything or change the account. It
        records what you decided.
      </p>

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </section>
  )
}
