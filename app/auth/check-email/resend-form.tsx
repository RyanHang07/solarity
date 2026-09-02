"use client"

import { useActionState, useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { resendConfirmation } from "@/app/actions/auth"
import type { ActionResult } from "@/lib/errors"

/** Supabase refuses a second email to one address inside this window. */
const COOLDOWN_SECONDS = 60

function Submit({ waiting }: { waiting: number }) {
  const { pending } = useFormStatus()
  if (waiting > 0) {
    return (
      <p className="text-sm opacity-60" aria-live="polite">
        You can ask for another in {waiting}s.
      </p>
    )
  }
  return (
    <button
      type="submit"
      disabled={pending}
      className="self-start rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? "Sending…" : "Send it again"}
    </button>
  )
}

/**
 * Step 20e. Ask for the confirmation email again.
 *
 * ## The cooldown is shown, not discovered
 *
 * **Supabase silently refuses a second email to the same address inside 60
 * seconds** — no error, no message, and from the outside a button that does
 * nothing. Somebody who does not see the first email will press it twice within
 * ten seconds, so the interesting case is the common one.
 *
 * Counting down in the UI is not the enforcement, and cannot be: the real limit
 * is on the server, and a reload resets this timer. It exists so the button
 * stops looking broken, which is the actual failure being prevented.
 *
 * ## It reports success either way
 *
 * The action does not say whether an email went out, for the same reason signup
 * does not: with enumeration protection on, distinguishing "resent" from "no
 * such account" would reintroduce the leak the setting exists to close.
 */
export function ResendForm({ email }: { email: string }) {
  const [waiting, setWaiting] = useState(0)

  /**
   * **The cooldown starts inside the action, not in an effect watching its
   * result.** Both work; only one is a single render pass, and `setState` in an
   * effect body is a cascading render the lint rule is right to refuse.
   *
   * Started only on success, so a refusal does not lock the button for a minute
   * it never used.
   */
  const [state, action] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await resendConfirmation(prev, formData)
      if (result.ok) setWaiting(COOLDOWN_SECONDS)
      return result
    },
    null,
  )

  useEffect(() => {
    if (waiting <= 0) return
    const timer = setTimeout(() => setWaiting((n) => n - 1), 1000)
    return () => clearTimeout(timer)
  }, [waiting])

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="email" value={email} />
      <Submit waiting={waiting} />

      {state?.ok && waiting > 0 ? (
        <p className="text-sm opacity-70" aria-live="polite">
          Sent. Check your inbox, and your spam folder.
        </p>
      ) : null}

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
