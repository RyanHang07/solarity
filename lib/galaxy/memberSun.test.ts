import { describe, expect, it } from "vitest";
import { sunColorForMember, sunPresetIdForMember } from "./memberSun";
import { SUN_COLOR_PRESETS } from "./palettes";

const uuid = (n: number): string =>
  `3f2a${n.toString(16).padStart(4, "0")}-9c1d-4e7b-b8a2-${n
    .toString(16)
    .padStart(12, "0")}`;

describe("sunColorForMember", () => {
  it("gives the same member the same colour every time", () => {
    // Everyone must see the same person as the same colour, on every device.
    // A locally random pick would not give this.
    const id = uuid(1);
    expect(sunColorForMember(id)).toBe(sunColorForMember(id));
    expect(sunPresetIdForMember(id)).toBe(sunPresetIdForMember(id));
  });

  it("only ever returns a real preset", () => {
    for (let i = 0; i < 200; i += 1) {
      const color = sunColorForMember(uuid(i));
      expect(SUN_COLOR_PRESETS.some((preset) => preset.color === color)).toBe(
        true,
      );
    }
  });

  /**
   * **The gap this closes.** Without it every sun resolves to
   * `DEFAULT_SUN_COLOR`, so a Circle of ten is ten identical amber suns — in a
   * picture whose whole subject is who is doing what.
   *
   * Six presets and ten members means collisions are certain; what matters is
   * that a Circle-sized group is *mostly* distinguishable rather than mostly
   * identical. Asserted on uuids, because that is what Solarity ids are and
   * their leading characters are hex and badly distributed.
   */
  it("spreads a Circle-sized group across most of the palette", () => {
    const colors = new Set(
      Array.from({ length: 10 }, (_, i) => sunColorForMember(uuid(i))),
    );
    expect(colors.size).toBeGreaterThanOrEqual(4);
  });

  it("uses the whole palette across many members", () => {
    const colors = new Set(
      Array.from({ length: 400 }, (_, i) => sunColorForMember(uuid(i))),
    );
    expect(colors.size).toBe(SUN_COLOR_PRESETS.length);
  });

  it("does not throw on an empty id", () => {
    expect(() => sunColorForMember("")).not.toThrow();
  });
});
