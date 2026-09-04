"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { GalaxyCard } from "@/components/galaxy-card"
import { ViewholeProvider } from "@/components/viewhole"
import { GOAL_CATEGORIES } from "@/lib/galaxy/data"
import { buildCircleSnapshot } from "@/lib/galaxy/solarity/snapshots"
import type { RosterGoal, RosterMember } from "@/lib/roster"

/**
 * **Ids are uuid-shaped, and that is not decoration.**
 *
 * The shape of an id has already caused a shipped bug in this renderer: an
 * FNV-1a hash taken `% 6` distributes evenly over short strings like `member-3`
 * and reaches only three of six buckets over uuids, so three planet surfaces
 * were unreachable in production and invisible in every harness that used
 * friendly ids. A lab that fabricates `member-1` would measure a picture the
 * app cannot draw.
 *
 * Deterministic per index as well, so stepping the count up and down does not
 * reshuffle who is who — the layout's promise is that a member keeps their slot
 * when somebody else arrives, and a harness that renamed everybody on every
 * change could not show it.
 */
const fakeId = (kind: number, a: number, b = 0): string => {
  const hex = (n: number, width: number) => n.toString(16).padStart(width, "0")
  return `${hex(kind, 2)}${hex(a, 6)}-${hex(b, 4)}-4000-8000-${hex(a * 97 + b, 12)}`
}

const MAX = 10

const fakeGoals = (member: number, count: number): RosterGoal[] =>
  Array.from({ length: count }, (_, g) => ({
    id: fakeId(0x9a, member, g + 1),
    title: `Goal ${g + 1}`,
    hidden: false,
    // Half checked off, so the scene carries both states: a shining planet
    // costs more to draw than an idle one, and a Circle that was all of one or
    // all of the other would measure half the picture.
    checked: (member + g) % 2 === 0,
    // Every category in rotation, so the colour mix and the sky's blended
    // palette are the ones a real Circle produces.
    category_slug:
      GOAL_CATEGORIES[(member + g) % GOAL_CATEGORIES.length]?.slug ?? "other",
    belt_visible: (member * 7 + g) % 5 === 0,
    note: null,
    entry_id: null,
    note_shared: false,
    photoUrl: null,
  }))

const fakeMembers = (members: number, goals: number): RosterMember[] =>
  Array.from({ length: members }, (_, m) => ({
    user_id: fakeId(0x5e, m + 1),
    username: `member${m + 1}`,
    display_name: `Member ${m + 1}`,
    avatarUrl: null,
    role: m === 0 ? "owner" : "member",
    is_self: m === 0,
    streak_grace: false,
    circle_status: "active",
    as_of: null,
    checkin_date: "2026-09-03",
    // An hour apart, ascending, so the sort by join time has something to sort.
    joined_at: new Date(Date.UTC(2026, 0, 1, m)).toISOString(),
    checked_count: 0,
    total_count: goals,
    all_completed: m % 3 === 0,
    sky_closed: false,
    achievement_count: 40,
    // **Null, so the lab measures the derived colours.** Ten members that all
    // stored the same preset would be ten identical suns, which is exactly the
    // picture `memberSun.ts` exists to prevent and the one worth watching for.
    sun_preset_id: null,
    goals: fakeGoals(m + 1, goals),
  }))

/**
 * Frames per second, and the worst frame since the last reset.
 *
 * **The worst frame is the number that matters.** An average of 58fps hides the
 * 120ms stall when a member joins, and the stall is what a person notices — so
 * this reports both and gives the worst one its own reset, because a single
 * stall during startup would otherwise poison the reading for the rest of the
 * session.
 *
 * `requestAnimationFrame` deltas rather than a `PerformanceObserver`: this has
 * to run in Safari on a phone, which is the whole point of the page.
 */
