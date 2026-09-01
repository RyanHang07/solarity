"use server"

import { revalidatePath } from "next/cache"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { PHOTO_BUCKET } from "@/lib/photo-upload"
import { PHOTO_URL_TTL_SECONDS } from "@/lib/supabase/photo-urls"
import { toMessage, type ActionResult } from "@/lib/errors"
import type { Database } from "@/lib/database.types"

/**
 * Step 17. Everything `/admin` can do.
 *
 * **Every function here is a thin wrapper.** The authorisation lives in the
 * database: each RPC calls `private.is_admin()` as its first statement and
 * raises `NOT_SITE_ADMIN` otherwise. Nothing in this file decides who may do
 * what, and that is the point — a check here would be a second place the rule
 * lives, and the one a request could route around.
 */

export type ReportStatus = Database["public"]["Enums"]["content_report_status"]

/**
 * Whether the caller is a site admin.
 *
 * The route gate. Returns false on any error, because the safe answer to "are
 * you allowed in" is no — including when the question could not be asked.
 */
export async function amIAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("am_i_admin")
  if (error) {
    console.error("am_i_admin failed", error)
    return false
  }
  return data === true
}

export async function reportQueue(status: ReportStatus = "pending") {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("admin_report_queue", {
    p_status: status,
  })
  if (error) {
    console.error("admin_report_queue failed", error)
    return []
  }
  return data ?? []
}

/**
 * One report, with the reported item and a URL for its photo.
 *
 * **The photo is signed with the service key**, and this is the only place in
 * the app that does so for someone else's object. `checkin_photos_select` will
 * not sign a stranger's photo for an admin, and it should not: widening it
 * would give every admin standing access to every photo in the product.
 * Signing here is scoped to one key, from one report, that somebody else chose
 * to raise — the same shape as the RPC that returned it.
 */
export async function reportDetail(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc("admin_report_detail", { p_report_id: id })
    .maybeSingle()

  if (error) {
    console.error("admin_report_detail failed", error)
    return null
  }
  if (!data) return null

  let photoUrl: string | null = null
  if (data.photo_key) {
    const admin = createAdminClient()
    const { data: signed, error: signError } = await admin.storage
      .from(PHOTO_BUCKET)
      .createSignedUrl(data.photo_key, PHOTO_URL_TTL_SECONDS)

    // A photo that will not sign is a report about an image that has since been
    // purged by retention. The report is still reviewable; say so on the page
    // rather than failing to render it.
    if (signError) console.error("signing a reported photo failed", signError)
    photoUrl = signed?.signedUrl ?? null
  }

  return { ...data, photoUrl }
}

export async function resolveReport(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const id = formData.get("reportId")?.toString() ?? ""
  const status = formData.get("status")?.toString() ?? ""

  if (!id) return { ok: false, error: "Missing report." }
  // Narrowed rather than cast, for the reason `reportContent` had to learn: a
  // value Postgres rejects comes back as `22P02` with no readable copy.
  const allowed: ReportStatus[] = ["pending", "reviewed", "actioned", "dismissed"]
  const next = allowed.find((s) => s === status)
  if (!next) return { ok: false, error: "Pick an outcome." }

  const supabase = await createClient()
  const { error } = await supabase.rpc("admin_resolve_report", {
    p_report_id: id,
    p_status: next,
  })
  if (error) return { ok: false, error: toMessage(error) }

  revalidatePath("/admin")
  revalidatePath("/admin/reports/[id]", "page")
  return { ok: true, data: undefined }
}

export async function listAdmins() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("admin_list_admins")
  if (error) {
    console.error("admin_list_admins failed", error)
    return []
  }
  return data ?? []
}

/**
 * Grants or revokes admin, by username.
 *
 * **By username rather than by id**, because an id is not something a person
 * has. It is resolved through `profile_by_username`, which is the same lookup
 * the profile page uses — so an account that has blocked this admin resolves to
 * nothing and cannot be promoted from here. That is a real edge and the right
 * one to accept: the alternative is a second lookup that ignores blocking, and
 * a promotion path is not the place to introduce one.
 *
 * The three guards that matter — caller is an admin, no self-change, no
 * revoking the last one — are in `admin_set_role`, and the audit row is written
 * there too.
 */
export async function setRole(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const username = formData.get("username")?.toString().trim() ?? ""
  const role = formData.get("role")?.toString() === "admin" ? "admin" : "standard"
  if (!username) return { ok: false, error: "Type a username." }

  const supabase = await createClient()
  const { data: found, error: lookupError } = await supabase
    .rpc("profile_by_username", { p_username: username })
    .maybeSingle()

  if (lookupError) return { ok: false, error: toMessage(lookupError) }
  if (!found) return { ok: false, error: `No account called ${username}.` }

  const { error } = await supabase.rpc("admin_set_role", {
    p_user_id: found.user_id,
    p_role: role,
  })
  if (error) return { ok: false, error: toMessage(error) }

  revalidatePath("/admin/people")
  return { ok: true, data: undefined }
}
