"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { resolveStreakDecision } from "@/app/actions/streak-decision"
import type { ActionResult } from "@/lib/errors"

function Submit({
  label,
  choice,
  danger,
}: {
  label: string
  choice: "keep" | "reset"
  danger?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      name="choice"
      value={choice}
      disabled={pending}
      className={`rounded border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
        danger ? "border-red-600 text-red-600" : ""
      }`}
    >
      {pending ? "Saving…" : label}
    </button>
  )
}

function list(names: string[]) {
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/**
 * Owner-only banner. Shown until the decision is made, and there is no timer
 * behind it: grace persisting is harmless, whereas something that silently
 * resets a streak on a schedule is a nasty surprise nobody agreed to.
 *
 * Deliberately states the consequence of each option rather than asking "keep
 * or reset?". The words "keep" and "reset" alone do not say *whose* streak, and
 * the answer is everyone's.
 */
export function StreakDecision({
  groupId,
  joiners,
  streak,
}: {
  groupId: string
  /** Display names of everyone currently in grace. */
  joiners: string[]
  /** The group streak at risk. */
  streak: number
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    resolveStreakDecision,
    null,
  )

  // Two-step on reset only. Keeping the streak is the reversible answer: the
  // newcomer simply starts counting today. Resetting destroys a number for
  // every member and cannot be undone, so it gets the same treatment as
  // archiving.
  const [confirmReset, setConfirmReset] = useState(false)

  // Singular "they" reads the same as the plural here, so the copy needs no
  // pluralisation branch and cannot gender anyone by accident.
  const who = joiners.length ? list(joiners) : "Someone"

  return (
    <section className="flex flex-col gap-3 rounded border px-3 py-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">A decision is waiting on you</h2>
        <p className="text-sm opacity-80">
          {who} joined while this Circle was on a {streak} day streak. They
          aren&apos;t being counted yet, so the streak is neither growing nor at
          risk.
        </p>
      </div>

      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="groupId" value={groupId} />

        {confirmReset ? (
          <div className="flex flex-col gap-2 rounded border border-red-600 px-3 py-2">
            <p className="text-sm">
              Reset to 0 days for <strong>everyone</strong>, including members
              who earned it? This can&apos;t be undone.
            </p>
            <div className="flex flex-wrap gap-2">
              <Submit label="Reset for everyone" choice="reset" danger />
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="rounded px-3 py-2 text-sm underline opacity-70"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Submit
              label={`Keep the ${streak} day streak`}
              choice="keep"
            />
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="rounded border px-3 py-2 text-sm font-medium"
            >
              Start everyone over at 0
            </button>
          </div>
        )}

        <p className="text-xs opacity-60">
          Either way they start counting from today. The only question is
          whether the {streak} days already earned survive.
        </p>

        {state && !state.ok ? (
          <p role="alert" className="text-sm text-red-600">
            {state.error}
          </p>
        ) : null}
      </form>
    </section>
  )
}
