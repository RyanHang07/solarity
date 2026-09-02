"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { requestPasswordReset } from "@/app/actions/auth"
import { Turnstile } from "@/components/turnstile"
import type { ActionResult } from "@/lib/errors"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? "Sending…" : "Send a reset link"}
    </button>
  )
}

/**
 * Step 20f. Ask for a reset link.
 *
 * **The success message is deliberately non-committal**, and it is the whole
 * security property of this screen. "If there's an account for that address,
 * we've sent a link" is true for a real address, an unknown one and a
 * rate-limited one alike. Anything more helpful — "we couldn't find that
 * account" — turns a form anybody can load into a checker for who uses
 * Solarity.
 *
 * **The form is replaced rather than kept**, so nobody presses it four times
 * wondering whether it worked. Pressing it again means going back, which is a
 * fair price for a screen used once a year and removes the temptation to hammer
 * a rate-limited endpoint.
 */
export function ForgotForm() {
  /**
   * Step 20h. **A Turnstile token is single-use**, and Supabase spends it on
   * every attempt — including a failed one. Without a reset, a second submit
   * after a wrong password or a weak one is refused for the *captcha* rather
   * than for the thing that was actually wrong, which is the most confusing
   * outcome available.
   *
   * Counted rather than a boolean, so two consecutive failures each produce a
   * fresh challenge.
   */
  const [attempts, setAttempts] = useState(0)

  const [state, action] = useActionState<ActionResult | null, FormData>(
    async (prev, formData) => {
      const result = await requestPasswordReset(prev, formData)
      if (!result.ok) setAttempts((n) => n + 1)
      return result
    },
    null,
  )

  if (state?.ok) {
    return (
      <div className="flex flex-col gap-2" aria-live="polite">
        <p className="text-sm">
          If there&apos;s an account for that address, a reset link is on its
          way.
        </p>
        <p className="text-sm opacity-70">
          It expires shortly, and it only works once. Check your spam folder if
          it hasn&apos;t arrived in a minute or two.
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="flex w-full flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="rounded border px-3 py-2"
        />
      </label>

      <Turnstile resetKey={attempts} />

      <Submit />

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
