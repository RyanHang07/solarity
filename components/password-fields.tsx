"use client"

import { useId, useState } from "react"
import { PASSWORD_HINT, passwordProblem } from "@/lib/password"

/**
 * Step 20e. Choosing a password: the rules, a confirmation, and a way to see
 * what you typed.
 *
 * ## Shared, because two screens choose a password
 *
 * Signing up and resetting both ask somebody to invent one, and both need the
 * same rules, the same confirmation and the same reveal. Written once here so
 * 20f reuses it rather than growing a second copy that drifts.
 *
 * Signing *in* deliberately does not use this: there is nothing useful to
 * validate about a password that already exists, and telling somebody theirs is
 * too short would be both wrong and alarming.
 *
 * ## One reveal for both fields
 *
 * A single toggle rather than one each. Two independent eyes on two fields is
 * more chrome and a worse question — nobody wants to see one and hide the
 * other — and revealing both is what makes the confirmation field checkable by
 * eye rather than only by the mismatch message.
 *
 * `type="button"`, because a bare `<button>` inside a form submits it, and a
 * reveal that submitted a half-typed signup would be a memorable bug.
 *
 * ## The mismatch is checked here *and* on the server
 *
 * This form works with JavaScript off, and without it neither the rules nor the
 * match are checked in the browser. A mismatch that reached the server
 * unchecked would create an account with the first password silently, and
 * whoever typed it would be certain they had typed the second. So the action
 * re-reads both fields.
 *
 * ## Errors appear after blur, not on every keystroke
 *
 * Telling somebody their password is too short while they are three characters
 * into typing it is noise, and it makes the field feel hostile.
 *
 * ## The hint and the error are siblings of the label, not children of it
 *
 * They started inside it, because wrapping everything in one `<label>` is the
 * shortest way to lay a field out. The cost was invisible until a test went
 * looking for a field named "Password": a `<label>` contributes *all* its text
 * to the accessible name, so this field was actually called **"Password At
 * least 8 characters, with a letter and a number."**, and grew longer still
 * once an error appeared under it. A screen reader announced the rule as part
 * of the name and then again as the description, and no locator could name the
 * field the way a person would.
 *
 * So the label holds the label and nothing else, and `aria-describedby` does
 * the job it was already there to do. The error is described rather than named
 * for the same reason: a field should not be renamed by being wrong.
 */
export function PasswordFields({
  /** Copy for the first field. "New password" reads better on a reset. */
  label = "Password",
  onValidityChange,
}: {
  label?: string
  onValidityChange?: (valid: boolean) => void
}) {
  const passwordId = useId()
  const confirmId = useId()
  const hintId = useId()
  const problemId = useId()
  const mismatchId = useId()

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [touched, setTouched] = useState(false)
  const [confirmTouched, setConfirmTouched] = useState(false)
  const [reveal, setReveal] = useState(false)

  const problem = password ? passwordProblem(password) : null
  const mismatch = confirm.length > 0 && confirm !== password

  const valid = password.length > 0 && problem === null && confirm === password

  // Reported during render rather than from an effect: the parent needs it to
  // decide whether its submit is enabled, and an effect would be a second pass
  // for something already knowable.
  const [reported, setReported] = useState<boolean | null>(null)
  if (reported !== valid) {
    setReported(valid)
    onValidityChange?.(valid)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={passwordId}>{label}</label>
        <input
          id={passwordId}
          type={reveal ? "text" : "password"}
          name="password"
          required
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-describedby={
            touched && problem ? `${hintId} ${problemId}` : hintId
          }
          aria-invalid={(touched && problem !== null) || undefined}
          className="rounded border px-3 py-2"
        />
        <span id={hintId} className="text-xs opacity-60">
          {PASSWORD_HINT}
        </span>
        {touched && problem ? (
          <span id={problemId} className="text-xs text-red-600">
            {problem}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 text-sm">
        <label htmlFor={confirmId}>Confirm password</label>
        <input
          id={confirmId}
          type={reveal ? "text" : "password"}
          name="confirmPassword"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onBlur={() => setConfirmTouched(true)}
          aria-describedby={
            confirmTouched && mismatch ? mismatchId : undefined
          }
          aria-invalid={(confirmTouched && mismatch) || undefined}
          className="rounded border px-3 py-2"
        />
        {confirmTouched && mismatch ? (
          <span id={mismatchId} className="text-xs text-red-600">
            These don&apos;t match.
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setReveal((r) => !r)}
        // `aria-pressed` rather than changing the label alone: a screen reader
        // then announces the state of a toggle instead of a button whose name
        // keeps changing under it.
        aria-pressed={reveal}
        className="self-start text-xs underline opacity-70"
      >
        {reveal ? "Hide password" : "Show password"}
      </button>
    </div>
  )
}
