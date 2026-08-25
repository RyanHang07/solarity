"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { enforce } from "@/lib/ratelimit"
import { containsProfanity } from "@/lib/profanity"
import { parseCheckinReference } from "@/lib/report-reference"
import { toMessage, type ActionResult } from "@/lib/errors"
import type { Database } from "@/lib/database.types"

/**
 * Steps 15d and 15e. Blocking, and reporting.
 *
 * **Both are plain table writes, and neither gets an RPC.** The policies
 * already say the right thing: `user_blocks_insert_own` and
 * `user_blocks_delete_own` are `blocker_user_id = auth.uid()`, and
 * `content_reports_insert_own` requires the reporter to be the caller, the
 * subject not to be the caller, and the two to share a Circle. A
 * `SECURITY DEFINER` function would restate all of that and become a second
 * place for it to drift.
 *
 * The actions exist so the writes stay metered and screened, which a direct
 * call from a component would skip.
 */

export type ReportType = Database["public"]["Enums"]["content_report_type"]

/** Mirrors the `char_length(reason) <= 500` CHECK. */
const REASON_MAX = 500

/**
 * The three types a person can file, and nothing else.
 *
 * **Checked rather than cast.** This used to do `contentType as ReportType` on
 * a string straight off a form, which is a lie to the type system: an
 * unrecognised value reached Postgres and came back as `22P02`, a code
 * `toMessage` has no case for and renders as "Something went wrong."
 *
 * `planet_avatar` is deliberately absent. It is in the enum, for a feature that
 * does not exist, and nothing should be able to file one.
 */
const REPORTABLE = ["user_profile", "checkin_photo", "checkin_note"] as const

/**
 * **`content_reference` has no length CHECK**, and it is `not null` text a
 * client supplies. Without this, a report could carry a megabyte of anything
 * into a table nobody reads yet.
 *
 * Both valid shapes are exact, so validating is a comparison rather than a
 * limit: a profile report names the account it is about, and a check-in report
 * is the composite `lib/report-reference.ts` builds and can parse back.
 */
function referenceIsValid(
  type: (typeof REPORTABLE)[number],
  reference: string,
  reportedUserId: string,
): boolean {
  if (type === "user_profile") return reference === reportedUserId
  return parseCheckinReference(reference) !== null
}

/**
 * Step 15d. Blocks somebody.
 *
 * **Blocking is mutual invisibility and nothing else.** Neither of you can see
 * the other's profile afterwards; you both stay in any Circle you share and
 * still appear on its roster. Hiding a blocked member from the roster was
 * considered and rejected in the plan: it would make the member count and the
 * group streak disagree between two people looking at the same Circle.
 *
 * **A second block is success, not an error.** `23505` means the row is
 * already there, which is the state the caller asked for. Reporting it would
 * be a failure message about something that is true.
 */
