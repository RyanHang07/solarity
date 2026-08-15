"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { enforce } from "@/lib/ratelimit"
import { toMessage, type ActionResult } from "@/lib/errors"

/**
 * Mints a new invite link for a Circle.
 *
 * `create_invite_link` disables every enabled link for the Circle before
 * inserting, so this is a rotation and not an addition. The caller is
 * responsible for warning first: pressed a second time, it kills links people
 * are already holding. See `invite-panel.tsx`.
 *
 * No expiry is passed, so the RPC's 7 day default applies. A permanent link is
 * possible (`p_use_default_expiry = false`) and is deliberately not offered:
 * every live link is a bearer credential, and one that never dies is one
 * nobody remembers to revoke.
 */
export async function generateInviteLink(
  _prev: ActionResult<{ token: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ token: string }>> {
  const groupId = formData.get("groupId")?.toString() ?? ""
  if (!groupId) return { ok: false, error: "Missing Circle." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  try {
    await enforce("inviteLink", user.id)
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  // NOT_ADMIN, CIRCLE_INACTIVE and CIRCLE_FULL all arrive as hints that
  // `toMessage` resolves. Nothing is special-cased here.
  const { data, error } = await supabase.rpc("create_invite_link", {
    p_group_id: groupId,
  })
  if (error) return { ok: false, error: toMessage(error) }

  revalidatePath(`/circles/${groupId}/settings`)
  return { ok: true, data: { token: data as string } }
}

/**
 * Turns off every live link for a Circle without minting a successor.
 *
 * **This is the whole reason the action exists.** Regenerating already revokes,
 * but it hands you a new credential in the same breath, so killing a leaked
 * link meant creating one you then had to avoid sharing. Revoking and replacing
 * are separate acts here.
 *
 * **Deliberately not rate limited.** Every other write in the app is metered,
 * and this one is the exception on purpose: it is the kill switch for a leaked
 * bearer token. A cap on it means a link can outlive the owner's ability to
 * revoke it, which is precisely backwards. It is also cheap, idempotent and
 * available only to admins, so there is nothing worth bounding.
 *
 * No RPC: this is a single UPDATE governed by RLS, and `trg_audit_invite_toggle`
 * writes the `invite_link_toggled` row. Nothing needs to be atomic across
 * statements.
 */
export async function revokeInviteLink(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const groupId = formData.get("groupId")?.toString() ?? ""
  if (!groupId) return { ok: false, error: "Missing Circle." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  // No role check here: `invite_links_update_admin` is the authority. RLS
  // filters rather than erroring, so a plain member gets zero rows and reads
  // "no active link" rather than "you aren't allowed". Vaguer than ideal, and
  // unreachable in practice because nothing links a member to this page.
  const { data, error } = await supabase
    .from("invite_links")
    .update({ enabled: false })
    .eq("group_id", groupId)
    .eq("enabled", true)
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) {
    return { ok: false, error: "There's no active link to revoke." }
  }

  revalidatePath(`/circles/${groupId}/settings`)
  return { ok: true, data: undefined }
}
