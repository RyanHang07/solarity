import { NEBULA_MIN_CATEGORIES, NEBULA_STAMP_COUNT } from "../constants";
import { mixColor, towardWhite } from "../color";
import { mulberry32 } from "../rng";
import type { ColorHex, NebulaConfig, PlanetConfig, StarConfig } from "../types";

const ACCENTS: ColorHex[] = [0xff4f8b, 0x4ee4ff, 0xb57bff];

export type NebulaColorEntry = {
  color: ColorHex;
  weight: number;
};

const channel = (color: ColorHex, shift: number): number =>
  (color >> shift) & 0xff;

export const nebulaEntriesFromColors = (
  colors: readonly ColorHex[],
): NebulaColorEntry[] => {
  const counts = new Map<ColorHex, number>();
  for (const color of colors) {
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([color, weight]) => ({ color, weight }))
    .sort((a, b) => b.weight - a.weight || a.color - b.color);
};

export const nebulaConfigFromEntries = (
  entries: readonly NebulaColorEntry[],
  alpha = 0.2,
): { colors: ColorHex[]; weights: number[]; alpha: number } => ({
  colors: entries.map((entry) => entry.color),
  weights: entries.map((entry) => entry.weight),
  alpha,
});

export const normalizeNebulaWeights = (
  colors: readonly ColorHex[],
  weights?: readonly number[],
): number[] => {
  if (weights && weights.length === colors.length) {
    return weights.map((weight) => Math.max(0, weight));
  }
  return colors.map(() => 1);
};

export const weightedAverageColor = (
  colors: readonly ColorHex[],
  weights: readonly number[],
): ColorHex => {
  let r = 0;
  let g = 0;
  let b = 0;
  let total = 0;
  for (let i = 0; i < colors.length; i += 1) {
    const weight = weights[i] ?? 1;
    if (weight <= 0) {
      continue;
    }
    total += weight;
    r += channel(colors[i] ?? 0, 16) * weight;
    g += channel(colors[i] ?? 0, 8) * weight;
    b += channel(colors[i] ?? 0, 0) * weight;
  }
  if (total <= 0) {
    return colors[0] ?? ACCENTS[0];
  }
  return (
    ((Math.round(r / total) << 16) |
      (Math.round(g / total) << 8) |
      Math.round(b / total)) >>>
    0
  );
};

export const pickWeightedColor = (
  colors: readonly ColorHex[],
  weights: readonly number[],
  random: () => number,
): ColorHex => {
  let total = 0;
  for (const weight of weights) {
    total += Math.max(0, weight);
  }
  if (total <= 0 || colors.length === 0) {
    return colors[0] ?? ACCENTS[0];
  }
  let pick = random() * total;
  for (let i = 0; i < colors.length; i += 1) {
    pick -= Math.max(0, weights[i] ?? 1);
    if (pick <= 0) {
      return colors[i] ?? colors[0] ?? ACCENTS[0];
    }
  }
  return colors[colors.length - 1] ?? ACCENTS[0];
};

export const nebulaSourceWeights = (
  stars: StarConfig[],
  nebula?: NebulaConfig,
): number[] => {
  const colors = nebulaSourceColors(stars, nebula);
  if (nebula?.weights && nebula.weights.length === colors.length) {
    return normalizeNebulaWeights(colors, nebula.weights);
  }
  if (nebula?.weights && nebula.weights.length > 0) {
    return normalizeNebulaWeights(colors, nebula.weights);
  }
  return colors.map(() => 1);
};

export type NebulaStamp = {
  x: number;
  y: number;
  spread: number;
  tint: ColorHex;
  scale: number;
  rotation: number;
  phase: number;
  spin: number;
  drift: number;
};

/** @deprecated Lobe layout replaced by blended stamps; kept for tests. */
export type NebulaLobe = {
  x: number;
  y: number;
  spread: number;
  colors: [ColorHex, ColorHex, ColorHex];
};

export const quantizeColor = (color: ColorHex): ColorHex => {
  const q = (shift: number): number => ((color >> shift) & 0xff) & 0xe0;
  return (q(16) << 16) | (q(8) << 8) | q(0);
};

export const uniqueColorFamilies = (stars: StarConfig[]): ColorHex[] => [
  ...new Set(stars.map((star) => quantizeColor(star.color))),
];

export const nebulaSourceColors = (
  stars: StarConfig[],
  nebula?: NebulaConfig,
): ColorHex[] => {
  if (nebula?.colors && nebula.colors.length > 0) {
    return [...nebula.colors];
  }
  return uniqueColorFamilies(stars);
};

