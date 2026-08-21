"use server"

import { revalidatePath } from "next/cache"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { enforce } from "@/lib/ratelimit"
import { containsProfanity } from "@/lib/profanity"
import { toMessage, type ActionResult } from "@/lib/errors"

/** Mirrors users_username_format, so a refusal is a sentence and not a 23514. */
const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/

/**
 * The settings page holds only controls whose backend already exists.
 *
 * That is a rule, not a coincidence. A switch over a function nobody wrote is
 * exactly the shape 8h spent two migrations removing: `goal_group_visibility`
 * had policies, grants and two consumers enforcing it, and no writer, for
 * weeks. Push has no subscribe flow and account deletion has no confirmation
 * flow, so neither appears here yet.
 */

/**
 * Renames you, through the same RPC onboarding uses.
 *
 * `complete_onboarding` is deliberately both paths: it decides which by whether
 * a username already exists, and it enforces the once-per-14-days limit itself,
 * raising `USERNAME_RENAME_TOO_SOON`, which `lib/errors.ts` already resolves.
 * A second RPC would be a second place for that limit to drift.
 *
 * **It takes a timezone too, so this action has to send the current one.**
 * Sending a default would silently move someone's check-in boundary as a side
 * effect of changing their name, which is the kind of bug nobody reports
 * because nobody connects the two.
 */
export async function updateUsername(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const username = formData.get("username")?.toString().trim() ?? ""

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: "3–30 characters, letters, numbers and underscores only." }
  }
  if (containsProfanity(username)) {
    return { ok: false, error: "Please choose a different username." }
  }

  const { data: profile } = await supabase
    .from("users")
    .select("username, checkin_timezone")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.checkin_timezone) {
    return { ok: false, error: "Finish setting up your account first." }
  }
  if (profile.username === username) {
    // Not an error, and not a write either: spending a 14-day rename on the
    // name you already have would be a trap.
    return { ok: true, data: undefined }
  }

  try {
    await enforce("onboarding", user.id)
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  // Message quality only; the real guard is users_username_lower_key raising
  // 23505. Needs the admin client because RLS hides users outside your Circles,
  // which would make every name look free.
  const admin = createAdminClient()
  const { data: taken } = await admin
    .from("users")
    .select("id")
    .ilike("username", username)
    .neq("id", user.id)
    .maybeSingle()

  if (taken) return { ok: false, error: "That username is taken." }

  const { error } = await supabase.rpc("complete_onboarding", {
    p_username: username,
    p_timezone: profile.checkin_timezone,
  })
  if (error) return { ok: false, error: toMessage(error) }

  // The header renders the username, and it is in the root layout.
  revalidatePath("/", "layout")
  return { ok: true, data: undefined }
}

/**
 * Queues a deliberate timezone change for the next daily rollover.
 *
 * **`set_checkin_timezone`, not `sync_checkin_timezone`.** The latter is the
 * automatic travel path and is a no-op mid-day by design, so wiring this form
 * to it produced a control that reported success and wrote nothing. See
 * migration 74.
 *
 * **Queued rather than immediate, and that is not timidity.**
 * `private.checkin_date_for` derives today from `checkin_timezone` and `now()`
 * alone — it never reads `checkin_day_started_at` — so writing the column
 * directly re-dates today retroactively. At 20:00 in Los Angeles, switching to
 * Tokyo would make "today" tomorrow, leaving today's check-ins filed under a
 * date that is no longer today and completion reading as nothing done.
 *
 * The rollover adopts it after finalising the day against the zone that day was
 * lived in. The boundary moves between days and never during one.
 */
export async function updateTimezone(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const timezone = formData.get("timezone")?.toString().trim() ?? ""
  if (!timezone) return { ok: false, error: "Pick a timezone." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { error } = await supabase.rpc("set_checkin_timezone", {
    p_timezone: timezone,
  })
  if (error) return { ok: false, error: toMessage(error) }

  revalidatePath("/settings")
  return { ok: true, data: undefined }
}

/**
 * How often `/today` greets you on an unfinished day.
 *
 * **A plain column write, not an RPC.** Unlike `pending_checkin_timezone`, this
 * has nothing to hide: it is a display preference, and the enum refuses an
 * unknown value in the database rather than relying on this check. The check is
 * here so a fat-fingered form gets a sentence instead of a `22P02`.
 *
 * `revalidatePath("/", "layout")` is deliberate breadth: the gate that reads
 * this lives on `/dashboard`, so revalidating `/settings` alone would leave the
 * old behaviour in place until the next full navigation.
 */
const MODES = ["every_open", "once_daily", "never"] as const
type TodayMode = (typeof MODES)[number]

export async function updateTodayScreenMode(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const mode = formData.get("mode")?.toString() ?? ""
  if (!MODES.includes(mode as TodayMode)) {
    return { ok: false, error: "Pick one of the three options." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  // `.eq("user_id", …)` alongside the policy rather than instead of it, and
  // `.select()` because RLS filters silently: without a returned row there is no
  // way to tell "updated" from "the policy declined".
  const { data, error } = await supabase
    .from("users")
    .update({ today_screen_mode: mode as TodayMode })
    .eq("id", user.id)
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) return { ok: false, error: "Couldn't save that." }

  revalidatePath("/", "layout")
  return { ok: true, data: undefined }
}

/**
 * Your own queued timezone, or null.
 *
 * An RPC rather than a column read, because a column grant cannot be self-only:
 * `users_select_self_or_groupmate` is row-level, so any column `authenticated`
 * can read is readable by every circle-mate. A queued zone announces a trip you
 * have not taken. Migration 75.
 *
 * Lives here for the same reason `exportUserData` does: `.rpc(` is lint-banned
 * outside `app/actions/`, and the rule is worth keeping literal.
 */
export async function pendingTimezone(): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("my_pending_checkin_timezone")
  if (error) return null
  return data ?? null
}

/**
 * Everything the database holds about you, as one object.
 *
 * Lives here rather than in the route handler because `.rpc(` is lint-banned
 * outside `app/actions/`, and that rule is worth keeping literal: a route
 * handler is server code, but so is a server component, and the exemption would
 * have to be argued again every time.
 */
export async function exportUserData(): Promise<
  { ok: true; data: unknown } | { ok: false; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { data, error } = await supabase.rpc("export_user_data")
  if (error) return { ok: false, error: toMessage(error) }
  return { ok: true, data }
}
