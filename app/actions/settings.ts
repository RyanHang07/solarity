"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { enforce } from "@/lib/ratelimit"
import { containsProfanity } from "@/lib/profanity"
import { AVATAR_BUCKET, AVATAR_URL_TTL_SECONDS, avatarKey } from "@/lib/avatar"
import { toMessage, type ActionResult } from "@/lib/errors"
import { TERMS_VERSION } from "@/lib/legal"

/** Mirrors users_username_format, so a refusal is a sentence and not a 23514. */
const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/

/**
 * The settings page holds only controls whose backend already exists.
 *
 * That is a rule, not a coincidence. A switch over a function nobody wrote is
 * exactly the shape 8h spent two migrations removing: `goal_group_visibility`
 * had policies, grants and two consumers enforcing it, and no writer, for
 * weeks.
 *
 * Both of the exceptions that note used to list are now closed: push got its
 * subscribe flow in step 10, and account deletion got its confirmation flow in
 * 14e. `deleteAccount` below satisfies the rule rather than bending it — the
 * `delete-account` Edge Function has been deployed and unreachable since the
 * account-lifecycle work, which is the same shape from the other direction: a
 * backend nobody could call.
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
    // Step 20a. The RPC `coalesce`s this, so a rename never moves an existing
    // acceptance; only a first one writes.
    p_terms_version: TERMS_VERSION,
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

/**
 * Whether a push body may name the Circle it is about.
 *
 * **A plain column write, like the check-in screen setting**, and for the same
 * reason: nothing here is hidden from anyone, so there is no case for an RPC.
 *
 * **No `revalidatePath`.** Nothing rendered depends on it. The only reader is
 * `send-digest-push`, which queries the database when it runs, so a stale page
 * cannot produce a stale notification.
 */
export async function updatePushShowsCircleName(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  // A checkbox sends its value only when ticked, so absence is the off state
  // rather than a missing field.
  const show = formData.get("show") === "on"

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { data, error } = await supabase
    .from("users")
    .update({ push_shows_circle_name: show })
    .eq("id", user.id)
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) return { ok: false, error: "Couldn't save that." }

  return { ok: true, data: undefined }
}

/**
 * Step 15c. Whether your lifetime stats appear on your profile.
 *
 * **The narrowest write in the app, and that is not an accident.**
 * `authenticated` holds `update (visible_on_profile)` on `user_lifetime_stats`
 * and nothing else on that table — the four counters are maintained by triggers
 * and no client may touch them. This action is therefore the whole of what a
 * person can change about their own stats, which is exactly the intent.
 *
 * **No RPC.** `user_lifetime_stats_update_own` is `user_id = auth.uid()` on
 * both sides, and the column grant does the rest. A `SECURITY DEFINER` function
 * would restate a rule the schema already states, and become a second place to
 * get it wrong.
 *
 * **Identity is not covered by this.** Username, display name, avatar and join
 * date are visible to any signed-in user whatever this says; the toggle governs
 * the four numbers. The copy on the form has to be precise about that, or
 * someone will read "hidden" as "invisible" and be wrong about who can see
 * what.
 */
