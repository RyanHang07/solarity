import { Container, Graphics } from "pixi.js";
import { mixColor } from "../color";
import type { ColorHex } from "../types";

/**
 * The colour of a ring nobody has checked off yet.
 *
 * **Near-white, and it used to be `0x6d7380`.** That is a mid slate grey, and
 * it was chosen against an empty near-black sky where it read fine. The Circle
 * sky is not empty: a galactic core and a nebula sit behind the orbits, and on
 * the warm end of the palette — the red-yellow and red-blue blends — a grey
 * that dim disappears into the backdrop it is drawn over.
 *
 * A brighter idle colour also says the right thing. **An unchecked ring is the
 * default state, not a disabled one**; the dimming that marks it as "nothing
 * has happened here yet" is the alpha in `orbitStrokeAt`, and doing it twice —
 * once in the colour and once in the alpha — is what made them vanish.
 *
 * `mixColor` still carries it to the category colour as a goal is checked off,
 * so the *change* on check-in stays as legible as it was.
 */
export const ORBIT_IDLE_COLOR = 0xd6dae4;

export type OrbitRing = {
  id: string;
  radius: number;
  color: ColorHex;
  shine: boolean;
};

export const orbitStrokeAt = (
  color: ColorHex,
  amount: number,
  legibility = 1,
): { color: ColorHex; width: number; alpha: number } => {
  const t = Math.min(1, Math.max(0, amount));
  return {
    color: mixColor(ORBIT_IDLE_COLOR, color, t),
    /**
     * **Legibility is spent on alpha, not on width, and there is a floor.**
     *
     * Multiplying the width by the legibility directly is what made a Circle's
     * rings vanish: at ten members the stroke came out at 0.44 physical pixels,
     * and a sub-pixel line is not a faint line — the rasteriser blends it into
     * the background and it is simply gone.
     *
     * A line that reads as *thinner* is mostly a line that reads as *dimmer*,
     * so the dimming happens in alpha, the width keeps most of its weight, and
     * `0.9` is the floor below which a stroke stops being a stroke.
     */
    width: Math.max(0.9, (1.25 + t * 0.55) * (0.55 + 0.45 * legibility)),
    alpha: Math.min(1, (0.34 + t * 0.36) * legibility),
  };
};

export const orbitStroke = (
  ring: OrbitRing,
): { color: ColorHex; width: number; alpha: number } =>
  orbitStrokeAt(ring.color, ring.shine ? 1 : 0);

export const paintOrbitRing = (
  graphic: Graphics,
  ring: OrbitRing,
  flatten: number,
  amount = ring.shine ? 1 : 0,
  legibility = 1,
): void => {
  paintOrbitRingAtRadius(
    graphic,
    ring,
    flatten,
    ring.radius,
    amount,
    legibility,
  );
};

export const paintOrbitRingAtRadius = (
  graphic: Graphics,
  ring: OrbitRing,
  flatten: number,
  radius: number,
  amount = ring.shine ? 1 : 0,
  legibility = 1,
): void => {
  graphic.clear();
  const stroke = orbitStrokeAt(ring.color, amount, legibility);
  graphic.ellipse(0, 0, radius, radius * flatten).stroke({
    width: stroke.width,
    color: stroke.color,
    alpha: stroke.alpha,
  });
};

export const createOrbitPaths = (
  rings: OrbitRing[],
  flatten: number,
  amounts?: ReadonlyMap<string, number>,
  legibility = 1,
): Container => {
  const paths = new Container({ label: "orbit-paths" });
  paths.eventMode = "none";
  paths.zIndex = -1000;
  for (const ring of rings) {
    const graphic = new Graphics({ label: `orbit-ring-${ring.id}` });
    graphic.eventMode = "none";
    paintOrbitRing(graphic, ring, flatten, amounts?.get(ring.id), legibility);
    paths.addChild(graphic);
  }
  return paths;
};
