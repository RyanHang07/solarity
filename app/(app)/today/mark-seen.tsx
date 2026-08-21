"use client"

import { useEffect, useRef } from "react"
import { markTodaySeen } from "@/app/actions/today"
import type { TodayMode } from "@/lib/today-gate"

/**
 * Tells the server this device has now been shown the screen.
 *
 * Cookies cannot be written during a render, so the page paints and this fires
 * once afterwards. Same shape as `MarkRead` in the notifications panel.
 *
 * **Fire and forget.** A failure means you see the screen again later, which is
 * the harmless direction, and an error banner over a page you are already
 * looking at would be noise about nothing you asked for.
 */
export function MarkSeen({ mode }: { mode: TodayMode }) {
  const fired = useRef(false)

  useEffect(() => {
    // `never` has nothing to remember: the gate short-circuits on the mode and
    // never consults a cookie, so writing one would be a value with no reader.
    if (mode === "never" || fired.current) return
    fired.current = true
    void markTodaySeen(mode)
  }, [mode])

  return null
}
