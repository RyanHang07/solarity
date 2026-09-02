"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { signInWithPassword } from "@/app/actions/auth"
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
      {pending ? "Signing in…" : "Sign in"}
    </button>
  )
}

/**
 * Step 20e. Signing in with a password.
 *
 * **No client-side validation at all, unlike the signup form.** There is
 * nothing useful to say: the rules apply to passwords being *created*, and
 * telling somebody their existing password is too short would be both wrong and
 * alarming. The only thing this form can know is whether the fields are empty,
 * which `required` already handles.
 *
 * **One error message for every failure**, produced by the action rather than
 * here. "No account with that address" and "wrong password" are two facts, and
 * distinguishing them turns this into the address checker that enumeration
 * protection exists to prevent.
 */
export function PasswordForm({ next }: { next: string }) {
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
      const result = await signInWithPassword(prev, formData)
      if (!result.ok) setAttempts((n) => n + 1)
      return result
    },
    null,
  )

  return (
    <form action={action} className="flex w-full flex-col gap-3">
      <input type="hidden" name="next" value={next} />

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

      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
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
