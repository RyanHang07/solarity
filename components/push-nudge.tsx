"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { dismissPushNudgeAction } from "@/app/actions/push"
import { pushEnabledHere, pushSupported } from "@/lib/push-client"

/**
 * Step 10f. One line for people who never turned notifications on.
 *
 * ## Shown to exactly one group
 *
 * Permission `default` **and** this browser holds no subscription. Everyone
 * else has already decided, and a suggestion aimed at someone who has decided
 * is just noise:
 *
 * | Who | Why not |
 * |---|---|
 * | Already subscribed | nothing to suggest |
 * | Permission `denied` | this cannot fix it; settings has the help links |
 * | Dismissed this before | they said no once, on this device |
 * | A browser that cannot do push | suggesting it would be a lie |
 *
 * ## It renders nothing until it knows
 *
 * All three facts are client-side and one of them needs a round trip, so the
 * first paint is deliberately empty rather than optimistic. A line that appears
 * and then vanishes is worse than one that arrives a beat late — especially
 * this one, which would flash at the very people who already said yes.
 *
 * ## It links rather than asks
 *
 * The real `requestPermission` stays in the two places that explain themselves
 * first: onboarding and settings. A prompt fired from a notifications list
 * would spend the single ask a browser grants on someone who came here to read
 * something else.
 */
export function PushNudge({ dismissed }: { dismissed: boolean }) {
  const [show, setShow] = useState(false)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (dismissed) return

    let alive = true
    void (async () => {
      if (!pushSupported() || Notification.permission !== "default") return
      // The server's answer, not just the browser's: an endpoint can belong to
      // another account after a shared sign-in. Same reason the settings toggle
      // asks.
      const already = await pushEnabledHere()
      if (alive && !already) setShow(true)
    })()

    return () => {
      alive = false
    }
  }, [dismissed])

  if (!show || gone) return null

  return (
    <div className="flex flex-col gap-1 rounded border px-3 py-2 text-sm">
      <p>
        Solarity can tell you when your Circle is waiting on you. At most one
        notification a day.
      </p>
      <div className="flex gap-3">
        <Link href="/settings#notifications" className="underline">
          Turn on notifications
        </Link>
        <button
          type="button"
          onClick={() => {
            // Hidden immediately, remembered in the background. The write is
            // fire and forget: if it fails the line returns next visit, which
            // is the harmless direction, and an error about dismissing a
            // suggestion would be worse than the suggestion.
            setGone(true)
            void dismissPushNudgeAction().catch(() => {})
          }}
          className="underline opacity-70"
        >
          No thanks
        </button>
      </div>
    </div>
  )
}
