"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { setRole } from "@/app/actions/admin"
import type { ActionResult } from "@/lib/errors"

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? "Saving…" : label}
    </button>
  )
}

/**
 * Step 17. Grant or revoke admin, by username.
 *
 * **By username, not by id**, because an id is not something anybody has to
 * hand. It resolves through `profile_by_username` — the same lookup the profile
 * page uses — so a person who has blocked you resolves to nothing here. That is
 * a real edge, accepted: the alternative is a second lookup that ignores
 * blocking, and a promotion path is the wrong place to introduce one.
 *
 * **Granting is confirmed; revoking is not.** Granting hands somebody the
 * ability to read other people's reported content, and it is the direction that
 * cannot be quietly undone once they have looked. Revoking takes that away, and
 * a confirmation on the safe direction is how people learn to click through the
 * unsafe one.
 */
export function RoleForm() {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    setRole,
    null,
  )
  const [username, setUsername] = useState("")
  const [confirming, setConfirming] = useState(false)

  return (
    <section aria-label="Change a role" className="flex flex-col gap-3 border-t pt-5">
      <h2 className="text-lg font-semibold">Change a role</h2>

      <label htmlFor="role-username" className="text-sm">
        Username
      </label>
      <input
        id="role-username"
        value={username}
        onChange={(e) => {
          setUsername(e.target.value)
          // Any edit cancels a pending confirmation, so the name on screen is
          // always the name the button would act on.
          setConfirming(false)
        }}
        autoComplete="off"
        className="max-w-64 rounded border px-3 py-2 text-sm"
      />

      {confirming ? (
        <div className="flex flex-col gap-2 rounded border border-red-600 px-3 py-2">
          <p className="text-sm">
            Make <strong>{username}</strong> an administrator? They will be able
            to read the content of every report, including private notes and
            photos.
          </p>
          <div className="flex gap-2">
            <form action={action}>
              <input type="hidden" name="username" value={username} />
              <input type="hidden" name="role" value="admin" />
              <Submit label="Grant admin" />
            </form>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded px-3 py-2 text-sm underline opacity-70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!username.trim()}
            onClick={() => setConfirming(true)}
            className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            Grant admin
          </button>

          <form action={action}>
            <input type="hidden" name="username" value={username} />
            <input type="hidden" name="role" value="standard" />
            <Submit label="Revoke admin" />
          </form>
        </div>
      )}

      {state?.ok ? (
        <p role="status" className="text-sm">
          Saved.
        </p>
      ) : null}
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </section>
  )
}