export async function updateStatsVisibility(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  // A checkbox sends its value only when ticked, so absence is off. The same
  // convention as `updatePushShowsCircleName` above, and the safer of the two
  // outcomes is the one a missing field produces.
  const visible = formData.get("visible") === "on"

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { data, error } = await supabase
    .from("user_lifetime_stats")
    .update({ visible_on_profile: visible })
    .eq("user_id", user.id)
    // RLS filters silently, so the affected-row count is the only evidence.
    .select("user_id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) return { ok: false, error: "Couldn't save that." }

  // `/profile` reads this, and it is a sibling segment rather than a child of
  // this page — so revalidating `/settings` alone would leave the profile
  // showing the old answer until something else forced a load.
  revalidatePath("/profile")
  revalidatePath("/settings")
  return { ok: true, data: undefined }
}

/**
 * Step 15f. Records that your avatar exists, or that it no longer does.
 *
 * **The bytes never pass through this server**, exactly as with check-in
 * photos: the browser uploads straight to Storage under `avatars_insert`, and
 * this action writes the column afterwards. Storage is the thing enforcing who
 * may write where.
 *
 * **The key is derived here, never accepted.** `avatarKey(user.id)` is the only
 * value this will ever write. That is belt to migration 85's braces — the CHECK
 * refuses a key outside your own folder at the database — and it means a
 * request cannot even propose one.
 *
 * **Clearing does not delete the object**, and that is deliberate rather than
 * lazy. The key is fixed, so the next upload overwrites the same object and
 * there is never more than one; and `job_scrub_and_list_user_media` removes it
 * on account deletion. A delete here would add a Storage round trip that can
 * fail on a path whose only job is to stop rendering a picture.
 */
export async function setAvatar(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  // A checkbox-style flag: the form sends this only when clearing, matching the
  // convention in `setCircleVisibility` and `checkIn` — the safer outcome is
  // what a missing field produces.
  const clearing = formData.get("clear") === "on"

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  if (!clearing) {
    /**
     * **Metered with `photoUpload`**, the same limit `attachCheckinPhoto` uses,
     * and for the same reason: this is the action that *records* an upload the
     * browser made directly to Storage.
     *
     * **It bounds recorded writes, not bytes.** Someone determined can push
     * objects at Storage without ever calling this, exactly as they can for
     * check-in photos; the real bounds there are the bucket's 2MB cap and the
     * `avatars_insert` policy confining them to their own folder. Reused rather
     * than given its own limit because an avatar and a check-in photo are the
     * same act against the same budget.
     *
     * Clearing is not metered: it writes a null and touches no storage.
     */
    try {
      await enforce("photoUpload", user.id)
    } catch (e) {
      return { ok: false, error: toMessage(e) }
    }
  }

  const { data, error } = await supabase
    .from("users")
    .update({ avatar_url: clearing ? null : avatarKey(user.id) })
    .eq("id", user.id)
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) return { ok: false, error: "Couldn't save that." }

  // The header on every signed-in screen reads this row, so the whole tree has
  // to re-render rather than one page. Same breadth, and same reason, as the
  // username and timezone writers above.
  revalidatePath("/", "layout")
  return { ok: true, data: undefined }
}

/**
 * A signed URL for one avatar, or null.
 *
 * **The bucket is private and stays private.** A public bucket would make every
 * avatar a permanent, guessable, unauthenticated URL — worse than the profile
 * itself, which at least requires signing in. `avatars_select` allows any
 * authenticated reader, which is what profiles being open to any signed-in user
 * requires, and the signature is what carries that decision to the browser.
 */
export async function signedAvatarUrl(key: string | null): Promise<string | null> {
  if (!key) return null

  const supabase = await createClient()
  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(key, AVATAR_URL_TTL_SECONDS)

  if (error) {
    // Logged, not thrown. A missing avatar is a missing picture, and a profile
    // that fails to render because of one is a worse answer than initials.
    console.error("signing avatar failed", error)
    return null
  }
  return data?.signedUrl ?? null
}

/**
 * Step 14e. Deletes your account, for good.
 *
 * **The backend has existed the whole time.** `supabase/functions/delete-account`
 * scrubs note text, removes every Storage object, then deletes the auth user,
 * which cascades into `public.users` and fires `handle_membership_removal` for
 * owner succession and the audit trail. None of that is re-implemented here and
 * none of it should be: this action's whole job is to prove who is asking and
 * hand the request over.
 *
 * **An Edge Function rather than an RPC, and that is not a style choice.**
 * Deleting an auth user requires the admin API and the service key, which no
 * database function can reach and which must never be near a browser. The
 * function reads the caller's own JWT and takes the user id from it — never
 * from a request body, which would let anyone delete anyone.
 *
 * **`invoke` forwards the session automatically.** The server client is built
 * from the request's cookies, so the `Authorization` header the function
 * authenticates against is the caller's. There is no id to pass and no way for
 * this action to name a different user, which is the property worth keeping.
 *
 * ## What survives, and why that is correct rather than sloppy
 *
 * `progress_entries` are kept, anonymised. Other members' historical group
 * stats were computed against them, so hard-deleting would retroactively
 * corrupt cycles that other people shared. The foreign keys null the
 * attribution and the function scrubs the free-text note, which a foreign key
 * cannot reach. The copy in the panel says this plainly rather than promising
 * an erasure the product does not perform.
 */
