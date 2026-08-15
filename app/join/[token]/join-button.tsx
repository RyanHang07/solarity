"use client"

import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { joinCircle } from "@/app/actions/join"
import type { ActionResult } from "@/lib/errors"

function Submit({ circleName }: { circleName: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? "Joining…" : `Join ${circleName}`}
    </button>
  )
}

/**
 * There is no confirmation step. Joining is reversible by leaving, unlike
 * archiving or regenerating a link, and the preview above already states what
 * the Circle is and how many people are in it.
 *
 * Success never returns: the action redirects to the Circle. So any state here
 * is a failure, and only for the three refusals that leave you on this page. A
 * dead link redirects from inside the action instead.
 */
export function JoinButton({
  token,
  circleName,
}: {
  token: string
  circleName: string
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    joinCircle,
    null,
  )

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <Submit circleName={circleName} />

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
