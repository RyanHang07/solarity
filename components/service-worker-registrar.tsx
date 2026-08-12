"use client"

import { useEffect } from "react"

/**
 * Registers the service worker. Mounted in the root layout.
 *
 * Deliberately does not request notification permission — that belongs in
 * onboarding, after the install nudge. See architecture.md section 7b.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed", err)
    })

    // Re-subscription has to happen in a window context: it needs the VAPID
    // public key and an authenticated call.
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "RESUBSCRIBE_PUSH") {
        // TODO: call the resubscribe path once push opt-in exists in onboarding.
        console.info("Push subscription changed; re-subscription needed")
      }
    }

    navigator.serviceWorker.addEventListener("message", onMessage)
    return () => navigator.serviceWorker.removeEventListener("message", onMessage)
  }, [])

  return null
}
