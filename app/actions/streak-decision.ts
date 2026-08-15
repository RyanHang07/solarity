"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { toMessage, type ActionResult } from "@/lib/errors"

/**
 * Resolves the pending streak decision after someone joined mid-streak.
 *
 * **This is the resolver for a setter that shipped without one.** `join_circle`
 * puts a joiner in `streak_grace` and flips `streak_decision_pending` on the
 * Circle; until this ran, nothing could clear either. The Circle quietly stopped
 * counting that member and no error was ever raised, which is the worst shape a
 * bug can take. See the pattern list in build-plan.md.
 *
 * **Owner only**, enforced by the RPC. It is a judgment call about the Circle's
 * standards rather than routine admin work, which is why an admin cannot make
 * it.
 *
 * **Not rate limited.** It can only succeed while a decision is pending, and it
 * clears that flag, so the second call raises. There is no volume to bound.
 *
 * Either answer ends grace. The choice is only whether the existing streak
 * survives: `true` keeps it and starts counting the newcomer from today,
 * `false` sets the cycle's `current_streak` to 0 for everyone.
 */
export async function resolveStreakDecision(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const groupId = formData.get("groupId")?.toString() ?? ""
  const choice = formData.get("choice")?.toString() ?? ""

  if (!groupId) return { ok: false, error: "Missing Circle." }
  // Checked explicitly rather than treating anything-but-"keep" as a reset. A
  // missing field would otherwise destroy a streak by default, and the whole
  // point of this screen is that nobody's streak dies without being chosen.
  if (choice !== "keep" && choice !== "reset") {
    return { ok: false, error: "Pick one of the two options." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { error } = await supabase.rpc("resolve_streak_decision", {
    p_group_id: groupId,
    p_continue: choice === "keep",
  })

  if (error) return { ok: false, error: toMessage(error) }

  revalidatePath(`/circles/${groupId}`)
  revalidatePath("/dashboard")
  return { ok: true, data: undefined }
}
