"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { reportContent, type ReportType } from "@/app/actions/moderation"
import { checkinReference } from "@/lib/report-reference"
import type { ActionResult } from "@/lib/errors"

/**
 * Step 15e. Reporting a photo or a note, where you are looking at it.
 *
 * **On the roster rather than on a profile, because that is what the enum has
 * always said.** `content_report_type` is about content, and a report a
 * moderator can act on names the thing complained about — not the person who
 * posted it.
 *
 * **Only rendered for Circle-mates**, which on this screen is everyone: you are
 * inside a Circle you belong to, so `shares_group_with` is satisfied by being
 * here at all. That is why this component has no equivalent of the profile
 * page's `sharesCircle` prop.
 *
 * **Collapsed until asked for.** A Circle of ten members with photos is twenty
 * report controls nobody wants to see, and a report button beside every piece
 * of a friend's day sets the wrong tone for a screen about encouragement.
 */
export function ReportCheckin({
  userId,
  goalId,
  checkinDate,
  contentType,
  label,
}: {
  userId: string
  goalId: string
  checkinDate: string
  contentType: Extract<ReportType, "checkin_photo" | "checkin_note">
  /** What is being reported, in the person's own words: "photo" or "note". */
  label: string
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    reportContent,
    null,
  )
  const [open, setOpen] = useState(false)

  if (state?.ok) {
    // No form to return to. Re-offering the control invites a second report
    // about the same thing, which costs the reporter one of ten a day and tells
    // a moderator nothing new.
    return <span className="text-xs opacity-60">Reported. Thanks.</span>
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-xs underline opacity-50"
      >
        Report this {label}
      </button>
    )
  }

  return (
    <form action={action} className="flex flex-col gap-2 rounded border px-2 py-2">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="contentType" value={contentType} />
      {/*
        Built from three things this viewer already holds. The roster returns
        `entry_id` for your own rows only, and a photo's signed URL expires in
        an hour, so neither is a reference a report can keep.
      */}
      <input
        type="hidden"
        name="contentReference"
        value={checkinReference(userId, goalId, checkinDate)}
      />

      <label className="text-xs">
        What&apos;s wrong with this {label}?
        <textarea
          name="reason"
          rows={2}
          maxLength={500}
          className="mt-1 w-full rounded border px-2 py-1 text-xs"
        />
      </label>

      <div className="flex items-center gap-2">
        <Submit />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs underline opacity-70"
        >
          Cancel
        </button>
      </div>

      {state && !state.ok ? (
        <span role="alert" className="text-xs text-red-600">
          {state.error}
        </span>
      ) : null}
    </form>
  )
}

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border px-2 py-1 text-xs font-medium disabled:opacity-50"
    >
      {pending ? "Sending…" : "Send report"}
    </button>
  )
}
