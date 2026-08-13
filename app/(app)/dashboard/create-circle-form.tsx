"use client"

import { useActionState, useEffect, useRef } from "react"
import { useFormStatus } from "react-dom"
import { createCircle } from "@/app/actions/circles"
import type { ActionResult } from "@/lib/errors"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? "Creating…" : "Create Circle"}
    </button>
  )
}

export function CreateCircleForm() {
  const [state, action] = useActionState<
    ActionResult<{ groupId: string }> | null,
    FormData
  >(createCircle, null)

  // Clear the field after a successful create. The server action revalidates
  // the page so the list updates on its own, but an uncontrolled input keeps
  // whatever was typed, which reads as if nothing happened.
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state?.ok) formRef.current?.reset()
  }, [state])

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      <label htmlFor="circle-name" className="text-sm font-medium">
        Start a Circle
      </label>
      <div className="flex gap-2">
        <input
          id="circle-name"
          name="name"
          required
          maxLength={50}
          autoComplete="off"
          placeholder="Morning crew"
          className="flex-1 rounded border px-3 py-2 text-sm"
        />
        <Submit />
      </div>
      <p className="text-xs opacity-60">
        Up to 50 characters. You can invite up to nine other people.
      </p>

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