export const nebulaUnlocked = (
  stars: StarConfig[],
  preview: boolean,
  nebula?: NebulaConfig,
): boolean =>
  preview || nebulaSourceColors(stars, nebula).length >= NEBULA_MIN_CATEGORIES;

export const nebulaReach = (
  planets: Pick<PlanetConfig, "orbitRadius">[],
): number => {
  const outer = planets.reduce(
    (max, planet) => Math.max(max, planet.orbitRadius),
    160,
  );
  return outer * 1.12;
};

/** Blend achievement hues — weighted by goals achieved per color family. */
export const nebulaPalette = (
  source: ColorHex[],
  weights?: readonly number[],
): ColorHex[] => {
  if (source.length === 0) {
    return ACCENTS;
  }
  const normalized = normalizeNebulaWeights(source, weights);
  const blend = weightedAverageColor(source, normalized);
  const soft = mixColor(blend, towardWhite(blend, 0.35), 0.28);
  const deep = mixColor(blend, 0x1a1424, 0.22);
  const ranked = source
    .map((color, index) => ({
      color,
      weight: normalized[index] ?? 1,
    }))
    .sort((a, b) => b.weight - a.weight || a.color - b.color)
    .slice(0, 4)
    .map(({ color }) => mixColor(color, blend, 0.55));
  return [soft, blend, deep, ...ranked].slice(0, 5);
};

export const placeNebulaStamps = (
  source: ColorHex[],
  layoutSeed: number,
  count = NEBULA_STAMP_COUNT,
  weights?: readonly number[],
): NebulaStamp[] => {
  const normalized = normalizeNebulaWeights(source, weights);
  const palette = nebulaPalette(source, normalized);
  const maxWeight = Math.max(1, ...normalized);
  const random = mulberry32(layoutSeed);
  const stamps: NebulaStamp[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const dist = 0.18 + random() * 0.72;
    const tint =
      random() < 0.22
        ? palette[Math.floor(random() * palette.length)] ??
          pickWeightedColor(source, normalized, random)
        : pickWeightedColor(source, normalized, random);
    const tintIndex = source.indexOf(tint);
    const weight = tintIndex >= 0 ? (normalized[tintIndex] ?? 1) : 1;
    const weightScale = 0.88 + 0.28 * (weight / maxWeight);
    stamps.push({
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist * 0.68,
      spread: (0.34 + random() * 0.28) * weightScale,
      tint,
      scale: (0.85 + random() * 0.55) * weightScale,
      rotation: random() * Math.PI * 2,
      phase: random() * Math.PI * 2,
      spin: (random() > 0.5 ? 1 : -1) * (0.015 + random() * 0.028),
      drift: 4 + random() * 10,
    });
  }
  return stamps;
};

/** @deprecated Use placeNebulaStamps. */
export const placeNebulaLobes = (
  stars: StarConfig[],
  extraColors: ColorHex[] = [],
): NebulaLobe[] => {
  const families =
    extraColors.length > 0 ? extraColors : uniqueColorFamilies(stars);
  const palette = nebulaPalette(families);
  const count = Math.max(3, Math.min(6, palette.length));
  const lobes: NebulaLobe[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const primary = palette[index % palette.length] ?? ACCENTS[0];
    const neighbor =
      palette[(index + 1) % palette.length] ?? ACCENTS[1];
    const accent = ACCENTS[index % ACCENTS.length] ?? 0xff4f8b;
    lobes.push({
      x: Math.cos(angle) * (0.86 + (index % 3) * 0.08),
      y: Math.sin(angle) * 0.68,
      spread: 0.42 + (index % 2) * 0.1,
      colors: [primary, mixColor(primary, neighbor, 0.55), accent],
    });
  }
  return lobes;
};

export const nebulaSignature = (opts: {
  stars: StarConfig[];
  preview: boolean;
  reach: number;
  nebula?: NebulaConfig;
  milestoneTier?: number;
}): string => {
  if (!nebulaUnlocked(opts.stars, opts.preview, opts.nebula)) {
    return `off:${opts.reach}:${opts.milestoneTier ?? 0}`;
  }
  const families = nebulaSourceColors(opts.stars, opts.nebula)
    .slice()
    .sort((a, b) => a - b)
    .join(".");
  const weights = nebulaSourceWeights(opts.stars, opts.nebula).join(",");
  const alpha = opts.nebula?.alpha ?? "";
  return `${opts.preview ? 1 : 0}:${opts.reach}:${opts.milestoneTier ?? 0}:${families}:${weights}:${alpha}`;
};
