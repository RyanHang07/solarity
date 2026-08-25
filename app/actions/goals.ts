"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { enforce } from "@/lib/ratelimit"
import { containsProfanity } from "@/lib/profanity"
import { toMessage, type ActionResult } from "@/lib/errors"

/** Mirrors goals_title_length. */
const TITLE_MAX = 100

/**
 * Goals are user-owned and never group-owned: the same goal follows you into
 * every Circle you join. There is no RPC because a single insert governed by
 * RLS is already atomic; the actions exist so the writes stay metered and
 * screened, which a direct call from a component would skip.
 */
export async function createGoal(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const title = formData.get("title")?.toString().trim() ?? ""
  const categorySlug = formData.get("category")?.toString() ?? ""

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  // Cheap local checks before metering. See lib/ratelimit.ts.
  if (!title || title.length > TITLE_MAX) {
    return { ok: false, error: `Give it a title, up to ${TITLE_MAX} characters.` }
  }
  if (containsProfanity(title)) {
    return { ok: false, error: "Please reword that." }
  }
  if (!categorySlug) {
    return { ok: false, error: "Pick a category." }
  }

  try {
    await enforce("createGoal", user.id)
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  // Resolved by slug, never by a hardcoded id: the UUIDs are generated per
  // environment by the seed, so a literal works in one database and silently
  // breaks in another.
  const { data: category } = await supabase
    .from("goal_categories")
    .select("id")
    .eq("slug", categorySlug)
    .maybeSingle()

  if (!category) return { ok: false, error: "Pick a category." }

  const { error } = await supabase.from("goals").insert({
    user_id: user.id,
    title,
    category_id: category.id,
  })

  // The 10-goal cap arrives as `check_violation` carrying `hint = 'GOAL_LIMIT'`,
  // which `toMessage` resolves. No special case here, and no matching on
  // message text.
  if (error) return { ok: false, error: toMessage(error) }

  revalidatePath("/dashboard")
  return { ok: true, data: undefined }
}

/**
 * Archiving is the retirement path. Goals have no DELETE grant at all: a delete
 * would strand check-in history with a null `goal_id`, and that history is what
 * other members' past stats were computed against.
 *
 * Distinct from achieving, which means the goal was finished rather than
 * dropped, and which feeds `total_goals_achieved`.
 */
export async function archiveGoal(
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

  // No `.eq("user_id", …)`: the RLS UPDATE policy already restricts this to
  // goals you own. RLS filters silently rather than erroring, though, so the
  // affected-row count is the only evidence the write landed.
  const { data, error } = await supabase
    .from("goals")
    // **`"now"`, not `new Date()`.** Postgres reads the literal `now` as the
    // current transaction time, so the value is minted by the database that
    // checks it.
    //
    // `goals_archived_not_future` asserts `archived_at <= now()`. A timestamp
    // from this process is compared against a clock in another datacentre, so
    // any forward skew at all — a laptop back from sleep, a drifting container
    // — turns every archive into a bare `23514` and the person reads "That
    // value isn't allowed." about a button that takes no value from them.
    //
    // Same rule as check-in dates: the time that a constraint judges must come
    // from the thing doing the judging.
    .update({ archived_at: "now" })
    .eq("id", goalId)
    .is("archived_at", null)
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) {
    return { ok: false, error: "That goal is already archived, or isn't yours." }
  }

  revalidatePath("/dashboard")
  return { ok: true, data: undefined }
}

/**
 * Step 14c. Marking a goal finished. The writer `achieved_at` has never had.
 *
 * **Nothing in the database changed for this except migration 83.** The column,
 * the grant, the not-future CHECK, the cap trigger, the daily-completion
 * recount and `goals_count_achievement` have all been in place since migration
 * 34 with no way to reach any of them. This action is the way.
 *
 * **Achieving retires the goal, and the copy has to say so.** Migration 04's
 * column comment claims a goal "can be achieved and kept active", but every
 * consumer disagrees: the partial index, `enforce_active_goal_cap`,
 * `recompute_daily_completion` and `can_check_in_on_goal` all treat a non-null
 * `achieved_at` as retired. So achieving moves today's denominator exactly as
 * archiving does, and can complete a day that was incomplete a moment ago.
 *
 * **It is also one-way, which archiving is not.** `goals_count_achievement`
 * increments `total_goals_achieved` on every null → not-null transition, so
 * clearing the column and setting it again would count one goal twice.
 * Migration 83 refuses to clear or move it; `ACHIEVEMENT_FINAL` is the copy.
 */
