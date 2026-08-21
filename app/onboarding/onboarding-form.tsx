"use client"

import { useActionState, useSyncExternalStore } from "react"
import { useFormStatus } from "react-dom"
import { completeOnboarding } from "@/app/actions/onboarding"
import type { ActionResult } from "@/lib/errors"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? "Saving…" : "Continue"}
    </button>
  )
}

/** Never changes, so there is nothing to subscribe to. */
const noSubscribe = () => () => {}
const readTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
const serverTimezone = () => ""

export function OnboardingForm() {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    completeOnboarding,
    null,
  )

  /**
   * Only the browser knows the timezone, and the daily rollover keys off it
   * (architecture/time-and-streaks.md section 5), so it is read rather than inferred from an IP.
   *
   * `useSyncExternalStore` with a distinct server snapshot reads a client-only
   * value without a hydration mismatch. `useEffect` + `setState` gives the same
   * result, an extra render, and a lint error.
   *
   * The RPC validates it against `pg_timezone_names` regardless.
   */
  const timezone = useSyncExternalStore(noSubscribe, readTimezone, serverTimezone)

  return (
    <form action={action} className="flex w-full max-w-xs flex-col gap-3">
      <label htmlFor="username" className="text-sm font-medium">
        Pick a username
      </label>
      <input
        id="username"
        name="username"
        required
        minLength={3}
        maxLength={30}
        pattern="[A-Za-z0-9_]+"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className="rounded border px-3 py-2 text-sm"
      />
      <p className="text-xs opacity-60">
        3–30 characters. Letters, numbers and underscores. This is what your
        Circles see.
      </p>

      <input type="hidden" name="timezone" value={timezone} />
      {timezone ? (
        <p className="text-xs opacity-60">
          Your day resets at midnight in {timezone}.
        </p>
      ) : null}

      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      <Submit />
    </form>
  )
}
