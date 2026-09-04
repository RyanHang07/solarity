"use client"

import { GalaxyCard } from "@/components/galaxy-card"
import type { RosterMember } from "@/lib/roster"
import { buildCircleSnapshot } from "@/lib/galaxy/solarity/snapshots"

/**
 * Step 24. The Circle's sky, above its roster on the Today tab.
 *
 * ## Built here rather than on the server
 *
 * The page already has the roster — that is the whole read — and
 * `buildCircleSnapshot` is a pure function over it, behind `lib/galaxy/data`
 * which is proven to reach no renderer code. Building it in the client
 * component means **one payload rather than two**: the roster is already going
 * over the wire for `TodayRoster`, and serialising a second derived copy of the
 * same facts would double it for a picture of what the list beside it says.
 *
 * ## No planet taps
 *
 * These are other people's goals. A hidden one has no destination at all, the
 * rest are already named in the row below, and a canvas that navigated on a
 * mis-tap would be doing something the roster does better. **Tapping a sun
 * still flies to that member** — that is the module's own default and it is
 * about looking rather than about going somewhere.
 *
 * ## A frozen Circle
 *
 * An archived or locked Circle's roster is frozen at a past instant, so its
 * numbers stopped changing then. The backdrop is switched off, because a sky
 * that keeps drifting implies live data where there is none. **The orbits still
 * turn**, which is a partial answer: the module has no pause, and adding one is
 * scene work rather than a prop.
 */
export function CircleGalaxyPanel({
  members,
  frozen,
}: {
  members: RosterMember[]
  frozen: boolean
}) {
  return (
    <GalaxyCard
      id="circle-galaxy-heading"
      title="This Circle's sky"
      snapshot={buildCircleSnapshot(members)}
      ambientEffects={!frozen}
      /*
        **Only here.** A solo galaxy has one system and it is yours, so a label
        naming you over your own sun says nothing. In a Circle it answers the
        question the picture actually raises.
      */
      namesOnHover
    />
  )
}
