import { describe, expect, it } from "vitest";
import { orbitRadiiForCount } from "./orbitLayout";

describe("orbitRadiiForCount", () => {
  it("spaces orbits evenly from inner to outer", () => {
    expect(orbitRadiiForCount(4)).toEqual([95, 183, 272, 360]);
  });

  it("returns a single inner radius for one goal", () => {
    expect(orbitRadiiForCount(1)).toEqual([95]);
  });
});