export async function blockUser(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const targetId = formData.get("userId")?.toString() ?? ""
  if (!targetId) return { ok: false, error: "Missing account." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  // Checked here as well as by the CHECK, because a constraint violation is a
  // bare `23514` that `toMessage` renders as "That value isn't allowed."
  if (targetId === user.id) return { ok: false, error: "You can't block yourself." }

  const { error } = await supabase
    .from("user_blocks")
    .insert({ blocker_user_id: user.id, blocked_user_id: targetId })

  if (error && error.code !== "23505") {
    return { ok: false, error: toMessage(error) }
  }

  revalidateAfterBlockChange()
  return { ok: true, data: undefined }
}

/**
 * **Three paths, and the dynamic one is the one that was missing.**
 *
 * Found by auditing 15d: blocking is done *from* `/profile/[username]`, and
 * that page must become a 404 the moment it succeeds. `revalidatePath("/profile")`
 * covers the literal path only — the person doing the blocking would have been
 * left sitting on a profile the product had just decided they cannot see, until
 * something else forced a load.
 *
 * The **route pattern**, not the resolved URL: `revalidatePath` takes the
 * segment shape for a dynamic route, and passing `/profile/someone` would
 * silently revalidate nothing.
 *
 * `/settings` is here because the blocked list lives there, and it is a
 * different route from either.
 */
function revalidateAfterBlockChange() {
  revalidatePath("/profile/[username]", "page")
  revalidatePath("/profile")
  revalidatePath("/settings")
}

/**
 * Step 15d. Unblocks somebody.
 *
 * **Reached from settings, never from their profile**, because their profile is
 * exactly what blocking hides. That is why migration 87 exists.
 */
export async function unblockUser(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const targetId = formData.get("userId")?.toString() ?? ""
  if (!targetId) return { ok: false, error: "Missing account." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_user_id", user.id)
    .eq("blocked_user_id", targetId)

  if (error) return { ok: false, error: toMessage(error) }

  revalidateAfterBlockChange()
  return { ok: true, data: undefined }
}

/**
 * The accounts you have blocked, for the list in settings.
 *
 * Through `blocked_accounts()` rather than a join, because
 * `users_select_self_or_groupmate` will not return someone you share no Circle
 * with — which would make the list quietly incomplete rather than obviously
 * broken. See migration 87.
 */
export async function blockedAccounts() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("blocked_accounts")

  if (error) {
    console.error("blocked_accounts failed", error)
    return []
  }
  return data ?? []
}

/**
 * Step 15e. Reports a photo, a note, or a profile.
 *
 * **Reporting is about content, not about a person, which is what the enum has
 * always said.** `checkin_photo` and `checkin_note` carry the entry id, so a
 * moderator can look at the exact thing complained about. `user_profile`, added
 * in migration 88, carries the reported account's id, because
 * `content_reference` is `not null` and a profile has no narrower handle.
 *
 * **Circle-mates only**, and that is the policy's rule rather than this
 * function's: `content_reports_insert_own` requires
 * `private.shares_group_with(reported_user_id)`. Profiles are open to any
 * signed-in user, so a stranger's profile shows no Report control — hiding the
 * button is the courtesy, the policy is the control.
 *
 * **The last rate limit in `lib/ratelimit.ts` to get a caller.** Ten a day, and
 * it was never missing one by oversight: it was waiting for this screen.
 */
export async function reportContent(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const reportedUserId = formData.get("userId")?.toString() ?? ""
  const contentType = formData.get("contentType")?.toString() ?? ""
  const contentReference = formData.get("contentReference")?.toString() ?? ""
  const reason = formData.get("reason")?.toString().trim() ?? ""

  if (!reportedUserId || !contentType || !contentReference) {
    return { ok: false, error: "Missing report details." }
  }

  // Narrowed here, so the cast at the insert is a fact rather than a hope.
  const type = REPORTABLE.find((t) => t === contentType)
  if (!type) return { ok: false, error: "Couldn't send that report." }

  if (!referenceIsValid(type, contentReference, reportedUserId)) {
    return { ok: false, error: "Couldn't send that report." }
  }
  if (reason.length > REASON_MAX) {
    return { ok: false, error: `Keep it under ${REASON_MAX} characters.` }
  }
  // Screened like every other free text a person can send. A report is read by
  // a human, so this is about what lands in front of them rather than about
  // what other members see.
  if (reason && containsProfanity(reason)) {
    return { ok: false, error: "Please reword that." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  if (reportedUserId === user.id) {
    return { ok: false, error: "You can't report yourself." }
  }

  try {
    await enforce("report", user.id)
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  const { error } = await supabase.from("content_reports").insert({
    reporter_user_id: user.id,
    reported_user_id: reportedUserId,
    content_type: type,
    content_reference: contentReference,
    // Empty means none. The column is nullable and a blank string would be a
    // reason that says nothing while looking like one that says something.
    reason: reason || null,
  })

  if (error) {
    /**
     * **A policy refusal here is a bare `42501` with no hint**, which
     * `toMessage` renders as "You don't have access to that." — true, and
     * useless beside a form somebody just filled in.
     *
     * `content_reports_insert_own` refuses for exactly one reason a person can
     * act on: you do not share a Circle with them. The UI hides the control in
     * that case, so reaching this means something disagreed — a stale page, or
     * a membership that ended while the form was open. Either way the sentence
     * should say what happened.
     *
     * Found by auditing 15e. The rule this codebase keeps relearning is that a
     * refusal with no hint becomes generic copy, and generic copy about a
     * specific rule is how an afternoon disappears.
     */
    if (error.code === "42501") {
      return {
        ok: false,
        error: "You can only report someone you share a Circle with.",
      }
    }
    return { ok: false, error: toMessage(error) }
  }
  return { ok: true, data: undefined }
}
