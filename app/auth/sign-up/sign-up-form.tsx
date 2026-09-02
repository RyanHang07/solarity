"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { signUpWithPassword } from "@/app/actions/auth"
import { PasswordFields } from "@/components/password-fields"
import { Turnstile } from "@/components/turnstile"
import type { ActionResult } from "@/lib/errors"

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? "Creating…" : "Create account"}
    </button>
  )
}

/**
 * Step 20e. Email and password. Nothing else.
 *
 * ## Why there is no username field
 *
 * The plan had one here. Confirm-email is on, so a username taken on this
 * form would be held by an account nobody has proved they own, and an
 * abandoned signup is indistinguishable from somebody quietly burning handles.
 * It moves to `/onboarding`, which Google users already pass through, so both
 * paths share one implementation of the rules and the profanity screen.
 *
 * ## The password fields are a shared component
 *
 * Rules, confirmation and reveal all live in `components/password-fields.tsx`,
 * because 20f's reset screen asks the same question and would otherwise grow a
 * second copy. Everything it validates is checked again in the action, since
 * this form works with JavaScript off.
 */
export function SignUpForm() {
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
      const result = await signUpWithPassword(prev, formData)
      if (!result.ok) setAttempts((n) => n + 1)
      return result
    },
    null,
  )

  // Starts false so the button is disabled until somebody has typed a password
  // that passes. The empty form is not a valid submission.
  const [passwordValid, setPasswordValid] = useState(false)

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

      <PasswordFields onValidityChange={setPasswordValid} />

      <Turnstile resetKey={attempts} />

      <Submit disabled={!passwordValid} />

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </form>
  )
}
