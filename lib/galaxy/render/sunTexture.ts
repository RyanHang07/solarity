import { Texture } from "pixi.js";
import { mixColor, towardWhite } from "../color";
import type { ColorHex } from "../types";

const MAP_SIZE = 128;
const GLOW_SIZE = 256;

const cssHex = (color: ColorHex): string =>
  `#${color.toString(16).padStart(6, "0")}`;

/** Smooth radial falloff — no hard ring edges when scaled and add-blended. */
export const createSunGlowTexture = (): Texture => {
  const canvas = document.createElement("canvas");
  canvas.width = GLOW_SIZE;
  canvas.height = GLOW_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    return Texture.WHITE;
  }
  const center = GLOW_SIZE / 2;
  const gradient = context.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center,
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.12, "rgba(255,255,255,0.82)");
  gradient.addColorStop(0.32, "rgba(255,255,255,0.38)");
  gradient.addColorStop(0.58, "rgba(255,255,255,0.12)");
  gradient.addColorStop(0.82, "rgba(255,255,255,0.04)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
  return Texture.from(canvas);
};

/** Soft beam for solar radiation — radial streaks, no hard edges. */
export const createSunRayTexture = (): Texture => {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 48;
  const context = canvas.getContext("2d");
  if (!context) {
    return Texture.WHITE;
  }
  const along = context.createLinearGradient(0, 0, 256, 0);
  along.addColorStop(0, "rgba(255,255,255,0.55)");
  along.addColorStop(0.08, "rgba(255,255,255,0.38)");
  along.addColorStop(0.35, "rgba(255,255,255,0.14)");
  along.addColorStop(0.72, "rgba(255,255,255,0.04)");
  along.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = along;
  context.fillRect(0, 0, 256, 48);
  const across = context.createLinearGradient(0, 0, 0, 48);
  across.addColorStop(0, "rgba(255,255,255,0)");
  across.addColorStop(0.35, "rgba(255,255,255,1)");
  across.addColorStop(0.65, "rgba(255,255,255,1)");
  across.addColorStop(1, "rgba(255,255,255,0)");
  context.globalCompositeOperation = "destination-in";
  context.fillStyle = across;
  context.fillRect(0, 0, 256, 48);
  return Texture.from(canvas);
};

const clipDisk = (ctx: CanvasRenderingContext2D, size: number): void => {
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.clip();
};

/** Luminous disk: radial body + granules, feathered limb — no stripe bands. */
export const createSunSurfaceTexture = (
  color: ColorHex,
  random: () => number,
): Texture => {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    return Texture.WHITE;
  }

  const size = MAP_SIZE;
  const center = size / 2;
  const radius = size / 2 - 1;
  const hot = towardWhite(color, 0.72);
  const warm = mixColor(color, hot, 0.62);

  context.save();
  clipDisk(context, size);

  const body = context.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    radius,
  );
  body.addColorStop(0, cssHex(towardWhite(hot, 0.4)));
  body.addColorStop(0.28, cssHex(hot));
  body.addColorStop(0.62, cssHex(warm));
  body.addColorStop(0.88, cssHex(mixColor(color, hot, 0.35)));
  body.addColorStop(1, cssHex(mixColor(color, hot, 0.15)));
  context.fillStyle = body;
  context.fillRect(0, 0, size, size);

  const granules = 64 + Math.floor(random() * 32);
  for (let i = 0; i < granules; i += 1) {
    const angle = random() * Math.PI * 2;
    const dist = random() * radius * 0.88;
    const x = center + Math.cos(angle) * dist;
    const y = center + Math.sin(angle) * dist;
    const blob = 1.2 + random() * 5;
    context.globalAlpha = 0.04 + random() * 0.14;
    context.fillStyle = cssHex(
      random() > 0.45 ? towardWhite(hot, random() * 0.25) : warm,
    );
    context.beginPath();
    context.arc(x, y, blob, 0, Math.PI * 2);
    context.fill();
  }

  context.globalAlpha = 0.45;
  context.fillStyle = cssHex(towardWhite(hot, 0.45));
  context.beginPath();
  context.arc(center, center, radius * 0.38, 0, Math.PI * 2);
  context.fill();

  context.globalCompositeOperation = "destination-in";
  const limb = context.createRadialGradient(
    center,
    center,
    radius * 0.35,
    center,
    center,
    radius,
  );
  limb.addColorStop(0, "rgba(255,255,255,1)");
  limb.addColorStop(0.78, "rgba(255,255,255,0.88)");
  limb.addColorStop(0.94, "rgba(255,255,255,0.25)");
  limb.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = limb;
  context.fillRect(0, 0, size, size);

  context.restore();
  return Texture.from(canvas);
};

/** Soft chromatic haze — radial noise wisps, not horizontal lines. */
export const createSunVeilTexture = (
  color: ColorHex,
  random: () => number,
): Texture => {
  const canvas = document.createElement("canvas");
  canvas.width = MAP_SIZE;
  canvas.height = MAP_SIZE;
  const context = canvas.getContext("2d");
  if (!context) {
    return Texture.WHITE;
  }

  const size = MAP_SIZE;
  const center = size / 2;
  const radius = size / 2 - 1;
  const warm = towardWhite(color, 0.55);

  context.save();
  clipDisk(context, size);

  for (let i = 0; i < 28; i += 1) {
    const angle = random() * Math.PI * 2;
    const dist = random() * radius * 0.75;
    const x = center + Math.cos(angle) * dist;
    const y = center + Math.sin(angle) * dist;
    const blob = radius * (0.08 + random() * 0.18);
    context.globalAlpha = 0.03 + random() * 0.07;
    context.fillStyle = cssHex(mixColor(color, warm, 0.35 + random() * 0.4));
    context.beginPath();
    context.arc(x, y, blob, 0, Math.PI * 2);
    context.fill();
  }

  context.globalCompositeOperation = "destination-in";
  const fade = context.createRadialGradient(
    center,
    center,
    radius * 0.15,
    center,
    center,
    radius,
  );
  fade.addColorStop(0, "rgba(255,255,255,0.5)");
  fade.addColorStop(0.7, "rgba(255,255,255,0.18)");
  fade.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = fade;
  context.fillRect(0, 0, size, size);
  context.restore();
  return Texture.from(canvas);
};
