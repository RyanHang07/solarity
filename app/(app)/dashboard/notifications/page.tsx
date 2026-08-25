import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { NotificationsPanel, type NotificationRow } from "../notifications-panel"
import { PushNudge } from "@/components/push-nudge"
import { pushNudgeDismissed } from "@/lib/push-nudge"
import { TAB_NOTIFICATION_TYPES } from "@/lib/notification-types"
import { readMemberships } from "../memberships"

export const metadata = { title: "Notifications" }

/**
 * Step 14a. The notifications reader.
 *
 * Reached at `/dashboard/notifications`; `/dashboard?tab=notifications`
 * redirects here.
 *
 * **The unread count is read in the layout, not here**, because it renders on
 * this section's *label* — a badge you can only see after opening the thing it
 * counts is not a badge. It is also therefore stale by the time this list marks
 * everything read, which is what `MarkRead`'s `router.refresh()` repairs.
 */
export default async function NotificationsSectionPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")
  const userId = user.id

  const [{ active, inactive }, nudgeDismissed, { data: rows }, { count: unread }] =
    await Promise.all([
      readMemberships(supabase, userId),

      // 10f. One cookie, no query.
      pushNudgeDismissed(),

      supabase
        .from("notifications")
        .select("id, type, created_at, read_at, payload")
        .eq("user_id", userId)
        // Filtered by type rather than by read state: a digest must not appear
        // here whether or not anything ever marked it read.
        .in("type", TAB_NOTIFICATION_TYPES)
        .order("created_at", { ascending: false })
        .limit(100),

      /**
       * **Counted again here, and not taken from the layout.**
       *
       * `MarkRead` only fires when this number is above zero, and the layout's
       * copy is whatever it was when you entered the dashboard — which on a
       * section switch is a value the layout is no longer re-rendering to
       * update. Reading it beside the rows means the decision to mark is made
       * from what is true now. `head: true` costs a count and no rows.
       */
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("read_at", null)
        .in("type", TAB_NOTIFICATION_TYPES),
    ])

  // The live name, keyed by id. `payload.group_id` has no foreign key, so a
  // Circle can be gone; those fall back to the stored copy. See migration 73.
  const names = new Map<string, string>()
  for (const m of [...active, ...inactive]) {
    if (m.groups?.name) names.set(m.group_id, m.groups.name)
  }

  const notifications = (rows ?? []).map((n): NotificationRow => {
    const payload = (n.payload ?? {}) as Record<string, unknown>
    const groupId = typeof payload.group_id === "string" ? payload.group_id : null
    const stored = typeof payload.circle_name === "string" ? payload.circle_name : null

    return {
      id: n.id,
      type: n.type,
      createdAt: new Date(n.created_at).toLocaleString(),
      readAt: n.read_at,
      circleName: groupId ? (names.get(groupId) ?? null) : null,
      storedCircleName: stored,
      groupId,
      payload,
    }
  })

  return (
    <>
      {/* 10f. Above the list, and only for people who never decided. The cookie
          is read on the server because a client component cannot; everything
          else it needs is client-side. */}
      <PushNudge dismissed={nudgeDismissed} />
      <NotificationsPanel rows={notifications} unread={unread ?? 0} />
    </>
  )
}
