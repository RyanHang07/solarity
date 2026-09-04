import { Texture } from "pixi.js";
import { mixColor, towardWhite } from "../color";
import { mulberry32 } from "../rng";
import type { ColorHex } from "../types";

const SIZE = 512;

const cssHex = (color: ColorHex): string =>
  `#${color.toString(16).padStart(6, "0")}`;

const alphaHex = (alpha: number): string =>
  Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");

/**
 * The thing a Circle turns around.
 *
 * ## What the first version got wrong
 *
 * It read as **two flat colours meeting in the middle** rather than as a
 * galaxy. Three causes, all fixed here:
 *
 * 1. **The centre was saturated.** The core's hue sat at 80% alpha from six
 *    percent of the radius outward, so a red-blue Circle had a hot pink disc
 *    in the middle. A real galactic bulge is **near-white** — it is the
 *    brightest thing in the frame, and brightness at that intensity reads as
 *    white regardless of what colour the light started as. Colour belongs
 *    further out, where the intensity has dropped enough for the eye to see it
 *    as hue rather than as glare.
 * 2. **The arms switched colour at a hard boundary** (`t < 0.5 ? inner :
 *    outer`), which drew a visible seam halfway along every arm. They now
 *    interpolate continuously.
 * 3. **The arms were too tidy.** Three clean logarithmic curves with evenly
 *    spaced, evenly sized blobs reads as a pinwheel. Real arms are ragged,
 *    uneven in density, and full of gaps.
 *
 * ## Wispiness is jitter, not detail
 *
 * Every blob now takes a random angular and radial offset, a random size and a
 * random alpha, and **is sometimes skipped entirely**. The gaps matter as much
 * as the marks — a continuous arm reads as a drawn line, an interrupted one
 * reads as gas. A separate scatter pass adds haze that belongs to no arm at
 * all, which is what stops the eye tracing the structure.
 *
 * All of it is painted **once** into a canvas at mount. Nothing here runs per
 * frame: the motion is two sprite rotations, whatever is drawn on them.
 */
export const createCoreTexture = (
  inner: ColorHex,
  outer: ColorHex,
): Texture => {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Texture.WHITE;
  }

  const mid = SIZE / 2;

  /**
   * **The bulge is white and the colour lives outside it.**
   *
   * The hue is mixed heavily toward white for the first fifth of the radius and
   * only reaches full saturation past a third, which is the difference between
   * a galaxy and a coloured lamp. Peak alpha is also well down from the first
   * version — this is background, and the systems have to stay readable on top
   * of it.
   */
  const glow = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
  glow.addColorStop(0, "rgba(255,255,255,0.42)");
  glow.addColorStop(0.05, `${cssHex(towardWhite(inner, 0.82))}5e`);
  glow.addColorStop(0.14, `${cssHex(towardWhite(inner, 0.5))}3a`);
  glow.addColorStop(0.3, `${cssHex(inner)}24`);
  glow.addColorStop(0.52, `${cssHex(mixColor(inner, outer, 0.6))}18`);
  glow.addColorStop(0.78, `${cssHex(outer)}0c`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, SIZE, SIZE);

  return Texture.from(canvas);
};

export const createDiscTexture = (
  inner: ColorHex,
  outer: ColorHex,
  seed: number,
): Texture => {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return Texture.WHITE;
  }

  const random = mulberry32(seed);
  const mid = SIZE / 2;
  ctx.globalCompositeOperation = "lighter";

  /** One soft blob of gas. */
  const puff = (
    x: number,
    y: number,
    radius: number,
    color: ColorHex,
    alpha: number,
  ): void => {
    if (alpha <= 0.002 || radius <= 0.5) {
      return;
    }
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `${cssHex(color)}${alphaHex(alpha)}`);
    g.addColorStop(0.55, `${cssHex(color)}${alphaHex(alpha * 0.35)}`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };

  /**
   * **Five arms, not three**, each wound by a different amount and started at
   * an uneven angle. More arms overlapping at low alpha reads as gas; fewer,
   * brighter ones read as a diagram.
   */
  const arms = 5;
  const FLATTEN = 0.42;

  for (let arm = 0; arm < arms; arm += 1) {
    const start = (arm / arms) * Math.PI * 2 + random() * 1.2;
    const turns = 1.3 + random() * 0.7;
    // Arms differ in brightness, so none of them reads as the canonical one.
    const armAlpha = 0.5 + random() * 0.5;
    const steps = 150;

    for (let i = 0; i < steps; i += 1) {
      // **Gaps are the point.** A continuous arm is a drawn line; an
      // interrupted one is a cloud. Density falls off outward, so the arm
      // frays rather than stopping.
      if (random() > 0.86 - i / steps / 4) {
        continue;
      }

      const t = i / steps;
      const wobble = (random() - 0.5) * 0.28;
      const angle = start + t * turns * Math.PI * 2 + wobble;
      const drift = 1 + (random() - 0.5) * 0.22;
      const radius = mid * (0.1 + t * 0.82) * drift;

      const x = mid + Math.cos(angle) * radius;
      const y = mid + Math.sin(angle) * radius * FLATTEN;

      // Continuous, so there is no seam where the two colours meet. Slightly
      // whitened near the middle, matching the bulge.
      const hue = mixColor(inner, outer, Math.min(1, t * 1.15));
      const color = towardWhite(hue, Math.max(0, 0.35 - t * 0.7));

      const alpha =
        0.028 * armAlpha * (0.35 + random() * 0.65) * (1 - t * 0.55);
      const blob = mid * (0.045 + t * 0.12) * (0.6 + random() * 0.9);

      puff(x, y, blob, color, alpha);
    }
  }

  /**
   * **Haze that belongs to no arm.**
   *
   * Without it the eye traces five curves and the structure becomes obvious.
   * Scattered gas breaks that up, and it is where most of the wispiness
   * actually comes from — the arms give the shape, this gives the texture.
   */
  for (let i = 0; i < 220; i += 1) {
    const angle = random() * Math.PI * 2;
    // Biased outward: the middle is already the brightest part of the frame.
    const t = Math.sqrt(random());
    const radius = mid * (0.08 + t * 0.9);
    const x = mid + Math.cos(angle) * radius;
    const y = mid + Math.sin(angle) * radius * FLATTEN;

    const hue = mixColor(inner, outer, Math.min(1, t * 1.2));
    const color = towardWhite(hue, Math.max(0, 0.3 - t * 0.6));
    puff(
      x,
      y,
      mid * (0.05 + random() * 0.14),
      color,
      0.012 * (0.3 + random() * 0.7) * (1 - t * 0.4),
    );
  }

  return Texture.from(canvas);
};
