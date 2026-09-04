import { Texture } from "pixi.js";
import { darkenColor, mixColor, rotateHue, towardWhite } from "../color";
import { SURFACE_KINDS } from "../constants";
import type { ColorHex, SurfaceKind } from "../types";

/**
 * **Re-exported, and it no longer lives here.**
 *
 * `SURFACE_KINDS` is six strings and this module imports `pixi.js`, so every
 * consumer of the list was pulling the whole renderer in behind it. That
 * included `planetCosmetics.ts`, which `buildSnapshot.ts` imports — meaning
 * the *data* half of this module, the half a host runs on a server to map its
 * database rows, transitively depended on WebGL.
 *
 * Nothing in the type system or the linter can see that; only a bundler can,
 * and only when a host that separates server from client tries to use it.
 * Moved to `constants.ts`, which imports nothing.
 *
 * The re-export is kept so `index.ts` and existing imports do not move.
 */
export { SURFACE_KINDS };

const MAP_SIZE = 128;

const cssHex = (color: ColorHex): string =>
  `#${color.toString(16).padStart(6, "0")}`;

const fillCircle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: ColorHex,
  alpha = 1,
): void => {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = cssHex(color);
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
};

const clipDisk = (ctx: CanvasRenderingContext2D, size: number): void => {
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
  ctx.clip();
};

const paintAlbedo = (
  ctx: CanvasRenderingContext2D,
  kind: SurfaceKind,
  color: ColorHex,
  random: () => number,
): void => {
  const size = MAP_SIZE;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 1;

  if (kind === "terra") {
    const ocean = mixColor(rotateHue(color, 155), 0x0e4a78, 0.62);
    const land = mixColor(color, 0x4e8a32, 0.35);
    const highland = mixColor(rotateHue(color, -28), 0xc4a15c, 0.4);
    ctx.fillStyle = cssHex(ocean);
    ctx.fillRect(0, 0, size, size);
    const continents = 5 + Math.floor(random() * 3);
    for (let i = 0; i < continents; i += 1) {
      const blob = radius * (0.18 + random() * 0.28);
      fillCircle(
        ctx,
        cx + (random() - 0.5) * radius * 1.35,
        cy + (random() - 0.5) * radius * 1.15,
        blob,
        i % 3 === 0 ? highland : land,
        0.94,
      );
    }
    fillCircle(ctx, cx, cy - radius * 0.82, radius * 0.38, 0xeaf4ff, 0.7);
    fillCircle(ctx, cx, cy + radius * 0.84, radius * 0.32, 0xeaf4ff, 0.55);
    return;
  }

  if (kind === "gas") {
    const dusk = darkenColor(rotateHue(color, -18), 18);
    ctx.fillStyle = cssHex(dusk);
    ctx.fillRect(0, 0, size, size);
    const bands = 9;
    for (let i = 0; i < bands; i += 1) {
      const y = (i / bands) * size;
      const stripe =
        i % 2 === 0
          ? mixColor(rotateHue(color, 28), 0xf0d6a8, 0.45)
          : darkenColor(rotateHue(color, 8), 8);
      ctx.fillStyle = cssHex(stripe);
      ctx.globalAlpha = 0.72;
      ctx.fillRect(0, y, size, size / bands + 3);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = cssHex(mixColor(color, 0xe06038, 0.45));
    ctx.beginPath();
    ctx.ellipse(
      cx + radius * 0.18,
      cy + radius * 0.08,
      radius * 0.28,
      radius * 0.14,
      random() * 0.4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    return;
  }

  if (kind === "arid") {
    const sand = mixColor(color, 0xd4a45a, 0.58);
    const rust = mixColor(rotateHue(color, -22), 0x7a3018, 0.42);
    ctx.fillStyle = cssHex(sand);
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 7; i += 1) {
      fillCircle(
        ctx,
        cx + (random() - 0.5) * radius * 1.4,
        cy + (random() - 0.5) * radius * 1.2,
        radius * (0.08 + random() * 0.16),
        rust,
        0.4 + random() * 0.2,
      );
    }
    return;
  }

  if (kind === "ice") {
    const shelf = towardWhite(mixColor(color, 0xa8d4ff, 0.45), 0.18);
    ctx.fillStyle = cssHex(shelf);
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 6; i += 1) {
      fillCircle(
        ctx,
        cx + (random() - 0.5) * radius,
        cy + (random() - 0.5) * radius,
        radius * (0.12 + random() * 0.18),
        mixColor(rotateHue(color, 40), 0x1f4e86, 0.55),
        0.28,
      );
    }
    fillCircle(ctx, cx, cy - radius * 0.7, radius * 0.42, 0xf7fbff, 0.65);
    fillCircle(ctx, cx, cy + radius * 0.72, radius * 0.36, 0xf7fbff, 0.5);
    return;
  }

  if (kind === "lava") {
    const rock = mixColor(color, 0x1c1814, 0.72);
    const magma = mixColor(rotateHue(color, -12), 0xff4a12, 0.55);
    ctx.fillStyle = cssHex(rock);
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = cssHex(magma);
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < 8; i += 1) {
      ctx.beginPath();
      ctx.moveTo(random() * size, random() * size);
      ctx.quadraticCurveTo(
        random() * size,
        random() * size,
        random() * size,
        random() * size,
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 5; i += 1) {
      fillCircle(
        ctx,
        cx + (random() - 0.5) * radius,
        cy + (random() - 0.5) * radius,
        radius * (0.08 + random() * 0.1),
        0xffcc55,
        0.55,
      );
    }
    return;
  }

  const dusk = mixColor(color, 0x5a6a90, 0.4);
  ctx.fillStyle = cssHex(dusk);
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = cssHex(mixColor(rotateHue(color, 24), 0xead6b0, 0.5));
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, cy - radius * 0.2, size, radius * 0.38);
  ctx.globalAlpha = 1;
  ctx.fillStyle = cssHex(mixColor(color, 0xb03a28, 0.42));
  ctx.beginPath();
  ctx.ellipse(cx + radius * 0.1, cy, radius * 0.38, radius * 0.22, 0.3, 0, Math.PI * 2);
  ctx.fill();
  fillCircle(ctx, cx + radius * 0.12, cy, radius * 0.08, 0xf4f0e4, 0.85);
};

