"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { enforce } from "@/lib/ratelimit"
import { containsProfanity } from "@/lib/profanity"
import { toMessage, type ActionResult } from "@/lib/errors"

/** Mirrors groups_name_length, so the person gets a sentence not a constraint. */
const NAME_MIN = 1
const NAME_MAX = 50

/**
 * Creates a Circle, its owner membership, and its first cycle.
 *
 * All three happen inside `create_circle` because a function body is a single
 * transaction. Three separate client calls could fail between steps and leave
 * an ownerless Circle that nobody can see or clean up.
 *
 * **No deadline is passed.** `create_circle` accepts one, but unlike
 * `set_circle_deadline` it does not validate that the date is in the future, so
 * a form here could mint a Circle that locks at the next rollover. Circles are
 * created open-ended, which never locks, and the deadline is set afterwards
 * through the RPC that enforces the next-day floor.
 */
export async function createCircle(
  _prev: ActionResult<{ groupId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ groupId: string }>> {
  const name = formData.get("name")?.toString().trim() ?? ""

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  // Cheap local checks run BEFORE the rate limit, so a rejected attempt costs
  // nothing. Spending a daily allowance on a typo or a filtered word is a
  // punishment for a mistake, and the limit exists to bound Circle creation,
  // not keystrokes. Neither check touches the network, so leaving them
  // unmetered costs nothing worth protecting.
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return { ok: false, error: `Give it a name, up to ${NAME_MAX} characters.` }
  }

  // Circle names appear in other members' notifications and digests, so they
  // get the same screening as usernames.
  if (containsProfanity(name)) {
    return { ok: false, error: "Please choose a different name." }
  }

  // Immediately before the first call that leaves this process.
  try {
    await enforce("createCircle", user.id)
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  const { data, error } = await supabase.rpc("create_circle", { p_name: name })
  if (error) return { ok: false, error: toMessage(error) }

  revalidatePath("/dashboard")
  return { ok: true, data: { groupId: data as string } }
}

/**
 * Retires a Circle. Owner only, and not reversible.
 *
 * The RPC does the three writes that have to happen together: closes the open
 * cycle, sets the status, audits. See migration 62 for why a column grant was
 * the wrong shape.
 *
 * **Not rate limited.** It can only be run once per Circle, since the second
 * attempt raises `ALREADY_ARCHIVED`, and Circle creation is already capped at
 * five a day. There is no volume here to bound.
 *
 * Redirects rather than returning, because the settings page it is called from
 * stops being somewhere you can usefully stand: invites are dead and the only
 * remaining control is the one just pressed.
 */
export async function archiveCircle(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const groupId = formData.get("groupId")?.toString() ?? ""
  if (!groupId) return { ok: false, error: "Missing Circle." }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { error } = await supabase.rpc("archive_circle", { p_group_id: groupId })
  if (error) return { ok: false, error: toMessage(error) }

  revalidatePath("/dashboard")
  revalidatePath(`/circles/${groupId}`)
  redirect("/dashboard?notice=circle-archived")
}
