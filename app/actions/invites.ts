"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { enforce } from "@/lib/ratelimit"
import { signAvatars } from "@/lib/supabase/avatar-urls"
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

/**
 * Step 18a. Somebody to invite, by the start of their username.
 *
 * **A read, and still a server action.** It could have been a route handler,
 * but every other database call the invite panel makes is an action and the
 * rate limit has to live on the server either way. One shape for the panel to
 * call.
 *
 * **`p_group_id` is passed so the results are actionable.** Without it, the
 * people already in the Circle come back and every one of them is a button
 * that will refuse. `search_users` does the exclusion in the same query rather
 * than the panel filtering afterwards, because the ten-row cap is applied by
 * the database: filtering here would silently return fewer than ten.
 *
 * **An empty array for a refusal, never an exception.** A search box that
 * throws is a search box that breaks the page under someone's fingers. The
 * limit and the three-character floor both come back as "nothing found", which
 * is also what they look like.
 */
export type FoundUser = { id: string; username: string; avatarUrl: string | null }

export async function searchUsers(
  query: string,
  groupId: string,
): Promise<ActionResult<FoundUser[]>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  try {
    await enforce("searchUsers", user.id)
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  const { data, error } = await supabase.rpc("search_users", {
    p_query: query,
    p_group_id: groupId,
  })

  if (error) return { ok: false, error: toMessage(error) }

  const rows = data ?? []

  /**
   * **Signed here, in one batch, because the results arrive after render.**
   *
   * Every other avatar surface signs in a server component, where the keys are
   * known before the page exists. A search result is not: it comes back from
   * this action, and a client that received bare keys could not turn them into
   * anything. `signAvatars` returns a map and drops failures, so a key that
   * will not sign is a set of initials rather than a broken row.
   */
  const signed = await signAvatars(
    supabase,
    rows.map((r) => r.avatar_url),
  )

  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      username: row.username,
      avatarUrl: row.avatar_url ? (signed.get(row.avatar_url) ?? null) : null,
    })),
  }
}

/**
 * Step 18b. Put an invite in front of a named person.
 *
 * **Every refusal is a hint with copy**, so `ALREADY_MEMBER`,
 * `INVITE_LINK_MISSING`, `CIRCLE_FULL`, `CIRCLE_INACTIVE`, `NOT_A_MEMBER` and
 * `NOT_FOUND` all read as sentences. The last of those covers a blocked pair
 * *and* an id that names nobody, deliberately: see `lib/errors.ts`.
 *
 * **No `revalidatePath`.** Nothing on this page changes. The row lands in the
 * recipient's notifications, which is their render, not ours, and the panel
 * says what happened from the action's own result.
 */
export async function inviteUser(
  groupId: string,
  userId: string,
): Promise<ActionResult> {
  if (!groupId || !userId) return { ok: false, error: "Missing Circle or person." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  try {
    await enforce("inviteUser", user.id)
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  const { error } = await supabase.rpc("invite_user_to_circle", {
    p_group_id: groupId,
    p_user_id: userId,
  })

  if (error) return { ok: false, error: toMessage(error) }
  return { ok: true, data: undefined }
}
