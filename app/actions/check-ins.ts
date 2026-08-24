"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getCheckinDate } from "@/lib/supabase/checkin-date"
import { enforce } from "@/lib/ratelimit"
import { toMessage, type ActionResult } from "@/lib/errors"
import { PHOTO_BUCKET, photoKey } from "@/lib/photo-upload"

const NOTE_MAX = 500

/**
 * Checks a goal off for today.
 *
 * **The date is never sent by the client.** `check_in_date` comes from
 * `public.current_checkin_date()`, and the INSERT policy independently requires
 * the submitted value to equal that function's result. Even a hand-crafted
 * request cannot backdate a check-in and fabricate an unbroken streak.
 *
 * The extra round trip to fetch the date is deliberate. Computing it in
 * TypeScript would be a second implementation of "now in the user's frozen
 * timezone, minus two hours", drifting across DST, and failing as an opaque RLS
 * rejection rather than a wrong number.
 */
export async function checkIn(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const goalId = formData.get("goalId")?.toString() ?? ""
  const note = formData.get("note")?.toString().trim() || null

  if (!goalId) return { ok: false, error: "Missing goal." }
  if (note && note.length > NOTE_MAX) {
    return { ok: false, error: `Notes are limited to ${NOTE_MAX} characters.` }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  try {
    await enforce("checkIn", user.id)
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  const today = await getCheckinDate(supabase)
  if (!today) return { ok: false, error: "Couldn't work out today's date." }

  // Opt-in, and absent means false. A checkbox that is not ticked sends no
  // field at all, so the default has to be the private one for the form to be
  // safe when someone ignores it. See migration 66.
  const noteShared = formData.get("noteShared") === "on"

  const { error } = await supabase.from("progress_entries").insert({
    goal_id: goalId,
    user_id: user.id,
    check_in_date: today,
    note,
    note_shared: note ? noteShared : false,
  })

  if (error) {
    // A second check-in on the same goal and day hits the unique constraint.
    // That is the normal outcome of a double-tap or a stale tab, not a fault,
    // so it reads as a statement of fact rather than an error.
    if (error.code === "23505") {
      return { ok: false, error: "Already checked in today." }
    }
    return { ok: false, error: toMessage(error) }
  }

  revalidatePath("/dashboard")
  // Deliberately not revalidating any Circle page: a check-in changes your
  // counts on every Circle you belong to, and this action does not know which.
  // The roster picks it up on the next visit, which is 8g phase 1.
  return { ok: true, data: undefined }
}

/**
 * Undoes today's check-in.
 *
 * Deleting is correct here rather than a soft flag: an un-checked goal is not
 * an event that happened, and `progress_entries_maintain_completion` fires on
 * DELETE too, so `daily_completion` recomputes either way.
 *
 * Scoped to today. The policy permits deleting any of your own entries, so
 * the date filter is the app declining to offer time travel rather than a
 * security boundary.
 */
export async function undoCheckIn(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const goalId = formData.get("goalId")?.toString() ?? ""
  if (!goalId) return { ok: false, error: "Missing goal." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const today = await getCheckinDate(supabase)
  if (!today) return { ok: false, error: "Couldn't work out today's date." }

  /**
   * **The object goes before the row, and that ordering is not arbitrary.**
   *
   * `purge-expired-photos` finds objects *through* `photo_url`, so a row deleted
   * while its file survives leaves an object nobody can reach and no job will
   * ever clean up. Reversed, a crash between the two steps leaves a row naming a
   * file that is gone — a broken image at worst, and self-healing on the next
   * remove. `security.md` section 9 sets the same order for the purge job.
   *
   * A failed delete does **not** stop the undo. Someone who tapped Undo should
   * not be told "no" because Storage was briefly unavailable; the cost is one
   * orphan, which is what 13e's sweep exists for.
   */
  const { data: entry } = await supabase
    .from("progress_entries")
    .select("id, photo_url")
    .eq("goal_id", goalId)
    .eq("check_in_date", today)
    .maybeSingle()

  if (entry?.photo_url) {
    await supabase.storage.from(PHOTO_BUCKET).remove([entry.photo_url])
  }

  const { data, error } = await supabase
    .from("progress_entries")
    .delete()
    .eq("goal_id", goalId)
    .eq("check_in_date", today)
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) return { ok: false, error: "Nothing to undo for today." }

  revalidatePath("/dashboard")
  // Deliberately not revalidating any Circle page: a check-in changes your
  // counts on every Circle you belong to, and this action does not know which.
  // The roster picks it up on the next visit, which is 8g phase 1.
  return { ok: true, data: undefined }
}

/**
 * Shares or un-shares an existing note.
 *
 * **Separate from `checkIn` because the decision outlives the moment.** People
 * misjudge what they want visible while writing it, and this is text about
 * their own life, so it has to be retractable. The flag is read at query time
 * by `circle_roster`, which makes un-sharing retroactive for free: no backfill,
 * no cache, nothing to undo.
 *
 * No rate limit. It is a boolean on a row you already own, and metering it
 * would mean a note you regret could not be pulled back.
 *
 * No `.eq("user_id", …)`: `progress_entries_update_own` is exactly
 * `user_id = auth.uid()`, so the policy predicate and the filter would be the
 * same expression. RLS filters silently, so the affected-row count is the only
 * evidence the write landed.
 */
export async function setNoteSharing(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const entryId = formData.get("entryId")?.toString() ?? ""
  const shared = formData.get("shared") === "true"
  // Optional, and only used to revalidate the page the control was pressed on.
  // Never trusted for authorisation: the update is scoped by RLS to your own
  // rows regardless of what a form claims.
  const groupId = formData.get("groupId")?.toString() ?? ""
  if (!entryId) return { ok: false, error: "Missing check-in." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { data, error } = await supabase
    .from("progress_entries")
    .update({ note_shared: shared })
    .eq("id", entryId)
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) {
    return { ok: false, error: "That check-in isn't yours, or no longer exists." }
  }

  revalidatePath("/dashboard")
  // The roster is where this control lives, so without this the toggle writes
  // correctly and the screen keeps showing the old state, which reads as the
  // action having failed.
  if (groupId) revalidatePath(`/circles/${groupId}`)
  return { ok: true, data: undefined }
}

/* ------------------------------------------------------------------- 13c --
 * Photos.
 */

/**
 * Records that a photo now exists for a check-in.
 *
 * **The key is derived here, never accepted from the caller, and that is the
 * whole security argument.** `photo_url` is free text with no constraint, and
 * `circle_roster` hands its value to your Circle. A caller who could choose it
 * would set it to *someone else's* object key, and their circle-mates would be
 * served a stranger's private photo by a signed URL our own server minted. So
 * the action takes an entry id, reads the owner and goal off the row it is
 * allowed to see, and writes the one key that row could ever have.
 *
 * Which also means the client cannot upload anywhere else and have it counted:
 * a file placed at any other path is never referenced, and 13e's sweep removes
 * it.
 *
 * **Spends the `photoUpload` limit**, which has been declared since the start
 * with no caller. Metered here rather than at the upload because this is the
 * step that makes an object visible to other people.
 */
export async function attachCheckinPhoto(entryId: string): Promise<ActionResult> {
  if (!entryId) return { ok: false, error: "Missing check-in." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  try {
    await enforce("photoUpload", user.id)
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  // RLS scopes this to your own rows, so a missing row and someone else's row
  // are the same answer, which is the answer both should get.
  const { data: entry } = await supabase
    .from("progress_entries")
    .select("id, goal_id, user_id")
    .eq("id", entryId)
    .maybeSingle()

  if (!entry?.goal_id || !entry.user_id) {
    return { ok: false, error: "That check-in is no longer there." }
  }

  const { data, error } = await supabase
    .from("progress_entries")
    .update({ photo_url: photoKey(entry.user_id, entry.goal_id, entry.id) })
    .eq("id", entryId)
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) return { ok: false, error: "That check-in is no longer there." }

  revalidatePath("/dashboard")
  revalidatePath("/today")
  return { ok: true, data: undefined }
}

/**
 * Deletes the photo and keeps the check-in.
 *
 * **A separate control from Undo on purpose.** The case people actually hit is
 * a blurry or wrong photo, and making them undo the whole check-in to fix it
 * would put a streak calculation in the path of a cosmetic mistake.
 *
 * **Not rate limited.** Deleting is not uploading, and metering it would mean a
 * run of bad photos locks you out of fixing them: a limiter punishing the
 * correction rather than the abuse.
 *
 * Object first, then the column, for the reason in `undoCheckIn`.
 */
export async function removeCheckinPhoto(entryId: string): Promise<ActionResult> {
  if (!entryId) return { ok: false, error: "Missing check-in." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { data: entry } = await supabase
    .from("progress_entries")
    .select("id, photo_url")
    .eq("id", entryId)
    .maybeSingle()

  if (!entry) return { ok: false, error: "That check-in is no longer there." }

  if (entry.photo_url) {
    const { error } = await supabase.storage.from(PHOTO_BUCKET).remove([entry.photo_url])
    // Here the failure *does* stop the write, unlike in `undoCheckIn`. Nulling
    // the column while the file survives would orphan it with nothing left to
    // name it, and the person asked for the photo to be gone rather than for
    // the row to stop mentioning it.
    if (error) return { ok: false, error: "Couldn't remove the photo. Try again." }
  }

  const { error } = await supabase
    .from("progress_entries")
    .update({ photo_url: null })
    .eq("id", entryId)

  if (error) return { ok: false, error: toMessage(error) }

  revalidatePath("/dashboard")
  revalidatePath("/today")
  return { ok: true, data: undefined }
}
