"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

/**
 * 8g phase 1. Re-runs the server component when you come back to the tab.
 *
 * The roster is a server render, so a circle-mate checking in on their phone
 * leaves your view stale until you reload. This is the smallest thing that
 * fixes that: no new endpoint, no new policy, nothing to get wrong.
 *
 * **Realtime is the trap, and it does not work here.** `progress_entries` and
 * `goals` are both `user_id = auth.uid()` since migration 64, and Supabase
 * Realtime respects RLS, so a circle-mate would receive nothing at all.
 * Loosening those policies to make it work would re-open the exact leak
 * migration 64 closed. Read build-plan.md 8g before reaching for it.
 *
 * **`visibilitychange`, not `focus`.** On desktop `focus` fires every time the
 * window regains focus, including alt-tabbing away to copy a link and back.
 * That is a server round trip for a number that changes a few times a day.
 * Visibility fires on the case that matters: the tab was hidden, or the phone
 * was in a pocket, and now it is not.
 *
 * Silent by design. No spinner and no "updated just now": the numbers are the
 * message, and a page that announces its own refetching draws attention to
 * plumbing.
 */

/**
 * The floor between refreshes.
 *
 * Exported because the e2e test has to cross it deliberately. A test that
 * dispatches `visibilitychange` immediately after load is exercising the
 * throttle, not the refresh, and would pass while the feature was broken.
 */
export const MIN_GAP_MS = 30_000

export function RefreshOnReturn() {
  const router = useRouter()

  const lastRefresh = useRef(0)

  useEffect(() => {
    // Seeded here rather than as `useRef(Date.now())`. `Date.now` is impure and
    // calling it during render is a React Compiler error, since a re-render
    // would quietly move the throttle's starting point.
    //
    // Seeded at all, rather than left at zero, because the data is fresh when
    // the page renders and a refresh a second later is pure cost.
    lastRefresh.current = Date.now()

    function onVisibilityChange() {
      // Fires on both edges. Becoming hidden is not a return.
      if (document.visibilityState !== "visible") return

      const now = Date.now()
      if (now - lastRefresh.current < MIN_GAP_MS) return
      lastRefresh.current = now

      // Re-runs the server component and re-reads `circle_roster`. Not
      // `location.reload()`, which would throw away client state and flash the
      // whole page for a two-digit change.
      router.refresh()
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => document.removeEventListener("visibilitychange", onVisibilityChange)
  }, [router])

  return null
}
