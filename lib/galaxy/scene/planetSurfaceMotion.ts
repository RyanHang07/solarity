import { Container, Graphics } from "pixi.js";
import type { ColorHex, SurfaceKind } from "../types";

/** Expanding ring + spark flash when a goal is achieved. */
export const playAchieveCelebration = (
  root: Container,
  x: number,
  y: number,
  color: ColorHex,
  onTick: (
    update: (t: number) => void,
    finish: () => void,
    kind: string,
  ) => void,
  kind: string,
  ringStrength = 1,
): void => {
  const ring = new Graphics({ label: "achieve-ring" });
  ring.eventMode = "none";
  ring.blendMode = "add";
  root.addChild(ring);

  const sparks = new Graphics({ label: "achieve-sparks" });
  sparks.eventMode = "none";
  sparks.blendMode = "add";
  root.addChild(sparks);

  onTick(
    (t) => {
      if (ring.destroyed || sparks.destroyed) {
        return;
      }
      const ease = 1 - (1 - t) ** 2;
      const radius = (8 + ease * 72) * ringStrength;
      const alpha = (1 - t) * 0.55 * Math.min(1.4, ringStrength);
      ring.clear();
      ring
        .circle(x, y, radius)
        .stroke({ width: 2.4 - t * 1.2, color, alpha });
      ring
        .circle(x, y, radius * 0.62)
        .stroke({ width: 1.2, color: 0xffffff, alpha: alpha * 0.7 });

      sparks.clear();
      const rays = 8;
      for (let i = 0; i < rays; i += 1) {
        const angle = (i / rays) * Math.PI * 2 + t * 0.8;
        const inner = radius * 0.35;
        const outer = radius * (0.85 + (i % 2) * 0.12);
        sparks
          .moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner)
          .lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer)
          .stroke({ width: 1.6, color: 0xffffff, alpha: alpha * 0.9 });
      }
    },
    () => {
      ring.destroy();
      sparks.destroy();
    },
    kind,
  );
};

export const surfaceMotionProfile = (
  kind: SurfaceKind,
): {
  spinMul: number;
  cloudSpinMul: number;
  emissive: boolean;
} => {
  switch (kind) {
    case "gas":
      return { spinMul: 1.35, cloudSpinMul: 1.9, emissive: true };
    case "storm":
      return { spinMul: 1.1, cloudSpinMul: 2.4, emissive: true };
    case "lava":
      return { spinMul: 0.65, cloudSpinMul: 0.5, emissive: true };
    case "ice":
      return { spinMul: 0.85, cloudSpinMul: 0.7, emissive: false };
    case "arid":
      return { spinMul: 0.9, cloudSpinMul: 0.6, emissive: false };
    default:
      return { spinMul: 1, cloudSpinMul: 1, emissive: false };
  }
};

export const paintPlanetEmissive = (
  graphic: Graphics,
  kind: SurfaceKind,
  radius: number,
  color: ColorHex,
  elapsedMs: number,
): void => {
  graphic.clear();
  const pulse = 0.5 + 0.5 * Math.sin(elapsedMs / 380);
  const slow = 0.5 + 0.5 * Math.sin(elapsedMs / 920);

  if (kind === "lava") {
    graphic.circle(-radius * 0.22, radius * 0.08, radius * 0.18).fill({
      color: 0xff5a18,
      alpha: 0.12 + pulse * 0.22,
    });
    graphic.circle(radius * 0.16, -radius * 0.12, radius * 0.12).fill({
      color: 0xffcc44,
      alpha: 0.08 + pulse * 0.16,
    });
    graphic
      .moveTo(-radius * 0.34, radius * 0.2)
      .lineTo(radius * 0.28, -radius * 0.16)
      .stroke({
        width: Math.max(1.2, radius * 0.08),
        color: 0xff7020,
        alpha: 0.08 + pulse * 0.2,
      });
    return;
  }

  if (kind === "storm") {
    const spin = elapsedMs / 1400;
    for (let band = 0; band < 3; band += 1) {
      const wobble = Math.sin(spin + band) * radius * 0.08;
      graphic
        .ellipse(0, wobble, radius * (0.72 - band * 0.12), radius * 0.16)
        .stroke({
          width: 1.2,
          color: mixStormColor(color),
          alpha: 0.06 + slow * 0.14,
        });
    }
    graphic.circle(radius * 0.12, 0, radius * 0.1).fill({
      color: 0xf4efe2,
      alpha: 0.05 + pulse * 0.12,
    });
    return;
  }

  if (kind === "gas") {
    for (let i = 0; i < 4; i += 1) {
      const y = (i - 1.5) * radius * 0.22;
      graphic
        .ellipse(0, y, radius * 0.82, radius * 0.08)
        .stroke({
          width: 1,
          color: 0xf0d8a8,
          alpha: 0.04 + slow * 0.1,
        });
    }
  }
};

const mixStormColor = (color: ColorHex): ColorHex =>
  ((color & 0xfefefe) >> 1) + 0x303030;
