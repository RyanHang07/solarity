"use client"

import { useEffect, useState } from "react"
import { disablePush, enablePush, pushEnabledHere, pushSupported } from "@/lib/push-client"
import { PushDenied } from "@/components/push-denied"

type ToggleState = "loading" | "on" | "off" | "denied" | "unsupported" | "unknown"

/**
 * Module level, and awaited before anything is set, so the effect below never
 * calls `setState` synchronously. The three questions in order: can this browser
 * do it, is it allowed to, and is it still ours.
 *
 * **`unknown` is passed straight through rather than folded into `off`.** The
 * manual pass found this screen offering to turn on notifications that were
 * already on, because every way of failing to find out rendered as an off
 * switch. See `pushEnabledHere`.
 */
async function readToggleState(): Promise<ToggleState> {
  if (!pushSupported()) return "unsupported"
  if (Notification.permission === "denied") return "denied"
  return await pushEnabledHere()
}

/**
 * Step 10d. Notifications for **this device**, in settings.
 *
 * ## Why it is not a checkbox
 *
 * There are three permission states and the third has no switch at all:
 *
 * | Permission | What this renders |
 * |---|---|
 * | `default` | an off switch that asks when tapped |
 * | `granted` | on or off, writing and deleting the subscription |
 * | `denied` | **not a switch.** The sentence and the help links from 10c |
 *
 * A control that cannot do the thing it depicts is worse than no control: it
 * invites a tap, does nothing, and leaves the person believing they turned
 * something on.
 *
 * ## Per device, not per account
 *
 * Push goes to browsers, so "notifications are on" is only ever true of the one
 * you are holding. The heading says so, because a page-level switch would imply
 * a promise the sender cannot keep on the phone you left at home.
 *
 * Not a device list either: `device_label` exists, but naming devices from a
 * user agent reads as wrong more often than it helps.
 *
 * ## It asks the server, not just the browser
 *
 * `pushEnabledHere` checks the row as well as the local subscription, because a
 * browser keeps its `PushSubscription` across sign-ins and `subscribe_push`
 * hands an endpoint to whoever subscribed last. Trusting the local answer would
 * show "on" to someone whose endpoint now belongs to a flatmate.
 */
export function PushToggle() {
  const [state, setState] = useState<ToggleState>("loading")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  async function refresh() {
    setState(await readToggleState())
  }

  useEffect(() => {
    // Settled in a callback rather than in the effect body, which is both what
    // the lint rule wants and what the situation is: the answer lives behind a
    // service worker and a round trip, so there is nothing to set until it
    // arrives. `alive` drops a result that lands after the page has moved on.
    let alive = true
    readToggleState().then((next) => {
      if (alive) setState(next)
    })
    return () => {
      alive = false
    }
  }, [])

  async function turnOn() {
    setBusy(true)
    setMessage(null)
    setFailed(false)

    let result
    try {
      result = await enablePush()
    } catch {
      setFailed(true)
      setMessage("Something interrupted that. Try again.")
      setBusy(false)
      return
    }

    if (result.outcome === "subscribed") {
      setState("on")
      setMessage("Notifications are on for this device.")
    } else if (result.outcome === "denied") {
      // Permanent, and the only honest thing left is the explanation.
      setState("denied")
    } else if (result.outcome === "dismissed") {
      setMessage("No answer given, so nothing changed.")
    } else {
      setFailed(true)
      setMessage(result.error ?? "We couldn't turn notifications on.")
    }

    setBusy(false)
  }

  async function turnOff() {
    setBusy(true)
    setMessage(null)
    setFailed(false)

    let result
    try {
      result = await disablePush()
    } catch {
      setFailed(true)
      setMessage("Something interrupted that. Try again.")
      void refresh()
      setBusy(false)
      return
    }

    if (result.ok) {
      setState("off")
      setMessage("Notifications are off for this device.")
    } else {
      setFailed(true)
      setMessage(result.error ?? "We couldn't turn notifications off.")
      // The truth may now differ from what was shown, and guessing is what
      // makes a toggle lie.
      void refresh()
    }

    setBusy(false)
  }

  return (
    <section id="notifications" aria-label="Notifications" className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Notifications on this device</h2>
      {/*
        **"At most one a day" was true until step 19 and is not any more.** It
        was a promise on a settings screen, and the honest replacement names
        both halves: the digest that always arrives, and the intraday updates
        that have their own switches below. Leaving the old sentence would have
        been the same class of drift as the policy pages promising notice
        nothing implements.
      */}
      <p className="text-sm opacity-70">
        Your daily digest, plus whichever updates you keep switched on below.
        Each device is separate, so turning this on here doesn&apos;t turn it on
        anywhere else.
      </p>

      {state === "denied" ? <PushDenied /> : null}

      {state === "unsupported" ? (
        <p className="text-sm opacity-80">
          This browser can&apos;t send notifications. On an iPhone, add Solarity
          to your home screen and open it from there.
        </p>
      ) : null}

      {/*
        **Neither a switch nor silence.** The check did not complete, usually a
        service worker that never became ready, so the honest thing is to say
        what happened and offer the check again. Drawing an off switch here is
        the bug this state exists to end: it invited a tap that would have
        re-subscribed a device already subscribed, and told the person their
        notifications were off when they were not.
      */}
      {state === "unknown" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm opacity-80">
            Couldn&apos;t check whether notifications are on for this device.
            They may well be. This usually means the app was still waking up.
          </p>
          <button
            type="button"
            onClick={() => {
              setState("loading")
              void refresh()
            }}
            className="self-start rounded border px-4 py-2 text-sm font-medium"
          >
            Check again
          </button>
        </div>
      ) : null}

      {state === "on" || state === "off" ? (
        <button
          type="button"
          onClick={state === "on" ? turnOff : turnOn}
          disabled={busy}
          className="self-start rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy
            ? "Working…"
            : state === "on"
              ? "Turn off notifications"
              : "Turn on notifications"}
        </button>
      ) : null}

      {message ? (
        <p
          // Only a real breakage is an alert. "Nothing changed" and "they're off
          // now" are outcomes someone chose, and announcing them as errors is
          // how people learn to ignore the ones that matter.
          role={failed ? "alert" : "status"}
          className={failed ? "text-sm text-red-600" : "text-sm opacity-70"}
        >
          {message}
        </p>
      ) : null}
    </section>
  )
}
