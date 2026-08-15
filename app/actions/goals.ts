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
    .update({ archived_at: new Date().toISOString() })
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
