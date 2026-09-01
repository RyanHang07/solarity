"use client"

import { pushSubscribed, subscribePush, unsubscribePush } from "@/app/actions/push"

/**
 * Step 10c, the browser half of 10a. Turning a permission into a row.
 *
 * ## The one rule this file exists to keep
 *
 * **Never report success we did not get.** Enabling push has five steps that
 * can each fail on their own: support, permission, a live service worker, the
 * push service, and our own write. A screen that says "notifications are on"
 * after any of them quietly failed is worse than one that says nothing, because
 * the person stops expecting a reminder that will never come. So every path
 * returns a named outcome, and the caller renders what actually happened.
 */

export type PushOutcome =
  | "subscribed"
  | "denied"
  | "dismissed"
  | "unsupported"
  | "failed"

/** Not exported: every caller reads `outcome`, and a type nobody imports is a
 *  symbol with no reader. */
type PushResult = { outcome: PushOutcome; error?: string }

/** All three are needed, and iOS has them only inside an installed PWA. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  )
}

/** `null` when the browser has no Notification API at all, which is not "default". */
export function permissionNow(): NotificationPermission | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null
  return Notification.permission
}

/**
 * VAPID keys travel as base64url, and `applicationServerKey` wants bytes.
 *
 * `atob` needs standard base64, so the URL-safe alphabet is translated back and
 * the padding the encoder dropped is restored.
 */
function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  // Built over an explicit ArrayBuffer: `new Uint8Array(length)` is typed over
  // `ArrayBufferLike`, which `applicationServerKey` will not accept because it
  // could in principle be shared memory.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Compares a stored `applicationServerKey` against the one we would use now. */
function sameKey(stored: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!stored) return false
  const a = new Uint8Array(stored)
  if (a.length !== wanted.length) return false
  return a.every((byte, i) => byte === wanted[i])
}

/**
 * `navigator.serviceWorker.ready` never rejects. If registration failed, or the
 * worker is stuck installing, it simply never settles, and the button would
 * spin forever with nothing in the log. A losing race is an honest failure.
 */
async function readyWorker(): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
  ])
}

/**
 * Asks for permission, subscribes this browser, and records it.
 *
 * **Must be called from a tap.** One ask per origin and a denial is permanent,
 * so the screen explains first and the button asks; some browsers also ignore a
 * request that did not follow a gesture, which would burn nothing but look like
 * a dismissal.
 */
export async function enablePush(): Promise<PushResult> {
  if (!pushSupported()) return { outcome: "unsupported" }

  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapid) {
    // A deployment problem, not a person problem, and worth saying plainly:
    // silently treating it as a decline would hide a broken environment behind
    // a screen that looks like it worked.
    return {
      outcome: "failed",
      error: "Notifications aren't configured on this deployment.",
    }
  }

  let permission: NotificationPermission
  try {
    permission = await Notification.requestPermission()
  } catch {
    return { outcome: "failed", error: "Your browser wouldn't show the prompt." }
  }

  if (permission === "denied") return { outcome: "denied" }
  // "default" means the dialog was closed without an answer. Nothing is spent:
  // the browser will ask again next time, so this is not a failure.
  if (permission !== "granted") return { outcome: "dismissed" }

  return subscribeAndRecord(vapid)
}

/**
 * Everything after the permission answer: find or make a subscription for this
 * browser, and record it.
 *
 * **Split out for re-subscription (10e), which must never ask.** A browser can
 * invalidate a subscription and issue a new one at any time; the person already
 * said yes once, and the only honest response is to quietly repair the
 * registration. Sharing this half means the repair path and the opt-in path
 * cannot drift: one place decides what a valid subscription is, one place
 * writes it.
 */
async function subscribeAndRecord(vapid: string): Promise<PushResult> {
  const registration = await readyWorker()
  if (!registration) {
    return {
      outcome: "failed",
      error: "We couldn't reach this device's background worker.",
    }
  }

  const key = urlBase64ToUint8Array(vapid)

  let subscription: PushSubscription | null
  try {
    const existing = await registration.pushManager.getSubscription()

    // **A subscription made with a different VAPID key is dead.** The push
    // service keeps accepting it and nothing errors; the messages just never
    // arrive. Reusing it would be the quietest possible bug, so a mismatch is
    // torn down and replaced.
    if (existing && !sameKey(existing.options.applicationServerKey, key)) {
      await existing.unsubscribe()
      subscription = null
    } else {
      subscription = existing
    }

    subscription ??= await registration.pushManager.subscribe({
      // Required by Chromium, and honest: every push we send shows a
      // notification.
      userVisibleOnly: true,
      applicationServerKey: key,
    })
  } catch {
    return {
      outcome: "failed",
      error: "Your browser couldn't reach its notification service.",
    }
  }

  const json = subscription.toJSON()
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!p256dh || !auth) {
    return { outcome: "failed", error: "This device returned an unusable subscription." }
  }

  // **Wrapped, because a server action can reject rather than return.** A
  // dropped connection, a dev server recompiling mid-flight, a deploy landing
  // between the click and the write: all of them throw out of the call rather
  // than producing an `ActionResult`. Unwrapped, that rejection escaped to the
  // caller, the button stayed on "Waiting for your answer…" forever, and the
  // row may or may not exist. Every other outcome here is named; this one has
  // to be too.
  let saved
  try {
    saved = await subscribePush({ endpoint: subscription.endpoint, p256dh, auth })
  } catch {
    return {
      outcome: "failed",
      // Deliberately not "we couldn't turn them on": the browser is subscribed
      // and the write may well have landed. Reopening the screen re-runs the
      // same idempotent path and settles it.
      error: "This device is ready, but we couldn't confirm it with the server. Try again.",
    }
  }

  if (!saved.ok) return { outcome: "failed", error: saved.error }

  return { outcome: "subscribed" }
}