function useFrameRate() {
  const [fps, setFps] = useState(0)
  const [worst, setWorst] = useState(0)
  const worstRef = useRef(0)

  useEffect(() => {
    let frame = 0
    let last = performance.now()
    let frames = 0
    let since = last

    const tick = (now: number) => {
      const delta = now - last
      last = now
      frames += 1

      // The first frame after mount is not a frame anyone saw.
      if (delta > worstRef.current && frames > 1) {
        worstRef.current = delta
        setWorst(delta)
      }

      if (now - since >= 500) {
        setFps((frames * 1000) / (now - since))
        frames = 0
        since = now
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  return {
    fps,
    worst,
    resetWorst: () => {
      worstRef.current = 0
      setWorst(0)
    },
  }
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (next: number) => void
}) {
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="opacity-70">{label}</span>
      <button
        type="button"
        aria-label={`One fewer ${label}`}
        onClick={() => onChange(Math.max(1, value - 1))}
        className="rounded border px-2 py-1 text-xs"
      >
        −
      </button>
      <output className="w-6 text-center tabular-nums">{value}</output>
      <button
        type="button"
        aria-label={`One more ${label}`}
        onClick={() => onChange(Math.min(MAX, value + 1))}
        className="rounded border px-2 py-1 text-xs"
      >
        +
      </button>
    </span>
  )
}

export function GalaxyLab() {
  /**
   * **Starts small and is stepped up, rather than starting at the load case.**
   *
   * A lab that opens at 10 × 10 teaches nothing if 10 × 10 is the thing that
   * fails: the canvas is absent, there is no curve, and the only reading is
   * "no". Three by three mounts on anything, and walking the counts up finds
   * *where* it stops — which is the number worth writing down, and the one a
   * fallback would be chosen against.
   */
  const [members, setMembers] = useState(3)
  const [goals, setGoals] = useState(3)
  const { fps, worst, resetWorst } = useFrameRate()

  /**
   * **Memoised on the two numbers**, so a re-render from the fps readout does
   * not rebuild the roster and hand `GalaxyCard` a new snapshot identity twenty
   * times a second. Without this the thing being measured would be measuring
   * the measurement.
   */
  const snapshot = useMemo(
    () => buildCircleSnapshot(fakeMembers(members, goals)),
    [members, goals],
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Galaxy lab</h2>
        <p className="text-sm opacity-70">
          A fabricated Circle, drawn by the real renderer on this device.{" "}
          <strong>Nothing is written</strong> — no members, no goals, nothing to
          clean up.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded border px-3 py-2">
        <Stepper label="members" value={members} onChange={setMembers} />
        <Stepper label="goals each" value={goals} onChange={setGoals} />
        <span className="text-sm tabular-nums opacity-70">
          {members * goals} planets
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded border px-3 py-2 text-sm">
        <span className="tabular-nums">{fps.toFixed(0)} fps</span>
        {/*
          **The worst frame, in milliseconds, and it is the headline.** 16.7ms is
          a clean 60; anything over about 50 is a visible hitch. It has its own
          reset because one stall while the textures upload would otherwise
          stand for the whole session.
        */}
        <span className="tabular-nums">
          worst frame {worst.toFixed(0)}ms
        </span>
        <button
          type="button"
          onClick={resetWorst}
          className="rounded border px-2 py-1 text-xs opacity-70"
        >
          Reset worst
        </button>
      </div>

      {/*
        The real card, not a copy of it: the same skeleton, the same expand, the
        same camera move, the same `dynamic` boundary. A lab that rendered
        `GalaxyView` directly would measure something the app does not ship.
      */}
      <ViewholeProvider>
        <GalaxyCard
          id="galaxy-lab-heading"
          title={`${members} members, ${goals} goals each`}
          snapshot={snapshot}
          namesOnHover
          /*
            **The one caller that shows the failure.** Everywhere else the
            galaxy is a reward and its absence is not worth a sentence; here
            the sentence is the point, and a phone has no console to open.
          */
          explainAbsence
          showDiagnostics
        />
      </ViewholeProvider>

      <p className="text-xs opacity-60">
        Expand it, drag it, and step the counts while watching the worst frame.
        The number to write down is the worst frame at ten by ten, on the device
        you expect people to use.
      </p>
    </div>
  )
}
