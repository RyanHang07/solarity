"use client"

import { useRouter } from "next/navigation"
import { GalaxyCard } from "@/components/galaxy-card"
import type { GalaxySnapshot } from "@/lib/galaxy/data"

/**
 * Step 22. Your galaxy, on Overview.
 *
 * **First on the page.** It was under Today for one release, on the argument
 * that the thing you came to do should lead. That is true of the *goals*, which
 * are one scroll away either way; Overview's job is to say where you stand, and
 * the galaxy says it in the form worth looking at. The cost is that the block
 * most likely to be absent is the first one, which is survivable because it
 * removes itself cleanly rather than leaving a hole.
 *
 * Everything else — the card, the frame that opens, the camera move — is
 * `GalaxyCard`, shared with the Circle sky. **The only thing this surface
 * decides is what a tap on a planet means**, and here it means the goal, which
 * is a shortcut to a page the list below already links to and never the only
 * way there.
 */
export function GalaxyPanel({ snapshot }: { snapshot: GalaxySnapshot }) {
  const router = useRouter()

  return (
    <GalaxyCard
      id="galaxy-heading"
      title="Your galaxy"
      snapshot={snapshot}
      onPlanetSelect={(goalId) => {
        router.push(`/dashboard/goals/${goalId}`)
      }}
    />
  )
}
