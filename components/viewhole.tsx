"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { flushSync } from "react-dom"

/**
 * A hole in the page that opens to fill the screen, and closes back.
 *
 * ## The idea it is built on
 *
 * **The frame is a mask, not a box that grows.** What the person sees is a
 * window onto something that was already there — so opening widens the window
 * in all four directions at once, and closing narrows it. Nothing inside is
 * scaled, moved or re-created; only how much of it you can see changes.
 *
 * ## Why the View Transitions API rather than measuring rectangles
 *
 * The browser snapshots the page before the state change and after it, and
 * animates between the two. Give this frame a `view-transition-name` and the
 * morph from a card-sized rect to a full-screen one is the browser's job — no
 * FLIP maths, no measuring, and no per-frame layout.
 *
 * **The part that matters for keeping this modular**: the page around it is one
 * named group, not a list of components this file knows about. Rearranging
 * Overview later changes nothing here, because nothing here names anything on
 * Overview. See `--viewhole` in `globals.css` for the whole contract.
 *
 * `document.startViewTransition` is absent in some browsers and the fallback is
 * the state change happening immediately, which is what this did before any of
 * this existed.
 *
 * ## Why the contents must not resize per frame
 *
 * The galaxy's canvas reallocates renderer buffers on resize, so a frame whose
 * *layout* size animated would do that sixty times a second. A view transition
 * animates a **snapshot** — the real element jumps to its final size once, and
 * the picture you watch is a compositor-level image of the before and after. So
 * the canvas resizes exactly twice per open-and-close, which is the whole
 * reason this approach was chosen over animating width and height.
 */
export type ViewholeProps = {
  /** The frame's classes when closed. Open is always the full viewport. */
  closedClassName?: string
  children: ReactNode
}

/**
 * Skip the animation when the person has asked for less motion.
 *
 * Not a nicety: a full-screen wipe is exactly the class of motion that
 * `prefers-reduced-motion` exists for, and the galaxy module already honours it
 * in thirteen places inside the scene. The state change still happens; only the
 * transition is dropped.
 */
const wantsMotion = (): boolean =>
  typeof window !== "undefined" &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Run a state change inside a view transition when the browser has one.
 *
 * **`flushSync` is load-bearing.** `startViewTransition` snapshots the DOM,
 * calls the callback, and snapshots again — synchronously. React batches state
 * updates by default, so without this the callback would return before the DOM
 * changed and the browser would animate a page against itself.
 */
export const transition = (
  change: () => void,
  /**
   * Run **after** the DOM has changed and **before** the browser takes its
   * "after" snapshot, in the same synchronous block.
   *
   * This is the hook the first version was missing, and its absence is what
   * made closing leave a strip of the old canvas showing. The frame's classes
   * changed, React flushed, the browser photographed the result — and the
   * WebGL canvas inside it was still the size it had been a moment ago,
   * because the `ResizeObserver` that would have corrected it fires on the
   * *next* frame. The transition then animated toward a picture that was
   * already wrong.
   *
   * Anything whose size is not decided by CSS belongs here: a canvas, a chart,
   * a map. Anything laid out by the browser needs nothing, which is why this
   * is optional.
   */
  commit?: () => void,
): void => {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> }
  }

  if (!doc.startViewTransition || !wantsMotion()) {
    change()
    commit?.()
    return
  }

  doc.startViewTransition(() => {
    flushSync(change)
    commit?.()
  })
}

/**
 * Who is open, shared by the frame and by everything that has to get out of its
 * way.
 *
 * **A context rather than props threaded through the page**, because the page is
 * a server component and the two ends of this are far apart in the tree. It also
 * means the surroundings never learn *what* opened — only that something did,
 * which is the property that keeps a rearrangement from reaching this file.
 */
type ViewholeState = {
  open: boolean
  setOpen: (open: boolean) => void
  /**
   * Register work that must happen inside the transition, once the DOM has
   * changed and before the browser photographs it. Returns an unregister.
   *
   * **A list rather than a single callback**, because a page may hold more than
   * one thing whose size CSS does not decide, and the frame has no way to know
   * which of them are on it.
   */
  onCommit: (fn: () => void) => () => void
}

const ViewholeContext = createContext<ViewholeState | null>(null)

export function ViewholeProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(false)
  const commits = useRef(new Set<() => void>())

  const onCommit = useCallback((fn: () => void) => {
    commits.current.add(fn)
    return () => {
      commits.current.delete(fn)
    }
  }, [])

  const value = useMemo(
    () => ({
      open,
      onCommit,
      // Every route into the state goes through the transition, so the button,
      // Escape and anything added later cannot look like different features.
      setOpen: (next: boolean) =>
        transition(
          () => setOpenState(next),
          () => {
            for (const fn of commits.current) fn()
          },
        ),
    }),
    [open, onCommit],
  )
  return (
    <ViewholeContext.Provider value={value}>{children}</ViewholeContext.Provider>
  )
}

/**
 * Outside a provider this is a closed viewhole that cannot open, which is the
 * right answer for a page that has no frame on it: the callers render normally
 * and nothing throws.
 *
 * **Frozen at module scope, not built per call.** An object literal in the
 * `??` branch is a new identity on every render, and `onCommit` a new function
 * with it — so every effect keyed on them would tear down and re-register on
 * every render, forever, on any page that used a card without a provider. One
 * constant means the no-provider case is as stable as the real one.
 */
const CLOSED: ViewholeState = Object.freeze({
  open: false,
  setOpen: () => {},
  onCommit: () => () => {},
})

export function useViewhole(): ViewholeState {
  return useContext(ViewholeContext) ?? CLOSED
}

/**
 * Everything on the page that is **not** the frame.
 *
 * It takes children and knows nothing else about them. When the frame opens
 * this is removed from the document — which is what lets the browser animate
 * the old snapshot away, and is also what stops the page scrolling behind an
 * overlay that only covers the viewport.
 *
 * **One region, and it briefly was two.** A `where="before"` variant existed
 * for the day the Circle's sky sat between the tabs and the roster, because a
 * wrapper cannot be discontiguous and a `view-transition-name` must be unique.
 * Moving the sky to the top of that page made everything else contiguous again
 * and left the option with no caller, so it is gone: an unused branch is a
 * second behaviour nobody is testing.
 */
export function PageBlocks({
  className = "flex flex-col gap-8",
  children,
}: {
  className?: string
  children: ReactNode
}) {
  const { open } = useViewhole()
  if (open) return null
  return (
    <div data-page-blocks="" className={className}>
      {children}
    </div>
  )
}

export function Viewhole({ closedClassName = "", children }: ViewholeProps) {
  const { open, setOpen } = useViewhole()

  /**
   * Escape closes it, through the same transition as the button — otherwise the
   * two ways out of a full-screen state would look like different features.
   */
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, setOpen])

  return (
    <div
      data-viewhole=""
      data-open={open ? "" : undefined}
      className={
        open
          ? "fixed inset-0 z-50 overflow-hidden bg-[var(--galaxy-sky)]"
          : `relative overflow-hidden ${closedClassName}`
      }
    >
      {children}
    </div>
  )
}
