import type { ColorHex } from "./types";

/**
 * What colour a Circle's galaxy is, from the suns inside it.
 *
 * ## Three blends, on one axis
 *
 * Only three combinations are allowed:
 *
 * - **red → yellow**
 * - **red → blue**, which reads purple where they meet
 * - **blue → purple**
 *
 * and explicitly *not* yellow→blue or yellow→purple.
 *
 * **That constraint is really a line, not a list.** Put the three in order and
 * each shares a colour with its neighbour:
 *
 * ```
 * yellow ── red ── blue ── purple
 *   └ red-yellow ─┘  └ red-blue ─┘  └ blue-purple ─┘
 * ```
 *
 * Yellow sits at one end and blue past the middle, so **they can never land in
 * the same blend** — the forbidden pairs are excluded by the shape of the axis
 * rather than by a rule that has to be remembered and checked. A Circle's suns
 * place it somewhere along that line and the nearest blend wins.
 *
 * ## Weights, not a winner
 *
 * A Circle of six with four warm suns and two cool ones is not "warm"; it is
 * *mostly* warm, and it should sit nearer the red-yellow end without snapping
 * to it. So every member contributes and the axis position is their balance.
 *
 * ## White suns abstain
 *
 * `white-hot` has almost no saturation, so it has no opinion about hue. It
 * counts toward nothing rather than being forced into a family it does not
 * belong to — a Circle of white suns falls to the middle blend by default.
 */

export type GalaxyPaletteId = "red-yellow" | "red-blue" | "blue-purple";

export type GalaxyPalette = {
  id: GalaxyPaletteId;
  /** The hotter, brighter end. Used for the core. */
  inner: ColorHex;
  /** The cooler end. Used for the arms and the outer falloff. */
  outer: ColorHex;
};

/**
 * **Muted on purpose.** These are read through `towardWhite` at the bulge and
 * at very low alpha across the disc, so a fully saturated hue here becomes a
 * hot coloured blob rather than gas — the red-blue pair's first `inner` was a
 * pure pink and it dominated the middle of the frame.
 *
 * Each pair keeps its two ends distinguishable while sitting closer to the
 * dusty end of its hue: this is background, and the systems have to stay
 * readable on top of it.
 */
export const GALAXY_PALETTES: Record<GalaxyPaletteId, GalaxyPalette> = {
  "red-yellow": { id: "red-yellow", inner: 0xffd08a, outer: 0xd9552e },
  "red-blue": { id: "red-blue", inner: 0xe08498, outer: 0x5566cc },
  // The purple end sits at 272°, not 260°. **Muting the first pick pulled it
  // back across the boundary into blue**, so "blue-purple" was a blend of blue
  // and blue — caught by asserting the palette ends through the same
  // classifier the suns go through, rather than by looking at the hex.
  "blue-purple": { id: "blue-purple", inner: 0x8ec6f0, outer: 0x9d63d0 },
};

/** Hue in degrees, and how saturated the colour is at all. */
const hueOf = (color: ColorHex): { hue: number; saturation: number } => {
  const r = ((color >> 16) & 0xff) / 255;
  const g = ((color >> 8) & 0xff) / 255;
  const b = (color & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) {
    return { hue: 0, saturation: 0 };
  }

  let hue: number;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }
  hue *= 60;
  if (hue < 0) {
    hue += 360;
  }
  // Relative to the brightest channel, so a pale colour reads as unsaturated
  // even when it is bright.
  return { hue, saturation: max === 0 ? 0 : delta / max };
};

/**
 * Where one sun sits on the axis: `-1` fully yellow, `0` red, `+1` blue or
 * beyond. `null` for a sun with no opinion.
 */
export const sunAxisPosition = (color: ColorHex): number | null => {
  const { hue, saturation } = hueOf(color);
  if (saturation < 0.18) {
    return null;
  }

  // Yellow and orange: 30° is squarely yellow, 0° is red.
  if (hue >= 20 && hue <= 75) {
    return -Math.min(1, (hue - 20) / 40);
  }
  // Reds and pinks either side of zero.
  if (hue > 330 || hue < 20) {
    return 0;
  }
  // Blues.
  if (hue >= 180 && hue < 265) {
    return 1;
  }
  // Purples run past blue on the axis.
  if (hue >= 265 && hue <= 330) {
    return 1.4;
  }
  // Greens have no place in this palette and are treated as abstaining rather
  // than being forced to one side.
  return null;
};

/**
 * The Circle's position on the yellow→purple axis, as the mean of its suns.
 *
 * A Circle whose suns all abstain — every one white — lands at `0`, the middle,
 * which is the red-blue blend.
 */
export const circleAxisPosition = (colors: readonly ColorHex[]): number => {
  let total = 0;
  let voters = 0;
  for (const color of colors) {
    const position = sunAxisPosition(color);
    if (position === null) {
      continue;
    }
    total += position;
    voters += 1;
  }
  return voters === 0 ? 0 : total / voters;
};

/**
 * The blend for a Circle.
 *
 * The two thresholds sit between the three blends' own centres — yellow at
 * `-1`, red at `0`, blue at `1` — so a Circle has to lean meaningfully before
 * it changes, rather than flickering as one member checks in.
 */
export const galaxyPaletteFor = (
  colors: readonly ColorHex[],
): GalaxyPalette => {
  const axis = circleAxisPosition(colors);
  if (axis <= -0.4) {
    return GALAXY_PALETTES["red-yellow"];
  }
  if (axis >= 0.75) {
    return GALAXY_PALETTES["blue-purple"];
  }
  return GALAXY_PALETTES["red-blue"];
};
