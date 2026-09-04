"use client"

import dynamic from "next/dynamic"
import { useEffect, useRef, useState } from "react"
import { SkeletonLine } from "@/components/skeleton"
import { Viewhole, useViewhole } from "@/components/viewhole"
import type { GalaxyHandle, GalaxySnapshot } from "@/lib/galaxy/data"

/**
 * **Loaded on demand, and it has to be.**
 *
 * `components/galaxy-view.tsx` statically imports `pixi.js`, so importing it
 * the ordinary way puts the whole renderer in the client bundle of every route
 * that renders a card — Overview and a Circle's Today tab, which between them
 * are most of the app. That is precisely what the handoff's
 * `dynamic(ssr: false)` arrangement existed to prevent, and the first version
 * of this card lost it by importing the component directly.
 *
 * `ssr: false` is legal here because this file is a Client Component; Next 16
 * forbids it only in a Server Component, which is the reason the boundary is
 * drawn at this file rather than at the page.
 *
 * **No `loading`**: the card already renders a skeleton until `onReady`, and a
 * second placeholder underneath it would be two answers to the same question.
 */
const GalaxyView = dynamic(
  () => import("@/components/galaxy-view").then((m) => m.GalaxyView),
  { ssr: false },
)

/**
 * How long the frame takes, read from the stylesheet rather than restated here.
 *
 * **There were two constants and a comment telling the next person to keep them
 * in step.** A rule with no enforcement is a rule that gets broken by somebody
 * adjusting the CSS and never opening this file — and the symptom would be
 * subtle: a camera that settles slightly before or after the frame, which reads
 * as two events rather than one and is exactly the "clunky" this animation has
 * already been through once.
 *
 * `--viewhole-ms` is the single value now. The same trick `skyColorFrom` uses
 * for `--galaxy-sky`: the token is the source, and the code asks.
 */
const FALLBACK_MS = 420

const viewholeMs = (): number => {
  if (typeof window === "undefined") return FALLBACK_MS
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--viewhole-ms")
    .trim()
  const ms = raw.endsWith("ms")
    ? Number.parseFloat(raw)
    : raw.endsWith("s")
      ? Number.parseFloat(raw) * 1000
      : Number.NaN
  return Number.isFinite(ms) && ms > 0 ? ms : FALLBACK_MS
}

export type GalaxyCardProps = {
  snapshot: GalaxySnapshot
  /** The heading above the card, and the canvas's name if it ever needs one. */
  title: string
  /** Its `id`, so the section can be labelled without colliding on a page with two. */
  id: string
  /**
   * A shortcut to something the page already links to, or nothing.
   *
   * **Nothing is the right answer on a Circle**: those planets are other
   * people's goals, most of a member's row is already a link, and a hidden goal
   * has no destination at all.
   */
  onPlanetSelect?: (planetId: string) => void
  /**
   * The Circle's roster is frozen at a past instant — archived or locked.
   *
   * **The whole sky stops**, not just the backdrop. This was half an answer for
   * one release: the ambient effects were switched off and the orbits left
   * turning, which is motion standing for liveness that is not there. The
   * camera still works, because panning and focusing are things the viewer is
   * doing now rather than claims about the data.
   */
  frozen?: boolean
  /**
   * Show whose system the pointer is over, as `{label}'s galaxy`.
   *
   * **Off on a solo galaxy**, where there is one system and it is yours — a
   * label naming you, over your own sun, on your own dashboard.
   */
  namesOnHover?: boolean
  /**
   * Say why the canvas is missing, on screen, instead of removing the block.
   *
   * **Off everywhere except the lab.** For a person the galaxy is a reward and
   * its absence is not an error worth a sentence; for somebody holding a phone
   * trying to find out why nothing drew, the sentence is the entire point, and
   * a phone has no console to open.
   */
  explainAbsence?: boolean
  /**
   * Print what the renderer actually got, under the card.
   *
   * **Off everywhere except the lab.** A canvas that mounts and draws nothing
   * looks identical to a canvas that never mounted, and on a phone there is no
   * console to tell them apart — so this reports the facts the guessing would
   * otherwise be about: the backing store's size, the CSS size, the device
   * pixel ratio, and whether WebGL exists at all independently of Pixi.
   */
  showDiagnostics?: boolean
}

