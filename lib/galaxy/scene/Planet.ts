import { Container, FillGradient, Graphics, Sprite, Texture } from "pixi.js";
import { towardWhite } from "../color";
import { hashString, mulberry32, pickIndex } from "../rng";
import { SURFACE_KINDS } from "../constants";
import { createPlanetTextures } from "../render/planetTexture";
import type { ColorHex, PlanetConfig, SurfaceKind } from "../types";
import { createBelt, paintBelt } from "./Ring";
import {
  paintPlanetEmissive,
  surfaceMotionProfile,
} from "./planetSurfaceMotion";

/**
 * **`pickIndex`, not `% SURFACE_KINDS.length`.** There are six surfaces and
 * `hashString % 6` reaches only three of them, so `terra`, `arid` and `lava`
 * were unreachable for any goal identified by a uuid — which is every goal in
 * the product. It looked right in the playground because short ids happen to
 * distribute evenly. See `pickIndex` in `rng.ts` for the measurements.
 */
export const resolvePlanetSurfaceKind = (config: PlanetConfig): SurfaceKind =>
  config.surfaceKind ??
  SURFACE_KINDS[
    pickIndex(
      hashString(String(config.visualSeed ?? config.id)),
      SURFACE_KINDS.length,
    )
  ] ??
  "terra";

/**
 * The children the per-frame code touches, resolved once at creation.
 *
 * ## Why this exists
 *
 * `tickPlanetSpin` and `tickPlanetSurface` between them ran **five
 * `getChildByLabel` calls per planet per frame**, three of them with
 * `deep = true` — a recursive walk of the planet's subtree comparing strings
 * at every node. Three of the five also built their label with a template
 * literal, so a hundred planets allocated three hundred throwaway strings a
 * frame purely to look up children that had not moved since they were made.
 *
 * None of that mattered at ten planets, which is the only case that has ever
 * run. A Circle of ten members is up to a hundred, and this is the loop that
 * decides whether the Circle galaxy is smooth on a phone.
 *
 * ## Why the lookups are kept as a fallback
 *
 * `paintPlanetLook` is exported and is called from `Galaxy` against wraps it
 * did not necessarily build, and the tests construct bare containers. So
 * `partsOf` resolves the cache when it is there and falls back to searching
 * when it is not: the fast path is an optimisation, never a requirement.
 */
type PlanetParts = {
  albedo: Sprite | null;
  clouds: Container | null;
  glow: Graphics | null;
  atmo: Graphics | null;
  shade: Sprite | null;
  form: Graphics | null;
  spin: Container | null;
  emissive: Graphics | null;
};

type PlanetWrap = Container & { planetParts?: PlanetParts };

const findParts = (wrap: Container, id: string): PlanetParts => {
  const albedo = wrap.getChildByLabel(`planet-albedo-${id}`, true);
  const glow = wrap.getChildByLabel(`planet-glow-${id}`, true);
  const atmo = wrap.getChildByLabel(`planet-atmo-${id}`, true);
  const shade = wrap.getChildByLabel(`planet-shade-${id}`, true);
  const form = wrap.getChildByLabel(`planet-form-${id}`, true);
  const emissive = wrap.getChildByLabel(`planet-emissive-${id}`, true);
  return {
    albedo: albedo instanceof Sprite ? albedo : null,
    clouds: wrap.getChildByLabel("planet-clouds", true),
    glow: glow instanceof Graphics ? glow : null,
    atmo: atmo instanceof Graphics ? atmo : null,
    shade: shade instanceof Sprite ? shade : null,
    form: form instanceof Graphics ? form : null,
    spin: wrap.getChildByLabel("planet-spin"),
    emissive: emissive instanceof Graphics ? emissive : null,
  };
};

/**
 * Cached parts, or a fresh search. **Never a stale hit**: a destroyed child
 * would keep being written to, so the cache is dropped if anything in it has
 * been torn down — which is what `setBeltVisible` and the achieve FX do.
 */
const partsOf = (wrap: Container, id: string): PlanetParts => {
  const cached = (wrap as PlanetWrap).planetParts;
  if (cached && !(cached.albedo?.destroyed ?? false)) {
    return cached;
  }
  const parts = findParts(wrap, id);
  (wrap as PlanetWrap).planetParts = parts;
  return parts;
};

