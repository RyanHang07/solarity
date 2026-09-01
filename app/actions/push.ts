"use server"

import { createClient } from "@/lib/supabase/server"
import { toMessage, type ActionResult } from "@/lib/errors"
import { dismissPushNudge } from "@/lib/push-nudge"

/**
 * Step 10a. The two halves of a push subscription's life.
 *
 * ## Why subscribing is an RPC and unsubscribing is not
 *
 * `push_subscriptions.endpoint` is unique **globally**, not per user, and that
 * is the right constraint: an endpoint identifies one browser to one push
 * service, so two rows would make the sender deliver the same digest twice.
 *
 * It also puts three ordinary situations out of the client's reach:
 *
 * | Situation | What the client hits |
 * |---|---|
 * | Re-subscribing on a device you already registered | `23505`, and the upsert that would fix it needs UPDATE on columns `authenticated` cannot write |
 * | A second account signing in on a shared browser | `23505`, and it may not delete a row it does not own |
 * | The browser rotating an endpoint | the same, via `pushsubscriptionchange` |
 *
 * `public.subscribe_push` is `SECURITY DEFINER` for exactly that: it deletes
 * whatever holds the endpoint, then inserts the caller's row. Deleting a
 * stranger's row is correct rather than rude, because the browser has just told
 * us who is using it now.
 *
 * Unsubscribing needs none of that. The DELETE policy is self-scoped, which is
 * precisely the rule we want, so it stays a plain delete and the narrow path
 * stays narrow.
 */

/** What `PushSubscription.toJSON()` gives us, minus the parts we don't store. */
export type PushSubscriptionInput = {
  endpoint: string
  p256dh: string
  auth: string
}

/**
 * Records this browser as a push target for the signed-in account.
 *
 * Idempotent by construction: calling it twice with the same endpoint leaves
 * one row. The client can therefore call it on every load without checking
 * first, which is what `pushsubscriptionchange` and the settings toggle both
 * want.
 *
 * **No `revalidatePath`.** No server render reads this table. The settings
 * toggle reads it through `pushSubscribed` after the fact, from the browser
 * that owns the endpoint.
 */
export async function subscribePush(
  sub: PushSubscriptionInput,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  // The RPC re-checks all of this. Doing it here too saves a round trip on the
  // one failure a browser can actually produce: a subscription that came back
  // without its keys.
  if (!sub?.endpoint || !sub.p256dh || !sub.auth) {
    return { ok: false, error: "We couldn't set up notifications on this device." }
  }

  const { error } = await supabase.rpc("subscribe_push", {
    p_endpoint: sub.endpoint,
    p_p256dh: sub.p256dh,
    p_auth: sub.auth,
    // `p_device_label` is left to its default until there is a screen listing
    // your devices. It exists in the signature already because adding a
    // parameter later would create a *new* function rather than replace this
    // one, and a new function inherits none of this one's grants.
  })

  if (error) return { ok: false, error: toMessage(error) }
  return { ok: true, data: undefined }
}

/**
 * Stops push to one browser.
 *
 * **Keyed on the endpoint, scoped to you.** The `user_id` filter is not
 * redundant with the policy: it says what this action means, so nobody has to
 * open a policy file to learn whose row is being removed. It also makes the
 * turn-it-off path a no-op rather than an error if the row is already gone,
 * which happens whenever a browser has revoked permission behind our back.
 *
 * The caller should unsubscribe the browser's own `PushSubscription` too.
 * Deleting only the row would leave the push service still delivering to a
 * service worker that no longer has a reason to show anything.
 */
export async function unsubscribePush(endpoint: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint)

  if (error) return { ok: false, error: toMessage(error) }
  return { ok: true, data: undefined }
}

/**
 * Whether this exact browser is still registered for the signed-in account.
 *
 * **Added in 10d, because the local answer can lie.** A browser holds its
 * `PushSubscription` no matter who is signed in, so after a second account uses
 * the same device, `pushManager.getSubscription()` still returns one and the
 * first account's settings page would happily show "on" while the endpoint now
 * belongs to someone else. `subscribe_push` takes endpoints over by design, so
 * this is a state the app creates, not a hypothetical.
 *
 * One indexed lookup, and it is the difference between a toggle that reports a
 * fact and one that reports a hope.
 */
export async function pushSubscribed(endpoint: string): Promise<boolean | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Not signed in is not "no row". The caller renders it as "we could not tell"
  // rather than as an off switch.
  if (!user) return null

  const { count, error } = await supabase
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("endpoint", endpoint)

  /**
   * **`error` was discarded, and that was the bug.** A failed read returns
   * `count: null`, `(null ?? 0) > 0` is `false`, and the settings toggle drew an
   * off switch for a device whose row was sitting in the table. One `??` turned
   * "the read did not happen" into a confident "you are not subscribed".
   *
   * Logged as well as returned: this runs on the server, where the reason is
   * visible, and the browser only ever learns that the answer is unknown.
   */
  if (error) {
    console.error("pushSubscribed read failed", {
      userId: user.id,
      code: error.code,
      message: error.message,
    })
    return null
  }

  return (count ?? 0) > 0
}

/**
 * Records that this device has been offered notifications and said not now.
 *
 * A cookie write, so it has to be an action: Next allows `cookies().set()` in
 * actions and route handlers only. Same shape as `markTodaySeen`.
 *
 * **Returns nothing to render.** The nudge hides itself on click; this only has
 * to outlive the page. A failure means the line comes back next visit, which is
 * the harmless direction.
 */
export async function dismissPushNudgeAction(): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  await dismissPushNudge()
}
