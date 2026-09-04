"use client"

import dynamic from "next/dynamic"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
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
 * What `env(safe-area-inset-*)` actually resolves to on this device.
 *
 * **Because the first fix for the notch changed nothing and there were two
 * candidates**: the rule not matching, or the inset coming back zero. Reasoning
 * could not separate them — both produce a Close button under the Dynamic
 * Island — and `env()` cannot be read from JavaScript directly, so this asks
 * the layout engine by making an element that uses it and reading back what it
 * computed.
 *
 * `black-translucent` is the suspect: it asks the content to draw under the
 * status bar, and on some iOS versions the inset that would pay that back
 * reports as nothing. The floor in `globals.css` covers either answer; this
 * says which one it was, which is what stops the next person re-deriving it.
 *
 * Also reports `display-mode`, because the floor is conditioned on it and "the
 * padding did not apply" and "the app is not actually running standalone" look
 * identical from the outside.
 */
const probeSafeArea = (): string => {
  const probe = document.createElement("div")
  probe.style.cssText =
    "position:fixed;visibility:hidden;pointer-events:none;" +
    "padding-top:env(safe-area-inset-top);" +
    "padding-right:env(safe-area-inset-right);" +
    "padding-bottom:env(safe-area-inset-bottom);" +
    "padding-left:env(safe-area-inset-left)"
  document.body.appendChild(probe)
  const style = getComputedStyle(probe)
  const sides = [
    style.paddingTop,
    style.paddingRight,
    style.paddingBottom,
    style.paddingLeft,
  ].join(" / ")
  probe.remove()

  const standalone = window.matchMedia("(display-mode: standalone)").matches
  return `${sides} — ${standalone ? "standalone" : "browser tab"}`
}

/**
 * Is the OS asking for less motion, right now?
 *
 * ## Why this is worth a line on screen
 *
 * The renderer honours `prefers-reduced-motion` by holding every orbit still
 * while drawing the sky perfectly. **That is correct and it is indistinguishable
 * from a broken renderer**, which is not a hypothetical: the first person
 * outside the project reported "their planets aren't moving" and the cause was
 * a setting on their phone that nobody could see from here. A still picture
 * with no explanation is a bug report waiting to happen.
 *
 * ## Subscribed rather than read once
 *
 * `mountGalaxy` reads the preference at mount and the scene keeps that answer
 * for its lifetime, so a person toggling the setting in another app comes back
 * to a canvas that has not changed. This *does* update — which is the honest
 * behaviour for a caption, because it describes the system setting rather than
 * the renderer's copy of it. The gap is one reload wide and only in the
 * direction of the line appearing before the orbits stop.
 *
 * `getServerSnapshot` is `false`: there is no media query on a server, and
 * guessing `true` would render a sentence the client immediately removes.
 */
