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
    const detach = attachCameraControls(host, api());
    expect(names(host)).toEqual([
      "Zoom out",
      "Zoom in",
      "Reset view",
      "Change viewing angle",
      "Look further up",
      "Look further down",
      "Look further left",
      "Look further right",
    ]);
    detach();
  });

  it("gives a finger reset and the four pans, and nothing else", () => {
    /**
     * **Pan looks redundant next to a pannable canvas and is not.** A
     * one-finger vertical drag belongs to the page, so these buttons are the
     * only way to move the view up or down at all.
     *
     * Zoom goes because pinch is better at it. **The viewing angle goes and is
     * the real casualty** — a drag cannot reach tilt on a compact host, so on
     * touch it becomes unreachable. Asserted so that is a decision somebody
     * revisits rather than a gap somebody finds.
     */
    const detach = attachCameraControls(host, api(), { touch: true });
    expect(names(host)).toEqual([
      "Reset view",
      "Look further up",
      "Look further down",
      "Look further left",
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
