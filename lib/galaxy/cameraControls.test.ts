// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachCameraControls } from "./cameraControls";
import { MAX_TILT, MIN_TILT } from "./constants";

/**
 * The camera bar is DOM, so it is the one part of this module a jsdom test can
 * see completely — and the part most likely to be changed by somebody adjusting
 * a layout without knowing which buttons are load-bearing on which surface.
 */
const api = () => {
  const view = { yaw: 0, tilt: 0.95, roll: 0 };
  return {
    zoomBy: vi.fn(),
    resetCamera: vi.fn(),
    panBy: vi.fn(),
    getView: vi.fn(() => ({ ...view })),
    setView: vi.fn((next: { tilt?: number }) => {
      if (next.tilt !== undefined) {
        view.tilt = next.tilt;
      }
    }),
  };
};

const names = (host: HTMLElement): string[] =>
  [...host.querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? "",
  );

describe("the camera bar", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("gives a mouse everything", () => {
    /**
     * **The order is the assertion, not just the membership.** `− ◎ +` puts the
     * two halves of one continuous control either side of the origin they share
     * rather than either side of a jump-to-nowhere, and the arrows read
     * `← ↑ ↓ →` because that is a shape, where the axis-grouped `↑ ↓ ← →` they
     * were written in is only a list. Both are layout decided by DOM order, so
     * a test that sorted or ignored order would not see them change.
     */
    const detach = attachCameraControls(host, api());
    expect(names(host)).toEqual([
      "Zoom out",
      "Reset view",
      "Zoom in",
      "Change viewing angle",
      "Look further left",
      "Look further up",
      "Look further down",
      "Look further right",
    ]);
    detach();
  });

  it("starts the arrows on a new row, whatever precedes them", () => {
    /**
     * **The bug this replaces referred to a position rather than to a button.**
     * `--touch > :first-child { grid-column: 4 }` was written when the touch set
     * was five buttons with reset at the front; restoring zoom made it wrong
     * silently, and the bar wrapped into three ragged rows on a phone.
     *
     * Asserted on both bars, because the rule is deliberately not a `--touch`
     * special case: "controls, then a row of arrows" is the layout in both, and
     * on the mouse bar it happens to be a no-op.
     */
    for (const touch of [true, false]) {
      const detach = attachCameraControls(host, api(), { touch });
      const first = host.querySelector(".galaxy-camera-btn--row-start");
      expect(
        first?.getAttribute("aria-label"),
        "the row-start class is not on the first arrow",
      ).toBe("Look further left");
      expect(
        host.querySelectorAll(".galaxy-camera-btn--row-start"),
        "more than one button claims to start a row",
      ).toHaveLength(1);
      detach();
    }
  });

  it("gives a finger zoom, reset and the four pans, and nothing else", () => {
    /**
     * **Pan looks redundant next to a pannable canvas and is not.** A
     * one-finger vertical drag belongs to the page, so these buttons are the
     * only way to move the view up or down at all.
     *
     * **Zoom was dropped once on the grounds that pinch is better at it, and
     * that shipped a phone with no way to zoom at all.** In an embedded card
     * `touch-action: pan-y` hands the gesture to the browser to keep the page
     * scrollable, and iOS then spends two fingers on a page zoom rather than
     * passing them to the canvas — so there was no pinch for a button to be
     * worse than. Asserted here because the argument for removing them is
     * persuasive and wrong.
     *
     * **The viewing angle goes and is the real casualty** — a drag cannot
     * reach tilt on a compact host, so on touch it becomes unreachable.
     * Asserted so that is a decision somebody revisits rather than a gap
     * somebody finds.
     */
    const detach = attachCameraControls(host, api(), { touch: true });
    expect(names(host)).toEqual([
      "Zoom out",
      "Reset view",
      "Zoom in",
      "Look further left",
      "Look further up",
      "Look further down",
      "Look further right",
    ]);
    detach();
  });

  it("moves the view the way the arrow points", () => {
    // `panBy` moves the *content*, so the signs are inverted against the
    // labels. The buttons were backwards once and read as broken.
    const controls = api();
    const detach = attachCameraControls(host, controls, { touch: true });

    const press = (label: string) => {
      const button = [...host.querySelectorAll("button")].find(
        (candidate) => candidate.getAttribute("aria-label") === label,
      );
      button?.click();
    };

    press("Look further up");
    expect(controls.panBy).toHaveBeenLastCalledWith(0, 18);
    press("Look further left");
    expect(controls.panBy).toHaveBeenLastCalledWith(18, 0);
    detach();
  });

  it("cycles the viewing angle through every stop and back", () => {
    // Three presses used to leave the view somewhere unreadable, because the
    // stops were open-ended. `nextTilt` wraps.
    const controls = api();
    const detach = attachCameraControls(host, controls);
    const angle = [...host.querySelectorAll("button")].find(
      (button) => button.getAttribute("aria-label") === "Change viewing angle",
    );

    const seen: number[] = [];
    for (let press = 0; press < 6; press++) {
      angle?.click();
      seen.push(controls.getView().tilt);
    }

    expect(new Set(seen).size, "the angle button settled on one value").toBeGreaterThan(1);
    for (const tilt of seen) {
      expect(tilt).toBeGreaterThanOrEqual(MIN_TILT);
      expect(tilt).toBeLessThanOrEqual(MAX_TILT);
    }
    detach();
  });

  it("takes its bar away again", () => {
    // A host that mounts twice must not end up with two bars, and the module
    // owns the element it added.
    const detach = attachCameraControls(host, api());
    expect(host.querySelectorAll("button").length).toBeGreaterThan(0);
    detach();
    expect(host.querySelectorAll("button")).toHaveLength(0);
  });
});
