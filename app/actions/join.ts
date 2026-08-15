"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { enforce } from "@/lib/ratelimit"
import { clientIp } from "@/lib/request-identity"
import { toMessage, type ActionResult } from "@/lib/errors"

/**
 * The four hints that mean "this link is dead". They collapse into one notice
 * and one redirect, rather than four tailored messages on the page.
 *
 * **Collapsing them is the security half of the decision.** Distinguishing
 * `INVITE_INVALID` (no such token) from `INVITE_REVOKED` (real token, turned
 * off) confirms to anyone guessing that a given token was once real. It also
 * matches `join_circle`, which already answers `INVITE_INVALID` when the
 * inviter has blocked you, so a blocked person cannot tell they were blocked
 * apart from a link that simply died.
 *
 * `CIRCLE_FULL`, `CIRCLE_LOCKED` and `CIRCLE_ARCHIVED` are deliberately absent.
 * Those are true statements about a Circle that still exists and that the
 * person may yet be able to join, so they stay on the page.
 */
const DEAD_LINK = new Set([
  "INVITE_INVALID",
  "INVITE_REVOKED",
  "INVITE_EXPIRED",
  "CIRCLE_ORPHANED",
])

/**
 * Joins a Circle from an invite token.
 *
 * **Idempotent by way of the RPC.** `join_circle` returns the group id without
 * writing anything if you are already a member, so a double-tap or a stale tab
 * lands on the Circle rather than erroring. That is also why success redirects
 * rather than returning: there is nothing left to look at on the join page.
 */
export async function joinCircle(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const token = formData.get("token")?.toString() ?? ""
  if (!token) return { ok: false, error: "Missing invite." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/auth/sign-in?next=/join/${encodeURIComponent(token)}`)

  // Joining writes a membership row, a cycle-stats row, an audit row and one
  // notification per existing member, so it is metered before the call.
  //
  // Two keys, deliberately not three. The per-user cap bounds one account, the
  // per-IP cap bounds one machine running several accounts.
  //
  // **The per-token limit is on the preview, not here.** A cap on *joins* per
  // token would let anyone holding a link lock out the people it was shared
  // with, which is the failure already rejected for the `failed_attempts`
  // counter: a limiter must never disable the resource it protects.
  try {
    await enforce("joinCircle", user.id)
    await enforce("inviteAttempt", await clientIp())
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  const { data, error } = await supabase.rpc("join_circle", { p_token: token })

  if (error) {
    if (error.hint && DEAD_LINK.has(error.hint)) {
      redirect("/dashboard?notice=invite-invalid")
    }
    return { ok: false, error: toMessage(error) }
  }

  revalidatePath("/dashboard")
  redirect(`/circles/${data as string}`)
}