export async function achieveGoal(
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

  const { data, error } = await supabase
    .from("goals")
    // **`"now"`, not `new Date()`**, for the reason spelled out in
    // `archiveGoal`: `goals_achieved_not_future` asserts `achieved_at <= now()`
    // in Postgres, and a timestamp minted in this process is judged by a clock
    // in another datacentre. Any forward skew turns the button into a bare
    // `23514`.
    .update({ achieved_at: "now" })
    .eq("id", goalId)
    // **Load-bearing twice over.** It makes a second press a no-op rather than
    // a second increment of `total_goals_achieved`, and it is the guard that
    // keeps this action from ever tripping migration 83's trigger — a request
    // that would move an already-set value simply matches no rows.
    .is("achieved_at", null)
    // RLS filters silently, so the affected-row count is the only evidence the
    // write landed. Same reasoning as `archiveGoal`.
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) {
    return { ok: false, error: "That goal is already achieved, or isn't yours." }
  }

  revalidatePath("/dashboard")
  return { ok: true, data: undefined }
}

/** What `<input type="date">` submits, and the only shape `date` accepts here. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Step 14d. Sets, changes or clears one goal's deadline.
 *
 * **One control for all three.** An empty field means no deadline, so removing
 * one is clearing the input rather than a separate button. The column has been
 * nullable and writable since migration 25 and has never had a writer.
 *
 * **Deliberately unconstrained.** No `min`, no CHECK, no refusal of a past
 * date. Migration 26 states the reason and 84 restates it: a personal deadline
 * is informational, and recording a missed or historical one is legitimate. A
 * date in the past renders as overdue, which is a fact about it rather than a
 * complaint.
 *
 * **The column is a `date`, not a `timestamptz`** — migration 84. That is what
 * makes this action a single assignment instead of a timezone negotiation: a
 * date input submits `YYYY-MM-DD`, and under the old type that stored as
 * midnight UTC and read back a day early for anyone west of it.
 */