export async function deleteAccount(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  /**
   * **The typed confirmation is checked on the server, not only in the panel.**
   *
   * A client-side check is a courtesy to the person, not a control: this action
   * is a POST endpoint like any other, and a mis-wired button or a stray
   * `requestSubmit` reaches it directly. The username is read from the database
   * rather than trusted from a hidden field, or the form would be confirming
   * itself.
   */
  const { data: profile } = await supabase
    .from("users")
    .select("username")
    .eq("id", user.id)
    .maybeSingle()

  const typed = formData.get("confirm")?.toString().trim() ?? ""
  if (!profile?.username || typed.toLowerCase() !== profile.username.toLowerCase()) {
    return { ok: false, error: "Type your username exactly to confirm." }
  }

  try {
    await enforce("deleteAccount", user.id)
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  const { data, error } = await supabase.functions.invoke("delete-account", {
    method: "POST",
  })

  if (error) {
    // Logged, because this is the one failure in the app where the person
    // cannot simply try a different route and where a silent 500 leaves them
    // believing their data is gone when it is not.
    console.error("delete-account invoke failed", error)
    return { ok: false, error: "Couldn't delete your account. Please try again." }
  }

  // The function answers 200 with `{ error }` for its own failures, so a
  // transport-level success is not the same as a deletion.
  if (!(data as { deleted?: boolean } | null)?.deleted) {
    console.error("delete-account returned without deleting", data)
    return { ok: false, error: "Couldn't delete your account. Please try again." }
  }

  /**
   * **Sign out locally, and do not let a failure here look like a failure.**
   *
   * The account is gone at this point. `signOut` only clears this browser's
   * cookies, and the refresh token it would revoke belongs to a user that no
   * longer exists — Supabase may well answer with an error. Swallowing it is
   * correct: reporting it would tell the person their deletion failed after it
   * succeeded, which is the worst wrong answer available here.
   */
  try {
    await supabase.auth.signOut()
  } catch {
    // Deliberately ignored; see above.
  }

  /**
   * **Redirected here rather than returning `ok`.**
   *
   * There is no signed-in screen left to render: every route in `(app)` reads
   * the user row this just removed, so returning success would leave the panel
   * mounted on a page that is about to bounce to sign-in. Landing on sign-in
   * with no explanation reads as being logged out, not as having succeeded.
   *
   * `/` is outside the route group and carries `Notice`, so the last thing the
   * app says is a sentence about what happened. `redirect` throws, so it must
   * stay outside the `try` above.
   */
  redirect("/?notice=account-deleted")
}

/**
 * Step 19. Which kinds of notification may interrupt you.
 *
 * **One action, four columns, one form**, rather than four actions. They are
 * saved together because they are read together: somebody deciding how noisy
 * this app should be makes one decision about four switches, and four separate
 * Save buttons would turn that into four round trips and four chances for the
 * page to disagree with the database.
 *
 * **Absence is off**, the same convention as `updatePushShowsCircleName`: a
 * checkbox sends nothing when unticked, so every field has to be read as a
 * presence test rather than a value.
 *
 * **No `revalidatePath`.** The only readers are the triggers in migration 103,
 * which query when they run.
 */
export async function updateNotificationPrefs(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { data, error } = await supabase
    .from("users")
    .update({
      notify_goal_achieved: formData.get("goal_achieved") === "on",
      notify_first_finisher: formData.get("first_finisher") === "on",
      notify_last_one_left: formData.get("last_one_left") === "on",
      notify_circle_activity: formData.get("circle_activity") === "on",
    })
    .eq("id", user.id)
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  // **`.select("id")` is the only proof the write landed.** RLS filters rather
  // than erroring, so a refused update returns success and zero rows.
  if (!data?.length) return { ok: false, error: "Couldn't save that." }

  return { ok: true, data: undefined }
}
