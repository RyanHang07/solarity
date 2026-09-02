"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { updatePassword } from "@/app/actions/auth"
import { PasswordFields } from "@/components/password-fields"
import type { ActionResult } from "@/lib/errors"

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? "Saving…" : "Set new password"}
    </button>
  )
}

/**
 * Step 20f. Choose a new password.
 *
 * **The same `PasswordFields` as signup**, which is why that component was
 * pulled out of the signup form rather than left in it: identical rules,
 * identical confirmation, identical reveal. A second copy here would be a
 * second place for the hint and the check to disagree.
 *
 * **`label="New password"`** is the only difference, and it earns its keep:
 * "Password" on this screen reads like a field asking for the current one,
 * which is the thing somebody resetting it does not have.
 */
export function ResetForm() {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    updatePassword,
    null,
  )
  const [valid, setValid] = useState(false)

  return (
    <form action={action} className="flex w-full flex-col gap-3">
      <PasswordFields label="New password" onValidityChange={setValid} />

      <Submit disabled={!valid} />

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
