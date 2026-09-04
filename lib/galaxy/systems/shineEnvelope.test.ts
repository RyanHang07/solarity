import { describe, expect, it } from "vitest";
import { shineLight, dimLight } from "./shineEnvelope";

describe("shineLight", () => {
  it("starts dark, peaks above rest, then settles to rest", () => {
    expect(shineLight(0)).toBe(0);
    expect(shineLight(0.2)).toBeGreaterThan(0);
    expect(shineLight(0.2)).toBeLessThan(shineLight(0.4));
    expect(shineLight(0.44)).toBeGreaterThan(1.5);
    expect(shineLight(1)).toBe(1);
    expect(shineLight(0.44)).toBeGreaterThan(shineLight(1));
  });

  it("dims from rest through a bloom then to dark", () => {
    expect(dimLight(0)).toBe(shineLight(1));
    expect(dimLight(0.55)).toBeGreaterThan(1.5);
    expect(dimLight(1)).toBe(0);
    expect(dimLight(0.85)).toBeGreaterThan(0);
    expect(dimLight(0.85)).toBeLessThan(dimLight(0.55));
  });
});
