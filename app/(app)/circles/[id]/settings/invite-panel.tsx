"use client"

import { useActionState, useState, useSyncExternalStore } from "react"
import { useFormStatus } from "react-dom"
import { generateInviteLink, revokeInviteLink } from "@/app/actions/invites"
import type { ActionResult } from "@/lib/errors"

function Submit({
  label,
  pendingLabel,
  danger,
}: {
  label: string
  pendingLabel: string
  danger?: boolean
}) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
        danger ? "border-red-600 text-red-600" : ""
      }`}
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

/** The origin is a browser-only value, and never changes. */
const noSubscribe = () => () => {}
const readOrigin = () => window.location.origin
const serverOrigin = () => ""

function formatExpiry(expiresAt: string | null) {
  if (!expiresAt) return "This link doesn't expire."
  const when = new Date(expiresAt)
  const days = Math.ceil((when.getTime() - Date.now()) / 86_400_000)
  if (days <= 0) return `Expired ${when.toLocaleDateString()}.`
  return `Expires in ${days} day${days === 1 ? "" : "s"}, on ${when.toLocaleDateString()}.`
}

export function InvitePanel({
  groupId,
  token,
  expiresAt,
  expired,
}: {
  groupId: string
  token: string | null
  expiresAt: string | null
  expired: boolean
}) {
  const [genState, genAction] = useActionState<
    ActionResult<{ token: string }> | null,
    FormData
  >(generateInviteLink, null)
  const [revokeState, revokeAction] = useActionState<ActionResult | null, FormData>(
    revokeInviteLink,
    null,
  )

  // Two-step, because `create_invite_link` disables every existing link before
  // inserting. A bare "Generate new link" would silently kill whatever people
  // are already holding, which is a footgun rather than a feature.
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Closed when a result arrives, and deliberately not in the submit handler:
  // clearing it there unmounts the form that is mid-submission, which can abort
  // the action. Adjusted during render rather than in an effect, which is the
  // documented way to reset state in response to a changed value and avoids the
  // cascading render an effect would cause.
  const [seenResult, setSeenResult] = useState(genState)
  if (genState !== seenResult) {
    setSeenResult(genState)
    setConfirmRegen(false)
  }

  // Server renders the path; the browser swaps in the full URL on hydration.
  // `useSyncExternalStore` with a distinct server snapshot is how a client-only
  // value gets read without a hydration mismatch.
  const origin = useSyncExternalStore(noSubscribe, readOrigin, serverOrigin)

  // The server prop is the only source of truth, never the action's returned
  // token. Both actions call `revalidatePath`, so this page re-renders with the
  // new state in the same pass the result arrives. Preferring the returned
  // token instead looks like a shortcut and is a bug: generate, then revoke,
  // and the stale success result would go on displaying a link that is dead.
  const url = token ? `${origin}/join/${token}` : null

  const error =
    (genState && !genState.ok && genState.error) ||
    (revokeState && !revokeState.ok && revokeState.error) ||
    null

  async function copy() {
    if (!token) return
    await navigator.clipboard.writeText(`${window.location.origin}/join/${token}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Invite link</h2>
        <p className="text-sm opacity-70">
          Anyone with this link can join, so treat it like a password. One link
          is live at a time.
        </p>
      </div>

      {url ? (
        <div className="flex flex-col gap-2 rounded border px-3 py-2">
          <code className="overflow-x-auto text-sm">{url}</code>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copy}
              className="rounded border px-3 py-2 text-sm font-medium"
            >
              {copied ? "Copied" : "Copy link"}
            </button>

            <form action={revokeAction}>
              <input type="hidden" name="groupId" value={groupId} />
              <Submit label="Revoke" pendingLabel="Revoking…" danger />
            </form>
          </div>
          <p className={`text-xs ${expired ? "text-red-600" : "opacity-60"}`}>
            {formatExpiry(expiresAt)}
          </p>
        </div>
      ) : (
        <p className="text-sm opacity-70">
          No live link. Generate one to invite people.
        </p>
      )}

      {/* Revoking leaves no link, so the button below becomes a plain create
          again. The warning only applies when there is something to destroy. */}
      {token && !confirmRegen ? (
        <button
          type="button"
          onClick={() => setConfirmRegen(true)}
          className="self-start rounded border px-3 py-2 text-sm font-medium"
        >
          Generate a new link
        </button>
      ) : null}

      {token && confirmRegen ? (
        <div className="flex flex-col gap-2 rounded border border-red-600 px-3 py-2">
          <p className="text-sm">
            This turns off the link above. Anyone still holding it, in a group
            chat or an old message, won&apos;t be able to join.
          </p>
          <div className="flex gap-2">
            <form action={genAction}>
              <input type="hidden" name="groupId" value={groupId} />
              <Submit label="Replace it" pendingLabel="Generating…" danger />
            </form>
            <button
              type="button"
              onClick={() => setConfirmRegen(false)}
              className="rounded px-3 py-2 text-sm underline opacity-70"
            >
              Keep the current link
            </button>
          </div>
        </div>
      ) : null}

      {!token ? (
        <form action={genAction} className="self-start">
          <input type="hidden" name="groupId" value={groupId} />
          <Submit label="Generate link" pendingLabel="Generating…" />
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </section>
  )
}
