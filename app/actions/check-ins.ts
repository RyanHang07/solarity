"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getCheckinDate } from "@/lib/supabase/checkin-date"
import { enforce } from "@/lib/ratelimit"
import { toMessage, type ActionResult } from "@/lib/errors"

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

  const { error } = await supabase.from("progress_entries").insert({
    goal_id: goalId,
    user_id: user.id,
    check_in_date: today,
    note,
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

  const { data, error } = await supabase
    .from("progress_entries")
    .delete()
    .eq("goal_id", goalId)
    .eq("check_in_date", today)
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) return { ok: false, error: "Nothing to undo for today." }

  revalidatePath("/dashboard")
  return { ok: true, data: undefined }
}
