import { Container, Sprite, Texture } from "pixi.js";
import { mixColor } from "../color";
import { mulberry32 } from "../rng";
import { createNebulaCloudTextures } from "../render/nebulaTexture";
import type { NebulaConfig, StarConfig } from "../types";
import {
  nebulaPalette,
  nebulaSourceColors,
  nebulaSourceWeights,
  nebulaUnlocked,
  placeNebulaStamps,
} from "../systems/nebulaClusters";
import { milestoneNebulaAlpha } from "../systems/starMilestones";

type StampPose = {
  baseAlpha: number;
  baseX: number;
  baseY: number;
  baseScaleX: number;
  baseScaleY: number;
  baseTint: number;
  altTint: number;
  spin: number;
  phase: number;
  drift: number;
  colorPhase: number;
};

const stampPose = new WeakMap<Sprite, StampPose>();

export const createNebula = (opts: {
  nebula?: NebulaConfig;
  stars: StarConfig[];
  reach: number;
  texture: Texture;
  preview?: boolean;
  milestoneTier?: number;
  layoutSeed?: number;
}): Container | null => {
  if (!nebulaUnlocked(opts.stars, Boolean(opts.preview), opts.nebula)) {
    return null;
  }
  const source = nebulaSourceColors(opts.stars, opts.nebula);
  const weights = nebulaSourceWeights(opts.stars, opts.nebula);
  const layoutSeed =
    opts.layoutSeed ?? (Math.imul(source.length, 0x9e3779b1) >>> 0);
  const stamps = placeNebulaStamps(source, layoutSeed, undefined, weights);
  if (stamps.length === 0) {
    return null;
  }

  const palette = nebulaPalette(source, weights);
  const root = new Container({ label: "nebula" });
  root.eventMode = "none";
  root.zIndex = -1500;
  const alpha = milestoneNebulaAlpha(
    opts.milestoneTier ?? 0,
    opts.nebula?.alpha ?? 0.2,
  );
  const reach = opts.reach;
  const maps = createNebulaCloudTextures(layoutSeed);
  const layer = new Container({ label: "nebula-stamps" });
  layer.eventMode = "none";
  layer.blendMode = "add";
  const random = mulberry32(layoutSeed ^ 0x85ebca6b);

  for (const stamp of stamps) {
    const map = maps[Math.floor(random() * maps.length)] ?? maps[0];
    if (!map) {
      continue;
    }
    const sprite = new Sprite({
      texture: map,
      anchor: 0.5,
      blendMode: "add",
    });
    const px = stamp.x * reach;
    const py = stamp.y * reach;
    sprite.position.set(px, py);
    const spread = stamp.spread * reach;
    const scale = (spread * stamp.scale) / 128;
    const scaleY = scale * (0.62 + random() * 0.28);
    sprite.scale.set(scale, scaleY);
    sprite.rotation = stamp.rotation;
    sprite.tint = stamp.tint;
    const baseAlpha = alpha * (0.42 + random() * 0.38);
    sprite.alpha = baseAlpha;
    const altTint =
      palette.find((color) => color !== stamp.tint) ??
      mixColor(stamp.tint, palette[0] ?? stamp.tint, 0.45);
    stampPose.set(sprite, {
      baseAlpha,
      baseX: px,
      baseY: py,
      baseScaleX: scale,
      baseScaleY: scaleY,
      baseTint: stamp.tint,
      altTint,
      spin: stamp.spin,
      phase: stamp.phase,
      drift: stamp.drift,
      colorPhase: random() * Math.PI * 2,
    });
    layer.addChild(sprite);
  }

  root.addChild(layer);
  root.on("destroyed", () => {
    for (const map of maps) {
      map.destroy(true);
    }
  });
  return root;
};

export const tickNebula = (
  root: Container,
  elapsedMs: number,
  deltaMS: number,
  motion: boolean,
): void => {
  if (!motion) {
    return;
  }
  const layer = root.getChildByLabel("nebula-stamps");
  if (!(layer instanceof Container)) {
    return;
  }
  layer.rotation += (deltaMS / 1000) * 0.018;
  const dt = deltaMS / 1000;
  for (const child of layer.children) {
    if (!(child instanceof Sprite)) {
      continue;
    }
    const pose = stampPose.get(child);
    if (!pose) {
      continue;
    }
    child.rotation += pose.spin * dt;
    const breathe = 0.68 + 0.32 * Math.sin(elapsedMs / 2200 + pose.phase);
    child.alpha = pose.baseAlpha * breathe;
    const swell = 1 + 0.08 * Math.sin(elapsedMs / 3100 + pose.phase * 1.7);
    child.scale.set(pose.baseScaleX * swell, pose.baseScaleY * swell);
    const colorWave =
      0.5 + 0.5 * Math.sin(elapsedMs / 5200 + pose.colorPhase);
    child.tint = mixColor(pose.baseTint, pose.altTint, colorWave * 0.42);
    const driftX =
      Math.sin(elapsedMs / 3600 + pose.phase) * pose.drift * dt * 0.72 +
      Math.sin(elapsedMs / 9100 + pose.phase * 0.6) * pose.drift * dt * 0.28;
    const driftY =
      Math.cos(elapsedMs / 4800 + pose.phase * 1.3) * pose.drift * dt * 0.72 +
      Math.cos(elapsedMs / 7800 + pose.phase * 1.1) * pose.drift * dt * 0.28;
    child.position.set(pose.baseX + driftX, pose.baseY + driftY);
  }
};
