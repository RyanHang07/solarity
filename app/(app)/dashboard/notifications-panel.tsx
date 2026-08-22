"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { markNotificationsRead } from "@/app/actions/notifications"

export type NotificationRow = {
  id: string
  type: string
  createdAt: string
  readAt: string | null
  /** Live from `groups`, or null when the Circle is gone. */
  circleName: string | null
  /** The frozen copy in the payload, used only when the live name is missing. */
  storedCircleName: string | null
  groupId: string | null
  payload: Record<string, unknown>
}

/**
 * 8f-4 and 8f-5: the reader `notifications` has never had.
 *
 * Rows have been written since the 13th and nothing has ever displayed one, so
 * `read_at` was a column with no writer and 52 rows sat unread. Same shape as
 * 8h, one layer up.
 *
 * **Four types, not five, since 11c.** Digests moved to the day boxes on
 * Overview, and were 69 of the 70 rows here — burying the handful that might
 * actually need a response. The query filters by type; this component renders
 * whatever it is given.
 */

/** Marks everything read once the list has actually rendered. */
function MarkRead({ unread }: { unread: number }) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current || unread === 0) return
    fired.current = true
    // Fire and forget. A failure here means the badge is still there next time,
    // which is the harmless direction, and an error banner over a list you have
    // plainly just read would be noise about nothing you asked for.
    void markNotificationsRead()
  }, [unread])

  return null
}

/**
 * The Circle's name, and whether it can still be linked to.
 *
 * Live name first: a rename is the same Circle, and showing last month's name
 * reads as a bug. The stored copy is the fallback for when the Circle is gone,
 * which is reachable because `payload.group_id` is a jsonb value with no
 * foreign key — nothing stops a Circle being deleted out from under a
 * notification about it. See migration 73.
 */
function circleLabel(n: NotificationRow) {
  if (n.circleName) return { name: n.circleName, gone: false }
  if (n.storedCircleName) return { name: n.storedCircleName, gone: true }
  return { name: "A Circle", gone: true }
}

function describe(n: NotificationRow): string {
  const { name } = circleLabel(n)
  const p = n.payload

  switch (n.type) {
    // **No `digest` case, since 11c.** The query feeding this list filters by
    // type, so one cannot arrive here; a branch for it would be code with no
    // reader. If one ever did leak through, the default below says something
    // dull and true rather than nothing.
    case "invite_accepted": {
      const who = typeof p.joined_username === "string" ? p.joined_username : "Someone"
      return `${who} joined ${name}`
    }
    case "kicked":
      return `You were removed from ${name}`
    case "group_locked_renewal":
      return `${name} has finished its cycle`
    case "deadline_changed":
      return `${name} changed its deadline`
    default:
      // All five declared types are handled above, and all five have writers.
      // This branch is for the sixth: an enum value added by a migration whose
      // renderer has not landed yet, which is a state the database can be in
      // for as long as it takes someone to notice.
      //
      // **Never print a raw payload key or the type itself.** Both are database
      // values, and this is the branch most likely to meet an unfamiliar one.
      return `Something happened in ${name}`
  }
}

/** Where a row goes, or null when it should not be a link at all. */
function hrefFor(n: NotificationRow): string | null {
  const { gone } = circleLabel(n)
  if (gone || !n.groupId) return null
  // Not `kicked`: you are no longer a member, so the link would land on a
  // redirect, and offering it reads as a way back in.
  if (n.type === "kicked") return null
  return `/circles/${n.groupId}`
}

export function NotificationsPanel({
  rows,
  unread,
}: {
  rows: NotificationRow[]
  unread: number
}) {
  return (
    <section aria-label="Notifications" className="flex flex-col gap-3">
      <MarkRead unread={unread} />
      <h2 className="text-lg font-semibold">Notifications</h2>

      {rows.length === 0 ? (
        <p className="text-sm opacity-70">Nothing yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((n) => {
            const href = hrefFor(n)
            const { gone } = circleLabel(n)
            const body = (
              <span className="flex flex-col gap-0.5">
                <span>
                  {describe(n)}
                  {gone ? (
                    <span className="opacity-60"> (no longer available)</span>
                  ) : null}
                </span>
                <span className="text-xs opacity-60">{n.createdAt}</span>
              </span>
            )

            return (
              <li
                key={n.id}
                // Unread is styled from the row's own `read_at`, which is the
                // server's value at render time. The mark-read write happens
                // after this paints, so the list you are looking at still shows
                // which ones were new when you opened it.
                className={`rounded border px-3 py-2 text-sm ${
                  n.readAt ? "opacity-60" : "font-medium"
                }`}
              >
                {href ? <Link href={href}>{body}</Link> : body}
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-xs opacity-60">
        Notifications are kept for 90 days.
      </p>
    </section>
  )
}