/**
 * Can this browser make a WebGL context **at all**, asked without Pixi.
 *
 * A separate probe on purpose: if `mountGalaxy` resolved and the picture is
 * blank, the question is no longer "is WebGL available" but "what did the
 * renderer do with it" — and the two are only distinguishable by asking them
 * separately. The probe's canvas is discarded immediately; a leaked context
 * would count against the handful iOS allows.
 */
const probeWebgl = (): string => {
  try {
    const canvas = document.createElement("canvas")
    const gl =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl")
    if (!gl) return "none"
    const context = gl as WebGLRenderingContext
    const size = context.getParameter(context.MAX_TEXTURE_SIZE) as number
    context.getExtension("WEBGL_lose_context")?.loseContext()
    return `${canvas.getContext("webgl2") ? "webgl2" : "webgl1"}, max texture ${size}`
  } catch (error) {
    return `threw: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * A galaxy in a card, with a frame that opens to full screen.
 *
 * **Both surfaces render this**: your own galaxy on Overview and the Circle's
 * sky above its roster. They differ in what a tap on a planet means and in
 * nothing else, so the shell — the heading, the frame, the skeleton, the
 * expand control and the camera move — lives here rather than in two files
 * that would agree only until one of them changed.
 *
 * ## It is a reward, never a way to use the app
 *
 * Everything in the canvas is already in text on the page it sits on: goals
 * with their controls, the roster, the streak. **If checking in were ever only
 * possible by tapping a planet the product would have a WebGL dependency for
 * its core loop** — on a device that may have lost its context, in a canvas no
 * screen reader enters. So the block removes itself when the canvas cannot
 * exist, with no message, because nothing the person came for is missing.
 *
 * ## The frame is the app's, not the galaxy's
 *
 * `rounded border`, the same card as every other block in the column, with the
 * sky reaching the border and no padding inside it. The module arrived styled
 * as its own thing — dark chips, a gold hover — and a component is not where a
 * second design system should enter an app.
 */
export function GalaxyCard({
  snapshot,
  title,
  id,
  onPlanetSelect,
  frozen = false,
  namesOnHover = false,
  explainAbsence = false,
  showDiagnostics = false,
}: GalaxyCardProps) {
  const [state, setState] = useState<"waiting" | "ready" | "absent">("waiting")
  const [reason, setReason] = useState<string | null>(null)
  const { open: expanded, setOpen, onCommit } = useViewhole()
  const handleRef = useRef<GalaxyHandle | null>(null)

  /**
   * Whose system the pointer is over, and where.
   *
   * **The name is DOM, not canvas.** The scene draws no text and is not going
   * to: a label rendered here is styled by the app, selectable, and does not
   * need a font atlas in a WebGL context that is already the largest thing on
   * the page. The module reports the member and a position; this decides what
   * to say.
   */
  const [hover, setHover] = useState<{
    label: string
    x: number
    y: number
  } | null>(null)

  /** Filled once the canvas exists, and only read when `showDiagnostics`. */
  const [facts, setFacts] = useState<string[] | null>(null)

  /**
   * **The first run is the mount, not an expand.** Without this the card played
   * the closing move the moment the canvas became ready — a zoom-out from
   * nothing, on a galaxy nobody had touched. The effect below keys on
   * `expanded`, and `false` is a value it has on arrival as well as after a
   * close.
   */
  const seenRef = useRef(false)

  /**
   * **Resize the canvas inside the transition, not a frame after it.**
   *
   * The frame's size is decided by CSS; the canvas's is not. Left to the
   * module's `ResizeObserver` the correction lands on the next frame — after
   * the browser has already photographed the new DOM — so the transition
   * animated toward a canvas still at its old size, and closing left a strip of
   * it hanging outside the card.
   */
  useEffect(() => onCommit(() => handleRef.current?.resize()), [onCommit])

  /**
   * **The camera travels rather than jumping.**
   *
   * The fit recomputes for the new viewport, so opening would snap straight to
   * the wide framing — the sky arriving before the eye does. This cancels that
   * out by zooming in by roughly the ratio the fit grew and easing back to 1,
   * so the picture starts at the size it was in the card and pulls back to
   * reveal what was always there.
   *
   * **`getCamera().zoom` and `zoomBy` are the whole API used.** The module has
   * a fit animation of its own for refits, and reaching into it from a host
   * would mean this file knowing about `baseFitScale`.
   */
  useEffect(() => {
    const handle = handleRef.current
    if (!handle || state !== "ready") return
    if (!seenRef.current) {
      seenRef.current = true
      return
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    // The commit above has already resized the canvas, so the fit is the new
    // one and this measures against the right thing.
    const from = expanded ? 1.3 : 0.82
    handle.zoomBy(from)

    let frame = 0
    const started = performance.now()
    const duration = viewholeMs()

    const step = (now: number) => {
      const t = Math.min(1, (now - started) / duration)
      // `cubic-bezier(0.22, 1, 0.36, 1)` to three places, so the camera and the
      // frame are on the same curve rather than on two that merely both ease.
      const eased = 1 - Math.pow(1 - t, 3)
      const target = from + (1 - from) * eased
      const current = handle.getCamera().zoom
      if (current > 0) handle.zoomBy(target / current)
      if (t < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [expanded, state])

  /**
   * **Cleared during render, not in an effect.**
   *
   * A name left over from before the frame opened, or from a snapshot that no
   * longer has that member in it, is a label pointing at nothing. The obvious
   * `useEffect(() => setHover(null), [expanded, snapshot])` trips
   * `react-hooks/set-state-in-effect` — and the rule is right: it schedules a
   * second render to undo something the first render already knew.
   *
   * `patterns.md` names the answer, in the three traps under "a cast standing
   * in for a check": adjust during render with the previous-value pattern.
   */
  const [lastKey, setLastKey] = useState<{ expanded: boolean; snapshot: GalaxySnapshot }>({
    expanded,
    snapshot,
  })
  if (lastKey.expanded !== expanded || lastKey.snapshot !== snapshot) {
    setLastKey({ expanded, snapshot })
    if (hover) setHover(null)
  }

  if (state === "absent") {
    if (!explainAbsence) return null
    return (
      <section aria-labelledby={id} className="flex flex-col gap-2">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        <p role="alert" className="rounded border px-3 py-2 text-sm text-red-600">
          The canvas could not start: {reason ?? "no reason given"}
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      {/*
        Named, because every locator in the e2e suite names a heading, a role, a
        label or a landmark — and an unnamed region beside named ones is the one
        a spec cannot describe. The canvas itself stays `aria-hidden`: it
        repeats what the page already said, in worse words.
      */}
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>

      {/*
        **`h-64 md:h-96`, and 384px is not an arbitrary number.**

        `isCompactLayout` is `width <= 420 || height <= 320`, and the first
        version of this card was 224px tall — so the galaxy was in compact mode
        on every screen, including a 27-inch monitor. Compact carries a
        different projection: a flatter tilt, a tighter star scale, a canvas
        that lets the page scroll through it.

        Above 320px the module measures a real desktop and picks the full
        layout itself, which is why `compact` is never passed: `compactHost` is
        `opts.compact ?? isCompactLayout(...)`, so supplying it at all replaces
        the answer rather than defaulting it.
      */}
      <Viewhole closedClassName="h-64 rounded border md:h-96">
        <GalaxyView
          snapshot={snapshot}
          /*
            **On, in both states.** The module's default is "controls only on a
            compact host", which is backwards for an embedded card: the desktop
            one is the surface a mouse can reach and the one where the viewing
            angle is worth changing. `attachCameraControls` decides *which*
            buttons from the input, so this is a yes/no rather than a layout
            choice.
          */
          cameraControls
          frozen={frozen}
          className="absolute inset-0"
          onReady={(handle) => {
            handleRef.current = handle
            setState("ready")
            if (showDiagnostics) {
              const canvas = handle.canvas
              const box = canvas.getBoundingClientRect()
              setFacts([
                `backing store ${canvas.width} × ${canvas.height}`,
                `css ${Math.round(box.width)} × ${Math.round(box.height)}`,
                `dpr ${window.devicePixelRatio}`,
                `webgl ${probeWebgl()}`,
                `systems ${snapshot.systems.length}, planets ${snapshot.systems.reduce(
                  (total, system) => total + system.planets.length,
                  0,
                )}`,
              ])
            }
          }}
          onUnavailable={(why) => {
            setReason(why)
            setState("absent")
          }}
          onPlanetSelect={onPlanetSelect}
          onSystemHover={
            namesOnHover
              ? (systemId, x, y) => {
                  if (!systemId) {
                    setHover(null)
                    return
                  }
                  // A coarse pointer gets no hover affordance: on a phone this
                  // fires around a tap and the name would stick.
                  if (window.matchMedia("(pointer: coarse)").matches) return
                  const label = snapshot.systems.find(
                    (system) => system.id === systemId,
                  )?.label
                  setHover(label ? { label, x, y } : null)
                }
              : undefined
          }
        />

        {/*
          **`aria-hidden`, and `pointer-events: none`.**

          Hidden because the roster underneath already names every member, in
          order, in text — this repeats it in worse words and would announce on
          every mouse move. Non-interactive because a label that sat under the
          cursor would trigger its own `pointerout` and flicker.

          Positioned from canvas coordinates, which are host coordinates because
          the canvas fills the host. `-translate-x-1/2` centres it on the thing
          it names and `-top` lifts it clear of the cursor.
        */}
        {hover ? (
          <span
            aria-hidden
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded border border-current bg-[var(--galaxy-sky)] px-2 py-1 text-xs text-[#f4f1de] opacity-90"
            style={{ left: hover.x, top: hover.y - 10 }}
          >
            {hover.label}&apos;s galaxy
          </span>
        ) : null}

        {/*
          Above the canvas in both states. `z-10` rather than a stacking
          accident: the canvas is a sibling Pixi appends after this renders, so
          source order alone would put it on top.
        */}
        {state === "ready" ? (
          <button
            type="button"
            onClick={() => setOpen(!expanded)}
            className="absolute right-2 top-2 z-10 rounded border border-current px-2 py-1 text-xs text-[#f4f1de] opacity-70 hover:opacity-100"
          >
            {expanded ? "Close" : "Expand"}
          </button>
        ) : null}

        {state === "waiting" ? (
          /*
            Over the canvas rather than instead of it: the host has to be in the
            document and have a size before `mountGalaxy` can measure it, so
            swapping it out for a skeleton would mean the mount never starts.
          */
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 flex items-center justify-center"
          >
            <span className="sr-only">Drawing the galaxy</span>
            <SkeletonLine className="h-24 w-24 rounded-full" />
          </div>
        ) : null}
      </Viewhole>

      {/*
        **Facts, not a guess.** A blank canvas and an absent canvas look the
        same on a phone, and the difference between them is the whole
        diagnosis. Anything zero here names the cause on its own: a backing
        store of 0 means the host was measured before it had a size, a css size
        of 0 means the frame collapsed, and `webgl none` means the picture was
        never possible.
      */}
      {showDiagnostics && facts ? (
        <ul className="rounded border px-3 py-2 text-xs opacity-70">
          {facts.map((fact) => (
            <li key={fact} className="tabular-nums">
              {fact}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
