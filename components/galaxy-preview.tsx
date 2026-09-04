"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import type { GalaxySnapshot } from "@/lib/galaxy/data"

/**
 * **Loaded on demand, for the same reason `galaxy-card.tsx` is.**
 *
 * `components/galaxy-view.tsx` imports `pixi.js` statically, so importing it the
 * ordinary way would put the whole renderer in the client bundle of the
 * onboarding route — a route every new account walks through on a phone, on a
 * connection nobody chose. `ssr: false` is legal here because this file is a
 * Client Component.
 */
const GalaxyView = dynamic(
  () => import("@/components/galaxy-view").then((m) => m.GalaxyView),
  { ssr: false },
)

/**
 * A galaxy with nothing around it: no heading, no expand, no camera bar.
 *
 * ## Why this is not `GalaxyCard` with the chrome switched off
 *
 * `GalaxyCard` is a *block on a page*: a titled section that expands to full
 * screen, drives a view transition, names members on hover and reports its own
 * diagnostics. Every one of those is wrong here. This is a picture beside a
 * form — it answers "what am I making" while somebody's thumb is on a picker,
 * and a control on it is a way to leave the form by accident.
 *
 * Adding four "off" props to the card would have been the smaller diff and the
 * worse shape: the card would grow a second personality maintained for one
 * caller, and the next person changing the card would have two surfaces to
 * think about. They share `GalaxyView`, which is the part worth sharing.
 *
 * ## It vanishes rather than explaining itself
 *
 * **This sits on the one screen in the product nobody can skip.** No WebGL, a
 * refused context, an old device — none of that may stand between a person and
 * finishing sign-up, so the picture removes itself and the form is simply on
 * its own. That is the same rule every galaxy surface follows, and here it is
 * load-bearing rather than tidy.
 */
export function GalaxyPreview({
  snapshot,
  className = "h-48 w-full overflow-hidden rounded border",
}: {
  snapshot: GalaxySnapshot
  className?: string
}) {
  const [absent, setAbsent] = useState(false)
  if (absent) return null

  return (
    <div className={`relative ${className}`}>
      <GalaxyView
        snapshot={snapshot}
        /*
          **Off.** There is nothing to navigate to — the goal does not exist
          yet — and a pan control beside a form is a way to lose the form.
        */
        cameraControls={false}
        className="absolute inset-0"
        onUnavailable={() => {
          setAbsent(true)
        }}
      />
    </div>
  )
}