const paintClouds = (
  ctx: CanvasRenderingContext2D,
  kind: SurfaceKind,
  color: ColorHex,
  random: () => number,
): boolean => {
  if (kind === "arid" || kind === "lava") {
    return false;
  }
  const size = MAP_SIZE;
  const radius = size / 2 - 1;
  const haze =
    kind === "ice" ? 0xeef6ff : towardWhite(mixColor(color, 0xffffff, 0.35), 0.55);
  const wisps = kind === "gas" ? 10 : 7;
  for (let i = 0; i < wisps; i += 1) {
    ctx.fillStyle = cssHex(haze);
    ctx.globalAlpha = 0.18 + random() * 0.22;
    ctx.beginPath();
    ctx.ellipse(
      random() * size,
      random() * size,
      radius * (0.16 + random() * 0.28),
      radius * (0.06 + random() * 0.1),
      random() * Math.PI,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return true;
};

const canvasToTexture = (canvas: HTMLCanvasElement): Texture => {
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "linear";
  return texture;
};

export const createPlanetTextures = (opts: {
  kind: SurfaceKind;
  color: ColorHex;
  random: () => number;
}): { albedo: Texture; clouds: Texture | null } => {
  const albedoCanvas = document.createElement("canvas");
  albedoCanvas.width = MAP_SIZE;
  albedoCanvas.height = MAP_SIZE;
  const albedoCtx = albedoCanvas.getContext("2d");
  if (!albedoCtx) {
    return { albedo: Texture.WHITE, clouds: null };
  }
  albedoCtx.save();
  clipDisk(albedoCtx, MAP_SIZE);
  paintAlbedo(albedoCtx, opts.kind, opts.color, opts.random);
  albedoCtx.restore();

  let clouds: Texture | null = null;
  const cloudCanvas = document.createElement("canvas");
  cloudCanvas.width = MAP_SIZE;
  cloudCanvas.height = MAP_SIZE;
  const cloudCtx = cloudCanvas.getContext("2d");
  if (cloudCtx) {
    cloudCtx.save();
    clipDisk(cloudCtx, MAP_SIZE);
    if (paintClouds(cloudCtx, opts.kind, opts.color, opts.random)) {
      clouds = canvasToTexture(cloudCanvas);
    }
    cloudCtx.restore();
  }

  return { albedo: canvasToTexture(albedoCanvas), clouds };
};
