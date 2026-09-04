import { describe, expect, it } from "vitest";
import {
  GALAXY_PALETTES,
  circleAxisPosition,
  galaxyPaletteFor,
  sunAxisPosition,
} from "./galaxyPalette";
import { SUN_COLOR_PRESETS } from "./palettes";

const preset = (id: string): number => {
  const found = SUN_COLOR_PRESETS.find((p) => p.id === id);
  if (!found) {
    throw new Error(`no preset ${id}`);
  }
  return found.color;
};

const GOLD = preset("gold");
const AMBER = preset("amber");
const EMBER = preset("ember");
const ROSE = preset("rose");
const AZURE = preset("azure");
const WHITE = preset("white-hot");

describe("where each sun sits on the axis", () => {
  it("puts gold and amber on the yellow side", () => {
    expect(sunAxisPosition(GOLD)).toBeLessThan(0);
    expect(sunAxisPosition(AMBER)).toBeLessThan(0);
  });

  it("puts ember and rose at red", () => {
    expect(sunAxisPosition(EMBER)).toBe(0);
    expect(sunAxisPosition(ROSE)).toBe(0);
  });

  it("puts azure on the blue side", () => {
    expect(sunAxisPosition(AZURE)).toBeGreaterThan(0);
  });

  /**
   * **A white sun has no opinion about hue**, so it counts toward nothing
   * rather than being forced into a family it does not belong to.
   */
  it("lets a white sun abstain", () => {
    expect(sunAxisPosition(WHITE)).toBeNull();
  });

  it("lets a colour off the axis abstain rather than guessing", () => {
    expect(sunAxisPosition(0x33cc55)).toBeNull();
  });
});

describe("the palettes themselves", () => {
  /**
   * **The hexes were muted after the first look**, because a fully saturated
   * `inner` became a hot coloured blob in the middle of the frame rather than
   * gas. Muting them is easy to overshoot: a "red-yellow" whose ends are both
   * orange is no longer a blend of anything.
   *
   * `sunAxisPosition` is the same classifier the Circle's suns go through, so
   * asserting the palette ends through it means the names stay true to the
   * colours whatever anybody tunes.
   */
  it("keeps each blend's two ends in the families it is named for", () => {
    const warm = GALAXY_PALETTES["red-yellow"];
    expect(sunAxisPosition(warm.inner), "the yellow end is not yellow")
      .toBeLessThan(0);
    expect(sunAxisPosition(warm.outer), "the red end is not red").toBe(0);

    const mixed = GALAXY_PALETTES["red-blue"];
    expect(sunAxisPosition(mixed.inner), "the red end is not red").toBe(0);
    expect(sunAxisPosition(mixed.outer), "the blue end is not blue")
      .toBeGreaterThan(0);

    const cool = GALAXY_PALETTES["blue-purple"];
    expect(sunAxisPosition(cool.inner), "the blue end is not blue").toBe(1);
    expect(sunAxisPosition(cool.outer), "the purple end is not purple")
      .toBeGreaterThan(1);
  });

  it("has two visibly different ends in every blend", () => {
    // A blend whose ends have collapsed together is a tint, not a blend.
    for (const palette of Object.values(GALAXY_PALETTES)) {
      expect(palette.inner).not.toBe(palette.outer);
      const inner = sunAxisPosition(palette.inner) ?? 0;
      const outer = sunAxisPosition(palette.outer) ?? 0;
      expect(Math.abs(inner - outer)).toBeGreaterThan(0.3);
    }
  });
});

describe("the Circle's blend", () => {
  it("goes red-yellow when the suns are warm", () => {
    expect(galaxyPaletteFor([GOLD, GOLD, AMBER]).id).toBe("red-yellow");
  });

  it("goes blue-purple when the suns are cool", () => {
    expect(galaxyPaletteFor([AZURE, AZURE, AZURE]).id).toBe("blue-purple");
  });

  it("goes red-blue when warm and cool are mixed", () => {
    expect(galaxyPaletteFor([GOLD, AZURE]).id).toBe("red-blue");
    expect(galaxyPaletteFor([EMBER, AZURE]).id).toBe("red-blue");
  });

  it("goes red-blue for an all-red Circle", () => {
    expect(galaxyPaletteFor([EMBER, ROSE]).id).toBe("red-blue");
  });

  /**
   * **The constraint the whole design exists to satisfy.**
   *
   * Yellow and blue must never appear in the same blend, and nor may yellow and
   * purple. Putting the three blends on one axis makes that structural — yellow
   * sits at one end and blue past the middle, so no blend can reach both — but
   * it is worth asserting over every combination rather than trusting the
   * geometry.
   */
  it("never produces a forbidden pairing, whatever the Circle", () => {
    const suns = [GOLD, AMBER, EMBER, ROSE, AZURE, WHITE];
    const allowed = new Set(Object.keys(GALAXY_PALETTES));

    // Every Circle of up to four, drawn from every preset.
    const walk = (circle: number[]): void => {
      if (circle.length > 0) {
        expect(allowed.has(galaxyPaletteFor(circle).id)).toBe(true);
      }
      if (circle.length === 4) {
        return;
      }
      for (const sun of suns) {
        walk([...circle, sun]);
      }
    };
    walk([]);
  });

  it("weighs every member rather than picking a winner", () => {
    // Four warm to two cool should lean warm without snapping all the way, and
    // must not read the same as an all-warm Circle.
    const mostlyWarm = circleAxisPosition([
      GOLD,
      GOLD,
      GOLD,
      GOLD,
      AZURE,
      AZURE,
    ]);
    const allWarm = circleAxisPosition([GOLD, GOLD, GOLD, GOLD]);
    expect(mostlyWarm).toBeGreaterThan(allWarm);
    expect(mostlyWarm).toBeLessThan(0);
  });

  it("falls to the middle blend for a Circle with no opinion", () => {
    expect(galaxyPaletteFor([WHITE, WHITE]).id).toBe("red-blue");
    expect(galaxyPaletteFor([]).id).toBe("red-blue");
  });

  it("does not flip on a single member joining", () => {
    // The thresholds sit between the blends' centres so a Circle has to lean
    // meaningfully before it changes, rather than flickering as people arrive.
    const warm = [GOLD, GOLD, GOLD, GOLD];
    expect(galaxyPaletteFor(warm).id).toBe("red-yellow");
    expect(galaxyPaletteFor([...warm, EMBER]).id).toBe("red-yellow");
  });
});
