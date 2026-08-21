"use client"

import { useEffect } from "react"
import { resubscribeIfPermitted } from "@/lib/push-client"

/**
 * Registers the service worker. Mounted in the root layout.
 *
 * Deliberately does not request notification permission — that belongs in
 * onboarding, after the install nudge. See architecture/app.md section 7b.
 *
 * It does repair a subscription the push service has rotated, which is a
 * different thing: no dialog, no ask, and only for someone who already agreed.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed", err)
    })

    // Re-subscription has to happen in a window context: it needs the VAPID
    // public key and an authenticated call.
    //
    // **Step 10e.** A push service can invalidate a device's subscription and
    // issue a new one, and **nothing errors when it does**. Delivery just stops.
    // The worker notices and posts here; until now this only logged.
    //
    // `resubscribeIfPermitted` never prompts. It repairs a registration for
    // someone who already said yes, and returns `denied` for anyone who has
    // not — spending the one prompt a browser grants on a background event
    // nobody saw would be the worst possible place to spend it.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== "RESUBSCRIBE_PUSH") return

      // Fire and forget, deliberately. Nobody asked for this and nobody is
      // watching it: the person is on some other screen entirely. A failure
      // means push stays broken until the next repair or a visit to settings,
      // which is where a visible answer belongs.
      void resubscribeIfPermitted().catch(() => {})
    }

    navigator.serviceWorker.addEventListener("message", onMessage)
    return () => navigator.serviceWorker.removeEventListener("message", onMessage)
  }, [])

  return null
}
