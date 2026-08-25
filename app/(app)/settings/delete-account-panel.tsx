"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import Link from "next/link"
import { deleteAccount } from "@/app/actions/settings"
import type { ActionResult } from "@/lib/errors"

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded border border-red-600 px-3 py-2 text-sm font-medium text-red-600 disabled:opacity-50"
    >
      {pending ? "Deleting…" : "Delete my account"}
    </button>
  )
}

/**
 * Step 14e. The one control in the app that ends everything.
 *
 * **Typing the username, not a second click.** `ArchivePanel` deliberately does
 * not ask for this and says why: that ceremony suits deleting an account, and
 * archiving destroys no history. This does. The friction is the point — it
 * makes the action impossible to take by muscle memory, and the word being
 * typed is the thing being lost.
 *
 * **The comparison is repeated on the server**, where it is a control rather
 * than a courtesy. This is a POST endpoint like any other and a mis-wired
 * submit reaches it directly; the action reads the username from the database
 * instead of trusting a hidden field, or the form would be confirming itself.
 *
 * **Export is offered inside the confirmation, not beside it.** A "download
 * your data" link on the settings page is easy to miss; here it is in front of
 * someone who has just said they are leaving, which is the only moment it
 * matters.
 *
 * On success the action redirects to `/` with a notice, so there is no success
 * state here to render — by then the account it belonged to is gone.
 */
export function DeleteAccountPanel({
  username,
  /**
   * Active Circles where this account is the owner.
   *
   * **Named, not counted.** "You own 2 Circles" makes someone go and look;
   * naming them answers the question in place. Succession is automatic — the
   * longest-standing member is promoted by `handle_membership_removal` — but
   * "it will be handled" is not the same as knowing which Circles change hands.
   */
  ownedCircles,
}: {
  username: string
  ownedCircles: string[]
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    deleteAccount,
    null,
  )
  const [confirming, setConfirming] = useState(false)
  const [typed, setTyped] = useState("")

  const matches = typed.trim().toLowerCase() === username.toLowerCase()

  return (
    <section
      aria-labelledby="delete-account"
      className="flex flex-col gap-3 border-t pt-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="delete-account" className="text-lg font-semibold">
          Delete your account
        </h2>
        {/*
          **States what survives.** The check-ins are kept, anonymised, because
          other members' group stats were computed against them and removing
          them would retroactively change history those people shared. Promising
          a total erasure the product does not perform would be a lie told at
          the exact moment someone is deciding whether to trust it.
        */}
        <p className="text-sm opacity-70">
          Removes your goals, notes, photos and Circle memberships. Your past
          check-ins stay, with your name removed, so the shared history in your
          Circles still adds up. This can&apos;t be undone.
        </p>
      </div>

      {confirming ? (
        <div className="flex flex-col gap-3 rounded border border-red-600 px-3 py-3">
          {ownedCircles.length ? (
            <p className="text-sm">
              You own{" "}
              <strong>
                {ownedCircles.length === 1
                  ? ownedCircles[0]
                  : `${ownedCircles.length} Circles: ${ownedCircles.join(", ")}`}
              </strong>
              . {ownedCircles.length === 1 ? "It passes" : "They pass"} to the
              longest-standing member. A Circle with nobody left is archived.
            </p>
          ) : null}

          <p className="text-sm">
            Want a copy first?{" "}
            <Link href="/settings/export" className="underline">
              Download your data
            </Link>
            . You can&apos;t after this.
          </p>

          <form action={action} className="flex flex-col gap-2">
            <label htmlFor="confirm-username" className="text-sm">
              Type <strong>{username}</strong> to confirm
            </label>
            {/*
              `autoComplete="off"`, and a name that is not `username`. A field
              called `username` invites the browser's password manager to fill
              it, which would defeat the entire point of asking someone to type
              it themselves.
            */}
            <input
              id="confirm-username"
              name="confirm"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              className="max-w-64 rounded border px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-2">
              <Submit disabled={!matches} />
              <button
                type="button"
                onClick={() => {
                  setConfirming(false)
                  setTyped("")
                }}
                className="rounded px-3 py-2 text-sm underline opacity-70"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded border px-3 py-2 text-sm font-medium"
        >
          Delete your account
        </button>
      )}

      {/* Success redirects, so this can only ever be a failure. */}
      {state && !state.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
    </section>
  )
}
