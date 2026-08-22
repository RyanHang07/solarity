"use server"

import { createClient } from "@/lib/supabase/server"
import { toMessage, type ActionResult } from "@/lib/errors"
import { TAB_NOTIFICATION_TYPES } from "@/lib/notification-types"

/**
 * Marks everything you have not read as read.
 *
 * **No migration was needed, and that was checked rather than assumed.**
 * `authenticated` already holds `SELECT` on every column of `notifications` and
 * `UPDATE` on **`read_at` alone** — exactly this and nothing wider. Skipping
 * that check on `goal_group_visibility` in 8h-2 cost a debugging session, since
 * grants are evaluated before RLS and a missing one surfaces as a bare `42501`
 * that reads like a permissions bug in the wrong place.
 *
 * **Deliberately does not `revalidatePath`.** The dashboard renders an unread
 * count; revalidating would re-run the page, which re-mounts the component that
 * calls this, which calls it again. The count may be one navigation stale. A
 * render loop may not be.
 *
 * **Scoped by `read_at is null`** so a repeat call writes nothing at all, and
 * the timestamp records when you first looked rather than the last time a tab
 * re-mounted.
 *
 * **And scoped by type, since 11c.** Digests are not rendered in that list any
 * more, so marking them read here would claim you had read something the app
 * deliberately did not show you. `read_at` simply does not apply to a digest;
 * see `lib/notification-types.ts`.
 */
export async function markNotificationsRead(): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  // `.eq("user_id", …)` alongside the policy, not instead of it. RLS bounds
  // what you *may* write; this states what this action *means* to write, and a
  // reader should not have to go and check a policy to know whose rows these
  // are.
  const { error } = await supabase
    .from("notifications")
    // `"now"` is the transaction time, from the database. No CHECK guards this
    // column, so a skewed clock here would not error: it would quietly record
    // that you read a notification in the future, and every later comparison
    // would be wrong with nothing to notice it. That is the worse failure of
    // the two, which is why both writers use the same rule.
    .update({ read_at: "now" })
    .eq("user_id", user.id)
    .is("read_at", null)
    .in("type", TAB_NOTIFICATION_TYPES)

  if (error) return { ok: false, error: toMessage(error) }
  return { ok: true, data: undefined }
}
