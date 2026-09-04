import { Graphics } from "pixi.js";
import { darkenColor, mixColor, towardWhite } from "../color";
import type { BeltConfig } from "../types";

const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t;

/** 0 = dormant gray band, 1 = full category-colored Saturn belt. */
export const paintBelt = (
  belt: Graphics,
  config: BeltConfig,
  flatten: number,
  light = 1,
): void => {
  belt.clear();
  const t = Math.min(1, Math.max(0, light));
  const inner = config.innerRadius;
  const outer = config.outerRadius;
  const span = Math.max(4, outer - inner);
  const gap = inner + span * 0.42;
  const innerMid = (inner + gap) / 2;
  const outerMid = (gap + 1.6 + outer) / 2;

  const dormant = mixColor(config.color, 0x3a404c, 0.78);
  const haloColor = mixColor(dormant, config.color, t);
  const innerColor = mixColor(
    mixColor(dormant, 0x5a6270, 0.35),
    towardWhite(config.color, 0.2),
    t,
  );
  const outerColor = mixColor(
    mixColor(darkenColor(config.color, 28), 0x2e333c, 0.4),
    darkenColor(config.color, 10),
    t,
  );

  belt.circle(0, 0, (inner + outer) / 2).stroke({
    width: lerp(span + 2, span + 5, t),
    color: haloColor,
    alpha: lerp(0.035, 0.12, t),
    alignment: 0.5,
  });
  belt.circle(0, 0, innerMid).stroke({
    width: Math.max(1.5, gap - inner),
    color: innerColor,
    alpha: lerp(0.18, 0.55, t),
    alignment: 0.5,
  });
  belt.circle(0, 0, outerMid).stroke({
    width: Math.max(1.8, outer - gap - 1.6),
    color: outerColor,
    alpha: lerp(0.28, 0.8, t),
    alignment: 0.5,
  });
  belt.scale.y = flatten;
  belt.eventMode = "none";
};

export const createBelt = (
  config: BeltConfig,
  flatten: number,
  light = 1,
): Graphics => {
  const belt = new Graphics({ label: "belt" });
  paintBelt(belt, config, flatten, light);
  return belt;
};

export const setBeltFlatten = (belt: Graphics, flatten: number): void => {
  belt.scale.y = flatten;
};
