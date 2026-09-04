import { Container, Graphics } from "pixi.js";
import type { ColorHex } from "../types";

export type BridgeAnchor = {
  x: number;
  y: number;
  color: ColorHex;
};

/**
 * Light between the suns, for the moment every member finished.
 *
 * ## Why this exists at all
 *
 * It is **the only thing on this screen a personal galaxy structurally cannot
 * do**. One sun closing its day already has a moment — the corona swells. Ten
 * suns closing on the same day is a fact about the group, and a group needs a
 * picture that a person could not produce alone. That is what earns it the
 * cost.
 *
 * ## A hub, not a mesh
 *
 * The obvious version links every sun to every other, and at ten members that
 * is forty-five segments and, more to the point, a hairball — the picture stops
 * being "we are bound together" and becomes "here is a graph".
 *
 * Every sun to the middle instead: **ten lines, not forty-five**, and it says
 * the thing more clearly. It also agrees with the backdrop, where the sky
 * already turns as though something at the centre were holding it.
 *
 * ## What it costs
 *
 * One `Graphics`, rebuilt only while the moment is playing. Between moments it
 * is empty and invisible, so a Circle sitting idle pays nothing for it. That
 * matters more than it sounds: this is the one effect that touches every member
 * at once, and it is the frame most likely to stutter on a phone.
 */
export const createSkyBridges = (): Graphics => {
  const bridges = new Graphics({ label: "sky-bridges" });
  bridges.eventMode = "none";
  bridges.blendMode = "add";
  // Behind the systems and in front of the nebula: the light passes between
  // the suns rather than over them.
  bridges.zIndex = -900;
  bridges.visible = false;
  return bridges;
};

/**
 * Paint the bridges at `t` in `0..1`.
 *
 * The line grows from the centre outward rather than fading in place, so the
 * moment reads as something reaching out to each member in turn rather than a
 * shape being switched on.
 */
/**
 * How light is built here, and why the first version was wrong.
 *
 * **It was two strokes, both in the member's sun colour**, at width 2 and 6.
 * That is not what light looks like — it is a coloured bar with a coloured
 * halo, which reads as a glowstick: a solid object that happens to be bright.
 *
 * Real light has almost no colour at its centre. A filament is white-hot and
 * the hue only appears in the falloff, where the intensity has dropped enough
 * for the eye to read it as colour rather than as brightness. So the recipe is
 * **four passes, widest and most saturated first, narrowing to a near-white
 * core** — every layer additive, so where they overlap they sum toward white on
 * their own rather than being told to.
 *
 * Each is drawn at low alpha and lets the blend mode do the work. A single
 * bright stroke cannot produce this: brightness at the centre and colour at the
 * edge is a *gradient across the width*, and a stroke has no width gradient.
 */
const BRIDGE_LAYERS = [
  { width: 14, alpha: 0.05, whiten: 0 },
  { width: 7, alpha: 0.09, whiten: 0 },
  { width: 3, alpha: 0.16, whiten: 0.45 },
  { width: 1.2, alpha: 0.5, whiten: 0.85 },
] as const;

/** Toward white by `amount`, so the core loses its hue as it gains intensity. */
const whiten = (color: number, amount: number): number => {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const mix = (channel: number): number =>
    Math.round(channel + (255 - channel) * amount);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
};

export const paintSkyBridges = (
  bridges: Graphics,
  anchors: readonly BridgeAnchor[],
  t: number,
): void => {
  bridges.clear();

  if (t <= 0 || anchors.length < 2) {
    bridges.visible = false;
    return;
  }
  bridges.visible = true;

  // Eases out at the end so the light lingers a moment before it goes.
  const reach = Math.min(1, t * 1.35);
  const fade = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;

  for (const anchor of anchors) {
    const x = anchor.x * reach;
    const y = anchor.y * reach;
    for (const layer of BRIDGE_LAYERS) {
      bridges
        .moveTo(0, 0)
        .lineTo(x, y)
        .stroke({
          width: layer.width,
          color: whiten(anchor.color, layer.whiten),
          alpha: layer.alpha * fade,
        });
    }
  }
};

export const clearSkyBridges = (bridges: Graphics): void => {
  bridges.clear();
  bridges.visible = false;
};

/**
 * How far the cluster draws in at `t`.
 *
 * **Small on purpose.** The systems move toward each other by a tenth, which
 * is enough to feel like a gathering and not enough to look like the layout
 * broke — and the layout is the one thing in this scene that must stay
 * trustworthy, because a member's position is how you find them.
 */
export const CONVERGENCE_MAX = 0.1;

export const convergenceAt = (t: number): number => {
  if (t <= 0 || t >= 1) {
    return 0;
  }
  // In and back out: the cluster gathers, holds, and releases.
  const wave = Math.sin(Math.PI * t);
  return CONVERGENCE_MAX * wave;
};

/** Anchors for every system, relative to the cluster's centre. */
export const bridgeAnchorsFrom = (
  systems: readonly { root: Container; sunColor: ColorHex }[],
): BridgeAnchor[] =>
  systems.map((system) => ({
    x: system.root.x,
    y: system.root.y,
    color: system.sunColor,
  }));
