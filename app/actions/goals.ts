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
