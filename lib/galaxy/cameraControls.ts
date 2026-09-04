import { MAX_TILT, MIN_TILT } from "./constants";
import type { GalaxyHandle } from "./types";

const controlButton = (
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "galaxy-camera-btn";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
};

/**
 * How far one press of an arrow moves the view.
 *
 * ## The arrows were backwards
 *
 * `panBy` moves the **content**: `panBy(0, -18)` slides the galaxy up the
 * screen, which means the viewer is now looking further *down*. So the button
 * labelled `↑` revealed what was below it.
 *
 * The convention every map and every document viewer uses is the other one: an
 * arrow moves **the view** that way, so you see what is above, and the content
 * slides the opposite direction. The signs are inverted here to match.
 *
 * **The drag was always right** and is unchanged — dragging grabs the content
 * and takes it with you, which is a different gesture with a different
 * expectation. The bug was that the buttons had been given the drag's sign.
 */
const PAN_STEP = 18;

/**
 * The tilt stops the view button cycles through.
 *
 * ## Why this replaced "rotate"
 *
 * The rotate button turned `yaw`, and yaw barely changes the picture: the
 * orbits are near-circular, so spinning them about the vertical axis mostly
 * slides planets along paths they were already on. It looked like nothing had
 * happened, which is what "feels useless" was.
 *
 * **Tilt is the control that actually changes what you can see.** It runs from
 * nearly edge-on — where the orbits collapse to lines and the systems overlap
 * — to nearly overhead, where every orbit is a full ellipse and a crowded
 * Circle becomes legible. On a compact host it is the *only* way to reach that,
 * because a drag there pans instead of rotating.
 *
 * Discrete stops rather than a slider: three presses gets you round the whole
 * range and back, and no press ever leaves the view somewhere unreadable.
 */
const TILT_STOPS = [MIN_TILT + 0.12, 0.62, 0.95, MAX_TILT - 0.1] as const;

const nextTilt = (current: number): number => {
  const next = TILT_STOPS.find((stop) => stop > current + 0.04);
  return next ?? TILT_STOPS[0] ?? 0.95;
};

/**
 * Which controls a surface gets, and why it is not one bar everywhere.
 *
 * **`touch` is not "small screen".** It is the input, decided by
 * `(pointer: coarse)` *or* a narrow viewport, whichever is more restrictive —
 * so a phone-sized desktop window keeps its full bar and a large tablet gets
 * the touch set, which is the honest answer in both cases. A device that lies
 * about one of the two gets the more forgiving option rather than the less.
 *
 * On touch the bar drops to **zoom, reset and the four pans**:
 *
 *   * **zoom stays, having once been dropped on the grounds that pinch is
 *     better at it.** Pinch is better at it, and in an embedded card there is
 *     no pinch to be better: `touch-action: pan-y` hands the gesture to the
 *     browser so the page scroll survives, and iOS then spends two fingers on
 *     a page zoom rather than passing them to the canvas. Dropping the buttons
 *     left a phone with no way to zoom at all, which read as the galaxy being
 *     broken. Full screen the canvas does take the gesture and pinch works;
 *     the buttons cost a few pixels there and are the reason it works in the
 *     other state
 *   * the viewing angle goes, and it is the real casualty — a drag cannot
 *     reach it on a compact host, so on touch it becomes unreachable. Named
 *     rather than quietly dropped
 *   * **pan stays**, which looks redundant next to a pannable canvas and is
 *     not: a one-finger vertical drag belongs to the page, so without these
 *     buttons there is no way to move the view up or down at all
 *   * reset stays because it is the undo for every other gesture
 */
export type CameraControlsOptions = {
  touch?: boolean;
};

export const attachCameraControls = (
  host: HTMLElement,
  api: Pick<
    GalaxyHandle,
    "zoomBy" | "resetCamera" | "panBy" | "setView" | "getView"
  >,
  opts: CameraControlsOptions = {},
): (() => void) => {
  /**
   * **One bar per host, whatever happened before.**
   *
   * `mountGalaxy` appends this and `destroy` removes it, which is correct and
   * is not the same as being safe: React's development double-invoke, a
   * cancelled mount whose promise resolves after its cleanup, and a hot reload
   * all end with a second `attachCameraControls` against a host that still
   * carries the first bar. The symptom is two sets of arrows, one of them
   * attached to nothing, sitting wherever the old host left it.
   *
   * Clearing first makes the function idempotent, so the invariant is "this
   * host has exactly one bar" rather than "every mount is perfectly paired
   * with its unmount".
   */
  for (const existing of host.querySelectorAll(":scope > .galaxy-camera-controls")) {
    existing.remove();
  }

  const bar = document.createElement("div");
  bar.className = "galaxy-camera-controls";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Galaxy camera");

  if (opts.touch) {
    bar.classList.add("galaxy-camera-controls--touch");
  }

  /**
   * **Zoom, then reset, then zoom** — and the middle position is the point.
   *
   * `− + ◎` put the two halves of one continuous control either side of a
   * jump-to-nowhere, so a thumb reaching for "less" and "more" crosses a third
   * button between them. `− ◎ +` reads as a scale with its origin marked.
   */
  const primary = opts.touch
    ? [
        controlButton("−", "Zoom out", () => {
          api.zoomBy(0.86);
        }),
        controlButton("◎", "Reset view", () => {
          api.resetCamera();
        }),
        controlButton("+", "Zoom in", () => {
          api.zoomBy(1.16);
        }),
      ]
    : [
        controlButton("−", "Zoom out", () => {
          api.zoomBy(0.86);
        }),
        controlButton("◎", "Reset view", () => {
          api.resetCamera();
        }),
        controlButton("+", "Zoom in", () => {
          api.zoomBy(1.16);
        }),
        controlButton("⌖", "Change viewing angle", () => {
          api.setView({ tilt: nextTilt(api.getView().tilt) });
        }),
      ];

  /**
   * **Reading order, not the order they were written in.**
   *
   * These were `↑ ↓ ← →` — grouped by axis, which is how someone *writing*
   * four handlers thinks and not how anyone *looking* at four arrows does. On
   * one row it produced two vertical arrows next to two horizontal ones, which
   * has no shape to recognise. `← ↑ ↓ →` is the row every media transport and
   * every d-pad flattened into a line already uses.
   *
   * The first one carries the class that starts a row, because the touch bar
   * has three buttons above these and four columns to fill: without it the `←`
   * rides up beside the zoom controls and the rest wrap into a third row, which
   * is exactly the jumble that was reported. Named rather than `:nth-child(4)`,
   * so adding a button to `primary` cannot silently break the layout.
   *
   * Each arrow moves the *view* in its own direction, so the content slides the
   * other way. See `PAN_STEP`.
   */
  const arrows = [
    controlButton("←", "Look further left", () => {
      api.panBy(PAN_STEP, 0);
    }),
    controlButton("↑", "Look further up", () => {
      api.panBy(0, PAN_STEP);
    }),
    controlButton("↓", "Look further down", () => {
      api.panBy(0, -PAN_STEP);
    }),
    controlButton("→", "Look further right", () => {
      api.panBy(-PAN_STEP, 0);
    }),
  ];
  arrows[0]?.classList.add("galaxy-camera-btn--row-start");

  bar.append(...primary, ...arrows);

  host.appendChild(bar);
  return () => {
    bar.remove();
  };
};