/**
 * Repairs this browser's subscription **without asking for anything**.
 *
 * Called when the service worker reports `pushsubscriptionchange`: the push
 * service has rotated or revoked the endpoint, and nothing errors when that
 * happens. Delivery simply stops, silently, which is the failure this exists to
 * prevent.
 *
 * **Returns `denied` rather than prompting when permission is not granted.**
 * Re-subscription is a repair, not a request; a browser that has never said yes
 * has nothing to repair, and spending the one prompt from a background event
 * nobody saw would be the worst possible place to spend it.
 */
export async function resubscribeIfPermitted(): Promise<PushResult> {
  if (!pushSupported()) return { outcome: "unsupported" }
  if (Notification.permission !== "granted") return { outcome: "denied" }

  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!vapid) {
    return {
      outcome: "failed",
      error: "Notifications aren't configured on this deployment.",
    }
  }

  return subscribeAndRecord(vapid)
}

/**
 * Whether notifications are on **for this browser and this account**, or
 * whether we could not find out.
 *
 * Three things have to agree, and asking only the first two is how a toggle
 * starts lying: the browser must allow it, this browser must hold a
 * subscription, and the server must still have that endpoint against *you*.
 * The third is not pedantry. `subscribe_push` hands an endpoint to whoever
 * subscribed last, so on a shared browser the local subscription outlives the
 * row it used to match.
 *
 * ## Why this is no longer a boolean
 *
 * **Found by the manual pass: settings offered "Turn on notifications" on a
 * device that already had them on**, with the row sitting in
 * `push_subscriptions` the whole time. Two of the four ways this could answer
 * "no" are not "no" at all:
 *
 * - `readyWorker()` resolves to `null` after ten seconds if the service worker
 *   never becomes ready. That is a slow or wedged worker, not an absent
 *   subscription.
 * - `pushSubscribed` used to discard its error and return `false`, so a refused
 *   or failed read was indistinguishable from a genuine miss.
 *
 * Both rendered as an off switch. **A control that offers to start something
 * already running is the same class of lie as one that claims success it did
 * not get**, which is the rule at the top of this file, and it had a hole in it
 * on the "we do not know" side.
 *
 * `"unknown"` is deliberately not `"off"`: the caller shows what it means
 * rather than guessing, and the guess was the bug.
 */
export type PushHereState = "on" | "off" | "unknown"

export async function pushEnabledHere(): Promise<PushHereState> {
  if (!pushSupported() || Notification.permission !== "granted") return "off"

  const registration = await readyWorker()
  // Ten seconds elapsed without a ready worker. Nothing here says the person is
  // unsubscribed, and saying so is how the button appeared.
  if (!registration) return "unknown"

  const subscription = await registration.pushManager.getSubscription()
  // This one *is* a real "no": the browser holds no subscription, so there is
  // nothing for a row to match.
  if (!subscription) return "off"

  const known = await pushSubscribed(subscription.endpoint)
  return known === null ? "unknown" : known ? "on" : "off"
}

/**
 * Turns push off for this browser: the subscription and the row, in that order.
 *
 * **The browser first, deliberately.** If the row delete then fails, the
 * subscription is already dead and `send-digest-push` prunes the row on its next
 * 404 or 410, so the system converges on its own. The other order can leave a
 * live subscription with no row, which converges on nothing: the browser keeps a
 * registration nobody will ever use, and the person cannot tell.
 *
 * Idempotent. Nothing to unsubscribe is a success, not an error: a browser that
 * has already forgotten is in the state the person asked for.
 */
export async function disablePush(): Promise<{ ok: boolean; error?: string }> {
  if (!pushSupported()) return { ok: true }

  const registration = await readyWorker()
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return { ok: true }

  // Captured before unsubscribing, because the object stops being useful after.
  const { endpoint } = subscription

  try {
    await subscription.unsubscribe()
  } catch {
    return { ok: false, error: "Your browser wouldn't release the subscription." }
  }

  const removed = await unsubscribePush(endpoint)
  if (!removed.ok) return { ok: false, error: removed.error }

  return { ok: true }
}
