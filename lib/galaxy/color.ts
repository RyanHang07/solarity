import type { ColorHex } from "./types";

const channel = (color: ColorHex, shift: number): number =>
  (color >> shift) & 0xff;

export const mixColor = (from: ColorHex, to: ColorHex, t: number): ColorHex => {
  const mix = (shift: number): number => {
    const a = channel(from, shift);
    const b = channel(to, shift);
    return Math.round(a + (b - a) * t);
  };
  return (mix(16) << 16) | (mix(8) << 8) | mix(0);
};

export const lightenColor = (color: ColorHex, amount = 40): ColorHex => {
  const lift = (shift: number): number =>
    Math.min(255, channel(color, shift) + amount);
  return (lift(16) << 16) | (lift(8) << 8) | lift(0);
};

export const darkenColor = (color: ColorHex, amount = 40): ColorHex => {
  const drop = (shift: number): number =>
    Math.max(0, channel(color, shift) - amount);
  return (drop(16) << 16) | (drop(8) << 8) | drop(0);
};

export const towardWhite = (color: ColorHex, amount: number): ColorHex =>
  mixColor(color, 0xf7f4ea, amount);

const rgbToHsl = (
  color: ColorHex,
): { h: number; s: number; l: number } => {
  const r = channel(color, 16) / 255;
  const g = channel(color, 8) / 255;
  const b = channel(color, 0) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) {
    return { h: 0, s: 0, l };
  }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) {
    h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / d + 2) / 6;
  } else {
    h = ((r - g) / d + 4) / 6;
  }
  return { h, s, l };
};

const hueToRgb = (p: number, q: number, t: number): number => {
  let tone = t;
  if (tone < 0) {
    tone += 1;
  }
  if (tone > 1) {
    tone -= 1;
  }
  if (tone < 1 / 6) {
    return p + (q - p) * 6 * tone;
  }
  if (tone < 1 / 2) {
    return q;
  }
  if (tone < 2 / 3) {
    return p + (q - p) * (2 / 3 - tone) * 6;
  }
  return p;
};

const hslToRgb = (h: number, s: number, l: number): ColorHex => {
  if (s === 0) {
    const gray = Math.round(l * 255);
    return (gray << 16) | (gray << 8) | gray;
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(hueToRgb(p, q, h + 1 / 3) * 255);
  const g = Math.round(hueToRgb(p, q, h) * 255);
  const b = Math.round(hueToRgb(p, q, h - 1 / 3) * 255);
  return (r << 16) | (g << 8) | b;
};

export const rotateHue = (color: ColorHex, degrees: number): ColorHex => {
  const { h, s, l } = rgbToHsl(color);
  const next = s === 0 ? 0.55 : s;
  let hue = h + degrees / 360;
  hue = hue - Math.floor(hue);
  return hslToRgb(hue, next, l);
};

export const setLightness = (color: ColorHex, lightness: number): ColorHex => {
  const { h, s } = rgbToHsl(color);
  return hslToRgb(h, s, Math.min(1, Math.max(0, lightness)));
};

export const relativeLuminance = (color: ColorHex): number => {
  const r = channel(color, 16) / 255;
  const g = channel(color, 8) / 255;
  const b = channel(color, 0) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

const SUN_RADIANCE_LUMINANCE_FLOOR = 0.68;

/** Lift darker Sun presets so add-blended corona reads the same size. */
export const sunRadianceTint = (color: ColorHex): ColorHex => {
  const { h, s, l } = rgbToHsl(color);
  if (l >= SUN_RADIANCE_LUMINANCE_FLOOR) {
    return color;
  }
  return hslToRgb(h, Math.max(s, 0.52), SUN_RADIANCE_LUMINANCE_FLOOR);
};

/** Alpha boost for low-luminance Sun tints — compensates dimmer additive glow. */
export const sunGlowBoost = (color: ColorHex): number => {
  const lum = relativeLuminance(color);
  if (lum >= SUN_RADIANCE_LUMINANCE_FLOOR) {
    return 1;
  }
  return Math.min(1.55, SUN_RADIANCE_LUMINANCE_FLOOR / Math.max(lum, 0.38));
};