export const paintBeltLook = (
  wrap: Container,
  config: PlanetConfig,
  light: number,
  flatten: number,
): void => {
  if (!config.belt || config.beltVisible === false) {
    return;
  }
  const belt = wrap.getChildByLabel("belt");
  if (!(belt instanceof Graphics)) {
    return;
  }
  paintBelt(belt, config.belt, flatten, Math.min(1, light));
};

export const paintPlanetLook = (
  wrap: Container,
  config: PlanetConfig,
  shine: boolean,
  fillColor?: ColorHex,
  light = shine ? 1 : 0,
): void => {
  const color = fillColor ?? config.color;
  const { albedo, glow, atmo, shade, form } = partsOf(wrap, config.id);
  if (albedo) {
    albedo.tint = fillColor ?? 0xffffff;
  }
  if (glow) {
    paintPlanetGlow(glow, config.radius, light, color);
  }
  if (form) {
    paintPlanetForm(form, config.radius);
  }
  if (atmo) {
    paintPlanetAtmosphere(atmo, config.radius, light, color);
  }
  if (shade) {
    posePlanetShade(shade, config.radius, light);
  }
};

export const tickPlanetSpin = (
  wrap: Container,
  config: PlanetConfig,
  deltaMS: number,
  speedScale: number,
  spinSpeed: number,
): void => {
  const dt = (deltaMS / 1000) * speedScale;
  if (dt <= 0) {
    return;
  }
  const profile = surfaceMotionProfile(resolvePlanetSurfaceKind(config));
  const { spin, clouds } = partsOf(wrap, config.id);
  if (spin) {
    spin.rotation += spinSpeed * profile.spinMul * dt;
  }
  if (clouds) {
    clouds.rotation += spinSpeed * profile.cloudSpinMul * dt;
  }
};

export const tickPlanetSurface = (
  wrap: Container,
  config: PlanetConfig,
  elapsedMs: number,
): void => {
  const kind = resolvePlanetSurfaceKind(config);
  const profile = surfaceMotionProfile(kind);

  // **Nothing to do for four of the six surfaces.** Only `lava` and `storm`
  // are emissive, only `ice` breathes its cloud layer and only `gas` wobbles,
  // so a terra, arid or ice planet was resolving three children a frame to
  // then use at most one of them. Cheapest possible fix: ask first.
  if (!profile.emissive && kind !== "ice" && kind !== "gas") {
    return;
  }

  const { emissive, clouds, albedo } = partsOf(wrap, config.id);
  if (emissive && profile.emissive) {
    paintPlanetEmissive(emissive, kind, config.radius, config.color, elapsedMs);
  }

  if (clouds && kind === "ice") {
    clouds.alpha = 0.68 + 0.18 * Math.sin(elapsedMs / 640);
  }

  if (albedo && kind === "gas") {
    const base = config.radius * 2;
    const wobble = 1 + 0.04 * Math.sin(elapsedMs / 520);
    albedo.width = base;
    albedo.height = base * wobble;
  }
};

