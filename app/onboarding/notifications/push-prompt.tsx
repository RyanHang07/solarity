"use client"

import { useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { enablePush, permissionNow, pushSupported, type PushOutcome } from "@/lib/push-client"
import { PushDenied } from "@/components/push-denied"

/** Permission has no event worth subscribing to here; every change we cause
 *  re-renders this component anyway. */
const noSubscribe = () => () => {}
const serverState = () => "unknown" as const

function readState(): "ready" | "denied" | "unsupported" {
  if (!pushSupported()) return "unsupported"
  return permissionNow() === "denied" ? "denied" : "ready"
}

/**
 * Step 10c. The one place Solarity asks for notification permission.
 *
 * ## The prompt follows a tap, never a render
 *
 * A browser allows one ask per origin, and a denial is permanent until the
 * person goes and reverses it themselves. Asking on mount spends that single
 * chance before anyone has read why, which mostly buys a permanent no. So this
 * screen explains first and the button asks.
 *
 * ## A decline is an ending, not an error
 *
 * Skipping, dismissing the dialog and being blocked are all legitimate places
 * to stop, and none of them is styled as a failure. Only a genuine breakage
 * says something went wrong, and it says what.
 *
 * ## Nothing here reports success it did not get
 *
 * `enablePush` names its outcome, and this renders that. "Notifications are on"
 * over a subscription that was never written is the worst outcome available: it
 * stops people expecting a reminder that will never arrive.
 */
export function PushPrompt({ next }: { next: string }) {
  const router = useRouter()
  const [outcome, setOutcome] = useState<PushOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  // Client-only facts, so the server renders the neutral case and the browser
  // settles it. `useSyncExternalStore` with a distinct server snapshot reads
  // one without a hydration mismatch, the same way the username form reads the
  // timezone. An effect plus `setState` would give the same answer, an extra
  // render, and a lint error.
  //
  // It re-reads on every render, which is what keeps it honest after the ask:
  // recording the outcome re-renders, and the permission is read again then.
  const state = useSyncExternalStore(noSubscribe, readState, serverState)

  async function ask() {
    setAsking(true)
    setError(null)

    // `enablePush` names every outcome it knows about, but it cannot promise it
    // will never throw. A stuck "Waiting for your answer…" is the one ending
    // this screen must not have: it looks like the browser is still deciding,
    // so nobody clicks again.
    try {
      const result = await enablePush()
      setOutcome(result.outcome)
      setError(result.error ?? null)
    } catch {
      setOutcome("failed")
      setError("Something interrupted that. Try again.")
    } finally {
      setAsking(false)
    }
  }

  const done = outcome === "subscribed"
  const blocked = state === "denied" || outcome === "denied"

  return (
    <div className="flex w-full max-w-xs flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">
          {done ? "Notifications are on" : "Get a nudge when it matters"}
        </h1>
        <p className="text-sm opacity-70">
          {done
            ? "We'll let you know when your Circle is waiting on you. You can turn this off in settings."
            : "One notification a day, at most: how your Circle did, and whether anyone is waiting on you. Nothing else."}
        </p>
      </div>

      {blocked ? <PushDenied /> : null}

      {state === "unsupported" ? (
        <p className="text-sm opacity-80">
          This browser can&apos;t send notifications. On an iPhone, add Solarity
          to your home screen first, then open it from there.
        </p>
      ) : null}

      {outcome === "dismissed" ? (
        <p className="text-sm opacity-80">
          No answer given, so nothing has changed. You can try again here or from
          settings later.
        </p>
      ) : null}

      {outcome === "failed" && error ? (
        // The only branch that is actually an error, and it says what happened
        // rather than "something went wrong".
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {!done && !blocked && state !== "unsupported" ? (
        <button
          type="button"
          onClick={ask}
          disabled={asking || state === "unknown"}
          className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {asking ? "Waiting for your answer…" : "Turn on notifications"}
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => router.push(next)}
        className="rounded border px-4 py-2 text-sm font-medium"
      >
        {done ? "Continue" : "Not now"}
      </button>

      {!done ? (
        <p className="text-xs opacity-60">
          You can turn notifications on later in settings.
        </p>
      ) : null}
    </div>
  )
}
