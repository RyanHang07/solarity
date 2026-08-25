"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { blockUser, reportContent } from "@/app/actions/moderation"
import type { ActionResult } from "@/lib/errors"

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border border-red-600 px-3 py-2 text-sm font-medium text-red-600 disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

/**
 * Steps 15d and 15e. Block and Report, on somebody else's profile.
 *
 * **Never rendered on your own**, and the page decides that rather than this
 * component: `/profile/[username]` redirects to `/profile` when the subject is
 * you, so this only ever sees a stranger.
 *
 * **Report appears for Circle-mates only.** `content_reports_insert_own`
 * requires `private.shares_group_with(reported_user_id)`, so a report about
 * somebody you share nothing with is refused by the database. Hiding the
 * control is the courtesy; the policy is the control.
 *
 * **Block does not check that.** You can block anyone whose profile you can
 * open, which since step 15 is anyone signed in — and that is right: blocking
 * is how you stop seeing someone, and needing to share a Circle first would
 * make it useless for the case it is most needed in.
 */
export function ProfileActions({
  userId,
  username,
  sharesCircle,
}: {
  userId: string
  username: string
  /** Whether the report policy would accept a report about this person. */
  sharesCircle: boolean
}) {
  const [blockState, blockAction] = useActionState<ActionResult | null, FormData>(
    blockUser,
    null,
  )
  const [reportState, reportAction] = useActionState<ActionResult | null, FormData>(
    reportContent,
    null,
  )
  const [confirmingBlock, setConfirmingBlock] = useState(false)
  const [reporting, setReporting] = useState(false)

  return (
    <section aria-label="Moderation" className="flex flex-col gap-3 border-t pt-6">
      {/* ------------------------------------------------------------ block */}
      {confirmingBlock ? (
        <div className="flex flex-col gap-2 rounded border border-red-600 px-3 py-2">
          <p className="text-sm">
            Block <strong>{username}</strong>?
          </p>
          {/*
            **Says what blocking does not do.** Someone expecting to disappear
            from a shared Circle would find out otherwise by opening it, which
            is a worse way to learn than reading it here.
          */}
          <p className="text-xs opacity-70">
            Neither of you will see the other&apos;s profile. You&apos;ll still
            see each other in any Circle you share, and they won&apos;t be told.
            You can undo this in settings.
          </p>
          <div className="flex gap-2">
            <form action={blockAction}>
              <input type="hidden" name="userId" value={userId} />
              <Submit label="Block" pendingLabel="Blocking…" />
            </form>
            <button
              type="button"
              onClick={() => setConfirmingBlock(false)}
              className="rounded px-3 py-2 text-sm underline opacity-70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => setConfirmingBlock(true)}
            className="text-sm underline opacity-70"
          >
            Block {username}
          </button>

          {sharesCircle && !reporting ? (
            <button
              type="button"
              onClick={() => setReporting(true)}
              className="text-sm underline opacity-70"
            >
              Report this profile
            </button>
          ) : null}
        </div>
      )}

      {/* ----------------------------------------------------------- report */}
      {reporting && !confirmingBlock ? (
        <form action={reportAction} className="flex flex-col gap-2 rounded border px-3 py-2">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="contentType" value="user_profile" />
          {/*
            `content_reference` is `not null`, and a profile has no narrower
            handle than the account itself. Redundant with `userId` above and
            kept so a moderator can find any report from its reference alone,
            whatever its type.
          */}
          <input type="hidden" name="contentReference" value={userId} />

          <label htmlFor="report-reason" className="text-sm">
            What&apos;s wrong with this profile?
          </label>
          <textarea
            id="report-reason"
            name="reason"
            rows={3}
            maxLength={500}
            className="rounded border px-3 py-2 text-sm"
          />
          <p className="text-xs opacity-60">
            Optional, up to 500 characters. Reports are read by a person, and{" "}
            {username} isn&apos;t told who reported them.
          </p>
          <div className="flex gap-2">
            <Submit label="Send report" pendingLabel="Sending…" />
            <button
              type="button"
              onClick={() => setReporting(false)}
              className="rounded px-3 py-2 text-sm underline opacity-70"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {reportState?.ok ? (
        // **Says it was received, not what will happen.** There is no
        // moderation console yet, so a promise about review would be one the
        // product cannot keep.
        <p role="status" className="text-sm">
          Report sent. Thanks — someone will look at it.
        </p>
      ) : null}

      {[blockState, reportState].map((st, i) =>
        st && !st.ok ? (
          <p key={i} role="alert" className="text-sm text-red-600">
            {st.error}
          </p>
        ) : null,
      )}
    </section>
  )
}