export const createPlanet = (
  config: PlanetConfig,
  flatten: number,
  shadeTexture: Texture,
): Container => {
  const wrap = new Container({ label: `planet-${config.id}` });
  wrap.eventMode = "passive";

  const random = mulberry32(config.visualSeed ?? hashString(config.id));
  const kind = resolvePlanetSurfaceKind(config);
  const profile = surfaceMotionProfile(kind);
  const maps = createPlanetTextures({
    kind,
    color: config.color,
    random,
  });

  const glow = new Graphics({ label: `planet-glow-${config.id}` });
  glow.eventMode = "none";
  glow.blendMode = "add";

  const surface = new Container({ label: `planet-surface-${config.id}` });
  surface.eventMode = "passive";

  const spin = new Container({ label: "planet-spin" });
  spin.eventMode = "none";

  const albedo = new Sprite({
    texture: maps.albedo,
    label: `planet-albedo-${config.id}`,
    anchor: 0.5,
  });
  albedo.width = config.radius * 2;
  albedo.height = config.radius * 2;
  albedo.eventMode = "none";
  spin.addChild(albedo);

  if (maps.clouds) {
    const clouds = new Sprite({
      texture: maps.clouds,
      label: "planet-clouds",
      anchor: 0.5,
    });
    clouds.width = config.radius * 2;
    clouds.height = config.radius * 2;
    clouds.alpha = 0.82;
    clouds.blendMode = "screen";
    clouds.eventMode = "none";
    spin.addChild(clouds);
  }

  const form = new Graphics({ label: `planet-form-${config.id}` });
  form.eventMode = "none";
  form.blendMode = "multiply";

  const shade = new Sprite({
    texture: shadeTexture,
    label: `planet-shade-${config.id}`,
    anchor: 0.5,
    blendMode: "multiply",
  });
  shade.eventMode = "none";

  const clip = new Graphics({ label: `planet-clip-${config.id}` });
  clip.circle(0, 0, config.radius).fill(0xffffff);
  clip.eventMode = "none";

  surface.addChild(spin, form, shade);
  surface.mask = clip;

  if (profile.emissive) {
    const emissive = new Graphics({ label: `planet-emissive-${config.id}` });
    emissive.eventMode = "none";
    emissive.blendMode = "add";
    spin.addChild(emissive);
    paintPlanetEmissive(emissive, kind, config.radius, config.color, 0);
  }

  const atmo = new Graphics({ label: `planet-atmo-${config.id}` });
  atmo.eventMode = "none";
  atmo.blendMode = "add";

  const body = new Graphics({ label: `planet-body-${config.id}` });
  body.circle(0, 0, config.radius).fill({ color: 0xffffff, alpha: 0.001 });
  body.eventMode = "static";
  body.cursor = "pointer";

  wrap.addChild(glow, surface, clip, atmo, body);
  paintPlanetLook(wrap, config, config.shine);

  wrap.on("destroyed", () => {
    maps.albedo.destroy(true);
    maps.clouds?.destroy(true);
  });

  if (config.belt) {
    const belt = createBelt(
      config.belt,
      flatten,
      config.shine && config.beltVisible !== false ? 1 : 0,
    );
    belt.visible = config.beltVisible !== false;
    wrap.addChild(belt);
  }
  return wrap;
};

const posePlanetShade = (
  shade: Sprite,
  radius: number,
  light: number,
): void => {
  shade.width = radius * 2;
  shade.height = radius * 2;
  shade.alpha = 0.92 - light * 0.32;
  shade.x = light * radius * 0.12;
  shade.y = light * radius * 0.16;
};

const paintPlanetGlow = (
  glow: Graphics,
  radius: number,
  light: number,
  color: ColorHex,
): void => {
  glow.clear();
  if (light <= 0.02) {
    return;
  }
  glow.circle(0, 0, radius * (1.4 + light * 0.7)).fill({
    color,
    alpha: 0.02 + light * 0.07,
  });
  glow.circle(0, 0, radius * (1.18 + light * 0.22)).fill({
    color: towardWhite(color, 0.45),
    alpha: 0.03 + light * 0.09,
  });
};

const paintPlanetForm = (
  form: Graphics,
  radius: number,
): void => {
  form.clear();
  const gradient = new FillGradient({
    type: "radial",
    center: { x: -radius * 0.32, y: -radius * 0.4 },
    innerRadius: 0,
    outerCenter: { x: radius * 0.14, y: radius * 0.2 },
    outerRadius: radius * 1.12,
    colorStops: [
      { offset: 0, color: 0xffffff },
      { offset: 0.42, color: 0xd0d4dc },
      { offset: 1, color: 0x14161c },
    ],
  });
  form.circle(0, 0, radius).fill(gradient);
};

const paintPlanetAtmosphere = (
  atmo: Graphics,
  radius: number,
  light: number,
  color: ColorHex,
): void => {
  atmo.clear();
  atmo.circle(0, 0, radius * 1.1).stroke({
    width: Math.max(1.4, radius * 0.14),
    color: towardWhite(color, 0.5),
    alpha: 0.05 + light * 0.28,
    alignment: 0,
  });
};