export async function setGoalDeadline(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const goalId = formData.get("goalId")?.toString() ?? ""
  const raw = formData.get("deadline")?.toString().trim() ?? ""
  if (!goalId) return { ok: false, error: "Missing goal." }

  // **Checked here rather than left to Postgres.** A malformed date arrives as
  // `22007`, which `toMessage` has no case for and renders as "Something went
  // wrong" — true, and useless beside a field the person just filled in.
  if (raw && !ISO_DATE.test(raw)) {
    return { ok: false, error: "Pick a date, or clear the field to remove it." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { data, error } = await supabase
    .from("goals")
    // Empty means none. `|| null` rather than `?? null`, because the empty
    // string is exactly the value that has to become a null here.
    .update({ deadline: raw || null })
    .eq("id", goalId)
    .eq("user_id", user.id)
    // RLS filters silently, so the affected-row count is the only evidence.
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) return { ok: false, error: "That isn't your goal." }

  revalidatePath("/dashboard")
  return { ok: true, data: undefined }
}

/**
 * Hides or shows one goal in one Circle. The writer `goal_group_visibility` has
 * never had.
 *
 * **No RPC, deliberately.** The four policies on the table already say exactly
 * the right thing: insert and update require `owns_goal(goal_id) AND
 * is_group_member(group_id)`, delete requires `owns_goal`. A `SECURITY DEFINER`
 * function would restate that and become a second place to get it wrong.
 *
 * **Showing deletes the row rather than writing `hidden = false`.** The table
 * is sparse and a missing row means visible; keeping both spellings of "not
 * hidden" would mean every reader has to handle two, forever.
 *
 * **Hiding never changes anyone's counts.** The goal still appears in the
 * roster's `total_count` as a placeholder, and still gates your daily
 * completion. See architecture/schema.md.
 */
export async function setCircleVisibility(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const goalId = formData.get("goalId")?.toString() ?? ""
  const groupId = formData.get("groupId")?.toString() ?? ""
  // Absent means show. The form sends this only when asking to hide, matching
  // the `noteShared` checkbox convention in `checkIn`: the safer of the two
  // outcomes is what a missing field produces.
  const hide = formData.get("hidden") === "on"

  if (!goalId || !groupId) return { ok: false, error: "Missing goal or Circle." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  // Checked here as well as in the policies, because **an RLS refusal carries
  // no HINT**. Every raise in the RPCs does, which is what `lib/errors.ts`
  // resolves; a policy that simply declines produces a bare `42501`, or on a
  // filtered UPDATE no error at all and zero rows. Neither becomes a sentence
  // anyone would want to read. The policies stay as the backstop that makes
  // these checks unnecessary rather than as the thing producing the text.
  const goal = await supabase
    .from("goals")
    .select("id")
    .eq("id", goalId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (goal.error) return { ok: false, error: toMessage(goal.error) }
  if (!goal.data) return { ok: false, error: "That isn't your goal." }

  const membership = await supabase
    .from("group_members")
    .select("group_id")
    .eq("group_id", groupId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (membership.error) return { ok: false, error: toMessage(membership.error) }
  if (!membership.data) {
    return { ok: false, error: "You're not in that Circle." }
  }

  if (!hide) {
    const { error } = await supabase
      .from("goal_group_visibility")
      .delete()
      .eq("goal_id", goalId)
      .eq("group_id", groupId)
    if (error) return { ok: false, error: toMessage(error) }
    revalidatePath("/dashboard")
    return { ok: true, data: undefined }
  }

  // ---------------------------------------------------------------------
  // Update first, insert only if there was nothing to update.
  //
  // **`upsert` is refused here, and the reason is grants rather than RLS.**
  // `authenticated` holds INSERT on all three columns but UPDATE on `hidden`
  // alone. PostgREST's merge-duplicates upsert compiles to
  // `ON CONFLICT DO UPDATE SET goal_id = …, group_id = …, hidden = …`, naming
  // two columns it may not write, so the whole statement dies with a bare
  // `42501` that `toMessage` renders as "You don't have access to that." True,
  // unhelpful, and it points at the wrong thing entirely.
  //
  // Widening the grant to fix it would be the wrong trade: nothing should ever
  // move a visibility row between goals or Circles, and the narrow grant is
  // what says so. Two statements that each stay inside it are cheaper than a
  // permission nobody needs.
  //
  // Grants are checked before RLS, so no policy can rescue a missing one.
  // ---------------------------------------------------------------------
  const updated = await supabase
    .from("goal_group_visibility")
    .update({ hidden: true })
    .eq("goal_id", goalId)
    .eq("group_id", groupId)
    .select("goal_id")
  if (updated.error) return { ok: false, error: toMessage(updated.error) }

  if (!updated.data?.length) {
    const { error } = await supabase
      .from("goal_group_visibility")
      .insert({ goal_id: goalId, group_id: groupId, hidden: true })
    // 23505 means someone hid it between the two statements, which is the
    // outcome that was wanted. Anything else is real.
    if (error && error.code !== "23505") {
      return { ok: false, error: toMessage(error) }
    }
  }

  revalidatePath("/dashboard")
  // Deliberately not revalidating the Circle page, for the same reason
  // `checkIn` does not: this action does not know which Circles are open in
  // which tabs, and the roster is a live read that picks it up on the next
  // visit. See 8g.
  return { ok: true, data: undefined }
}

/**
 * Hides or shows one goal in every Circle, including ones joined later.
 *
 * **Why this is a column and not a row per Circle.** `goal_group_visibility` is
 * sparse, so "hidden from everyone" written as rows is only true of the Circles
 * that existed when you said it: join a new one tomorrow and the goal is
 * visible there, silently, because no row says otherwise. Nothing errors; a
 * title just appears in front of people you never chose. See migration 71.
 *
 * Per-Circle rows are left untouched, so turning this off restores whatever
 * choices were underneath it.
 */
export async function setHiddenEverywhere(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const goalId = formData.get("goalId")?.toString() ?? ""
  const hide = formData.get("hidden") === "on"
  if (!goalId) return { ok: false, error: "Missing goal." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  // `.select()` because RLS filters silently: without a returned row there is
  // no way to tell "updated" from "the policy declined", and both look like
  // success. Same reasoning as `archiveGoal` above.
  const { data, error } = await supabase
    .from("goals")
    .update({ hidden_everywhere: hide })
    .eq("id", goalId)
    .eq("user_id", user.id)
    .select("id")

  if (error) return { ok: false, error: toMessage(error) }
  if (!data?.length) return { ok: false, error: "That isn't your goal." }

  revalidatePath("/dashboard")
  return { ok: true, data: undefined }
}
