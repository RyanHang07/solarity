import { describe, expect, it } from "vitest";
import {
  COMPACT_MAX_HEIGHT,
  COMPACT_MAX_WIDTH,
  DEFAULT_COMPACT_TILT,
  DEFAULT_TILT,
  isCompactLayout,
} from "./constants";
import { flattenFromTilt } from "./systems/OrbitSystem";

describe("isCompactLayout", () => {
  it("treats phone-sized hosts as compact", () => {
    expect(isCompactLayout(296, 243)).toBe(true);
    expect(isCompactLayout(COMPACT_MAX_WIDTH, 500)).toBe(true);
    expect(isCompactLayout(500, COMPACT_MAX_HEIGHT)).toBe(true);
  });

  it("keeps desktop panes on the default view", () => {
    expect(isCompactLayout(626, 500)).toBe(false);
  });
});

describe("compact tilt", () => {
  it("flattens orbits more than the desktop default", () => {
    expect(flattenFromTilt(DEFAULT_COMPACT_TILT)).toBeLessThan(
      flattenFromTilt(DEFAULT_TILT),
    );
  });
});