const subscribeToMotion = (onChange: () => void) => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)")
  query.addEventListener("change", onChange)
  return () => {
    query.removeEventListener("change", onChange)
  }
}
const readMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
const motionOnServer = () => false

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
  const reducedMotion = useSyncExternalStore(
    subscribeToMotion,
    readMotion,
    motionOnServer,
  )

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

  /**
   * The timer that ends a **tapped** name.
   *
   * A mouse says when it left. A finger does not: the leave arrives as the
   * finger lifts, so a name shown on tap and hidden on leave is a name that
   * never outlives the tap asking for it. On a coarse pointer the leave is
   * ignored and this expires the label instead.
   */
  const hoverTimer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (hoverTimer.current) window.clearTimeout(hoverTimer.current)
    },
    [],
  )

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
   * **What the frame's state means to the canvas**, applied before the camera
   * animation below — effects run in declaration order, so this settles the
   * framing the animation then eases away from and back to.
   *
   * Two things, and they are the same thing seen from either side:
   *
   * **Full screen takes the gesture.** An embedded card lets a one-finger drag
   * scroll the page, which on iOS costs the pinch entirely: once `touch-action`
   * names a browser gesture, two fingers become a page zoom and the canvas is
   * sent `pointercancel`. Full screen there is nothing behind it to scroll, so
   * the canvas keeps the pointers and pinch works.
   *
   * **Closing goes home.** Whatever was panned, zoomed or focused was done to
   * look around a picture that filled the screen, and it does not survive into
   * a 256px card: a member focused at 3× fills the card with one sun and no
   * context, which reads as the galaxy having broken rather than as the camera
   * being where it was left. The expanded view is the place to explore; the
   * card is a glance, and a glance has one framing.
   */
  useEffect(() => {
    const handle = handleRef.current
    if (!handle || state !== "ready") return
    handle.setPageScrollThrough(!expanded)
    if (!expanded) handle.resetCamera()
  }, [expanded, state])

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
          /*
            **`galaxy-expanded` is what moves the camera bar off the home
            indicator**, and it is a class rather than a `[data-open]` rule
            because two attempts at the latter changed nothing on the device
            while the inset itself measured 62 / 34. React writes this one, so
            there is no selector left to be wrong about.

            The host still fills the frame: the sky reaches every edge and only
            the controls come in.
          */
          className={`absolute inset-0${expanded ? " galaxy-expanded" : ""}`}
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
                `safe area ${probeSafeArea()}`,
                /*
                  **The value the renderer was actually given**, which is the
                  reason this stays even though the caption below the card now
                  says the same thing in a sentence. The caption reads the
                  media query live; this is read at mount, alongside `mountGalaxy`
                  reading it — so when they disagree, the setting was changed
                  after the scene was built, and that is worth being able to see
                  rather than deduce.
                */
                `reduced motion at mount ${
                  window.matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "on"
                    : "off"
                }`,
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
                  /**
                   * **A finger gets the name too, and used to get nothing.**
                   *
                   * This returned early on a coarse pointer, on the reasoning
                   * that the name would stick — which was the right worry and
                   * the wrong cure: it left tapping a member on a phone doing
                   * visibly less than hovering one on a desktop, on the surface
                   * where a Circle is mostly read. The name is the answer to
                   * the question the picture raises, and a phone raises it too.
                   *
                   * Sticking is handled where it happens instead. On touch the
                   * leave event arrives as the finger lifts, so honouring it
                   * would hide the label in the same breath as showing it; it
                   * is ignored, and the label expires on its own.
                   */
                  const coarse = window.matchMedia("(pointer: coarse)").matches

                  if (!systemId) {
                    if (!coarse) setHover(null)
                    return
                  }

                  const label = snapshot.systems.find(
                    (system) => system.id === systemId,
                  )?.label
                  // A system with no name to show is the same as no system:
                  // leaving the last one up would point it at somebody else.
                  if (!label) {
                    setHover(null)
                    return
                  }

                  if (hoverTimer.current) {
                    window.clearTimeout(hoverTimer.current)
                    hoverTimer.current = null
                  }
                  setHover({ label, x, y })
                  if (coarse) {
                    hoverTimer.current = window.setTimeout(() => {
                      hoverTimer.current = null
                      setHover(null)
                    }, 1800)
                  }
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
            /*
              **The inset is an inline style, and that is the point of it.**

              Expanded, this button is the only way out of a full-screen view,
              and installed to the home screen the Dynamic Island sits exactly
              where `top-2` puts it. Two CSS attempts to give the frame its
              margin back changed nothing on the device — while the probe
              measured the inset at 62px — so the value is applied here, by
              React, where there is no selector to fail to match.

              **Only when expanded.** In the card this button is 8px from a
              256px box in normal flow, and `body` has already paid the inset
              for everything in the page; adding it again would push the
              control off the card.
            */
            style={
              expanded
                ? {
                    top: "calc(env(safe-area-inset-top) + 0.5rem)",
                    right: "calc(env(safe-area-inset-right) + 0.5rem)",
                  }
                : undefined
            }
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
        **Only once the canvas exists.** If the galaxy could not start there is
        nothing on screen to explain, and a note about orbits over an absent
        picture would be answering a question nobody asked.

        Not a `role="alert"`, and not styled as a warning: nothing is wrong.
        The setting is being respected, and the only reason to say so is that
        respecting it looks identical to failing.
      */}
      {state === "ready" && reducedMotion ? (
        <p className="text-xs opacity-60">
          Reduce Motion is on in your device settings, so the planets hold
          still. Everything else here is live.
        </p>
      ) : null}

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
