import { Container, Sprite, Texture } from "pixi.js";
import { towardWhite, sunGlowBoost, sunRadianceTint } from "../color";
import { SUN_VISUAL_SEED } from "../constants";
import { mulberry32 } from "../rng";
import {
  createSunGlowTexture,
  createSunRayTexture,
  createSunSurfaceTexture,
  createSunVeilTexture,
} from "../render/sunTexture";
import { milestoneSunPulse } from "../systems/starMilestones";
import type { SunConfig } from "../types";

type GlowLayer = {
  sprite: Sprite;
  baseAlpha: number;
  diameter: number;
};

type RayLayer = {
  sprite: Sprite;
  baseAlpha: number;
  baseWidth: number;
  phase: number;
};

const RAY_COUNT = 10;

const glowSprite = (
  texture: Texture,
  label: string,
  radius: number,
  sizeMul: number,
  alpha: number,
  tint: number,
): GlowLayer => {
  const sprite = new Sprite({ texture, label, anchor: 0.5 });
  sprite.blendMode = "add";
  sprite.eventMode = "none";
  sprite.tint = tint;
  sprite.alpha = alpha;
  const diameter = radius * 2 * sizeMul;
  sprite.width = diameter;
  sprite.height = diameter;
  return { sprite, baseAlpha: alpha, diameter };
};

const setGlowLayer = (
  layer: GlowLayer | undefined,
  scaleMul: number,
  alphaMul: number,
): void => {
  if (!layer) {
    return;
  }
  layer.sprite.width = layer.diameter * scaleMul;
  layer.sprite.height = layer.diameter * scaleMul;
  layer.sprite.alpha = layer.baseAlpha * alphaMul;
};

export const createSun = (
  config: SunConfig,
  _shadeTexture: Texture,
  achievementTier = 0,
  glowTexture = createSunGlowTexture(),
  rayTexture = createSunRayTexture(),
): Container => {
  const wrap = new Container({ label: "sun" });
  const radius = config.radius;
  const radiance = sunRadianceTint(config.color);
  const glowBoost = sunGlowBoost(config.color);
  const hot = towardWhite(radiance, 0.62);
  const pulse = milestoneSunPulse(achievementTier);
  const random = mulberry32(SUN_VISUAL_SEED);

  const radianceWrap = new Container({ label: "sun-radiance" });
  radianceWrap.eventMode = "none";
  const outer = glowSprite(
    glowTexture,
    "sun-glow-outer",
    radius,
    5.4,
    (0.26 + pulse * 0.09) * glowBoost,
    radiance,
  );
  const mid = glowSprite(
    glowTexture,
    "sun-glow-mid",
    radius,
    3.6,
    (0.32 + pulse * 0.11) * glowBoost,
    towardWhite(radiance, 0.15),
  );
  const inner = glowSprite(
    glowTexture,
    "sun-glow-inner",
    radius,
    2.35,
    (0.38 + pulse * 0.13) * glowBoost,
    hot,
  );
  radianceWrap.addChild(outer.sprite, mid.sprite, inner.sprite);
  (radianceWrap as Container & { glowLayers?: GlowLayer[] }).glowLayers = [
    outer,
    mid,
    inner,
  ];

  const radiation = new Container({ label: "sun-radiation" });
  radiation.eventMode = "none";
  const rayLayers: RayLayer[] = [];
  for (let i = 0; i < RAY_COUNT; i += 1) {
    const sprite = new Sprite({
      texture: rayTexture,
      label: `sun-ray-${i}`,
      anchor: { x: 0.02, y: 0.5 },
    });
    sprite.blendMode = "add";
    sprite.eventMode = "none";
    sprite.rotation = (i / RAY_COUNT) * Math.PI * 2 + random() * 0.35;
    sprite.width = radius * (4.8 + random() * 1.6);
    sprite.height = radius * (0.55 + random() * 0.45);
    const baseAlpha = 0.07 + random() * 0.07;
    sprite.alpha = baseAlpha;
    sprite.tint = i % 2 === 0 ? hot : towardWhite(radiance, 0.35);
    radiation.addChild(sprite);
    rayLayers.push({
      sprite,
      baseAlpha,
      baseWidth: sprite.width,
      phase: random() * Math.PI * 2,
    });
  }
  (radiation as Container & { rayLayers?: RayLayer[] }).rayLayers = rayLayers;

  const flareWrap = new Container({ label: "sun-flare" });
  flareWrap.eventMode = "none";
  const flare = glowSprite(
    glowTexture,
    "sun-flare-glow",
    radius,
    2.55,
    (0.42 + pulse * 0.15) * glowBoost,
    hot,
  );
  flareWrap.addChild(flare.sprite);
  (flareWrap as Container & { glowLayer?: GlowLayer }).glowLayer = flare;

  const coronaWrap = new Container({ label: "sun-corona" });
  coronaWrap.eventMode = "none";
  const corona = glowSprite(
    glowTexture,
    "sun-corona-glow",
    radius,
    1.65,
    (0.46 + pulse * 0.17) * glowBoost,
    towardWhite(radiance, 0.5),
  );
  coronaWrap.addChild(corona.sprite);
  (coronaWrap as Container & { glowLayer?: GlowLayer }).glowLayer = corona;

  const spin = new Container({ label: "sun-spin" });
  spin.eventMode = "none";

  /**
   * **Owned textures, tracked so they can be freed.**
   *
   * `veil` and `photosphere` are generated per sun from `random`, so unlike
   * the glow and ray maps — which are passed in and shared by every sun in the
   * scene — nothing else can be holding a reference. Pixi's
   * `destroy({ children: true })` frees display objects and deliberately not
   * their textures, so without the `destroyed` handler at the end of this
   * function both maps outlive every sun that ever existed.
   *
   * `Planet.ts` and `Nebula.ts` already did this; `Sun.ts` was the one that
   * did not, which cost nothing while there was exactly one sun and is 128×128
   * twice per member once a Circle has ten.
   *
   * **The shared maps must not be destroyed here.** They belong to `Galaxy`,
   * which frees them in its own `destroy`, and tearing one down from a sun
   * would blank every other sun in the sky.
   */
  const ownedTextures: Texture[] = [];

  const veilTexture = createSunVeilTexture(radiance, random);
  ownedTextures.push(veilTexture);
  const veil = new Sprite({
    texture: veilTexture,
    label: "sun-veil",
    anchor: 0.5,
  });
  veil.width = radius * 2.35;
  veil.height = radius * 2.35;
  veil.alpha = 0.42 + pulse * 0.14;
  veil.blendMode = "add";
  veil.eventMode = "none";
  spin.addChild(veil);

  const photosphereTexture = createSunSurfaceTexture(radiance, random);
  ownedTextures.push(photosphereTexture);
  const photosphere = new Sprite({
    texture: photosphereTexture,
    label: "sun-photosphere",
    anchor: 0.5,
  });
  photosphere.width = radius * 2.05;
  photosphere.height = radius * 2.05;
  photosphere.alpha = 0.88;
  photosphere.blendMode = "add";
  photosphere.eventMode = "none";
  spin.addChild(photosphere);

  const core = glowSprite(
    glowTexture,
    "sun-core-glow",
    radius,
    0.95,
    0.52 + pulse * 0.18,
    0xffffff,
  );
  spin.addChild(core.sprite);

  wrap.addChild(radianceWrap, radiation, flareWrap, coronaWrap, spin);
  wrap.zIndex = 0;

  // Matches `createPlanet` and `createNebula`. Fires for an explicit
  // `destroy()` and for a parent destroyed with `{ children: true }`, which is
  // how `Galaxy` tears the scene down.
  wrap.on("destroyed", () => {
    for (const texture of ownedTextures) {
      texture.destroy(true);
    }
    ownedTextures.length = 0;
  });

  return wrap;
};

export const tickSunSurface = (
  wrap: Container,
  deltaMS: number,
  speedScale = 1,
  elapsedMs = 0,
): void => {
  const dt = (deltaMS / 1000) * speedScale;
  const spin = wrap.getChildByLabel("sun-spin");
  if (spin) {
    spin.rotation += dt * 0.028;
  }
  const veil = wrap.getChildByLabel("sun-veil", true);
  if (veil) {
    veil.rotation -= dt * 0.014;
  }
  const radiance = wrap.getChildByLabel("sun-radiance");
  if (radiance) {
    const breathe = 1 + Math.sin(elapsedMs / 2200) * 0.045 * speedScale;
    radiance.scale.set(breathe);
    const layers = (radiance as Container & { glowLayers?: GlowLayer[] })
      .glowLayers;
    const shimmer =
      1 + Math.sin(elapsedMs / 3100 + 0.8) * 0.07 * speedScale;
    if (layers?.[0]) {
      layers[0].sprite.alpha = layers[0].baseAlpha * shimmer;
    }
  }
  const radiation = wrap.getChildByLabel("sun-radiation");
  if (radiation) {
    radiation.rotation += dt * 0.018;
    const rays = (radiation as Container & { rayLayers?: RayLayer[] }).rayLayers;
    if (rays) {
      for (const ray of rays) {
        const wave = 0.72 + 0.28 * Math.sin(elapsedMs / 2400 + ray.phase);
        ray.sprite.alpha = ray.baseAlpha * wave;
        ray.sprite.width =
          ray.baseWidth *
          (1 + Math.sin(elapsedMs / 3600 + ray.phase) * 0.06);
      }
    }
  }
};

export const poseSunCorona = (
  wrap: Container,
  closed: boolean,
  swell = 0,
): void => {
  poseSunCoronaAt(wrap, closed ? 1 : 0, swell);
};

export const poseSunCoronaAt = (
  wrap: Container,
  closedAmount: number,
  swell = 0,
): void => {
  const closed = Math.min(1, Math.max(0, closedAmount));
  const coronaWrap = wrap.getChildByLabel("sun-corona");
  const flareWrap = wrap.getChildByLabel("sun-flare");
  const radiation = wrap.getChildByLabel("sun-radiation");
  const halo = wrap.getChildByLabel("sun-radiance");

  setGlowLayer(
    (coronaWrap as Container & { glowLayer?: GlowLayer }).glowLayer,
    1 + closed * 0.18 + swell * 0.55,
    1 + closed * 0.35 + swell * 0.65,
  );
  setGlowLayer(
    (flareWrap as Container & { glowLayer?: GlowLayer }).glowLayer,
    1 + closed * 0.1 + swell * 1.4,
    1 + closed * 0.45 + swell * 1.05,
  );
  if (halo) {
    halo.scale.set(1 + closed * 0.12 + swell * 0.45);
    halo.alpha = 1 + closed * 0.25 + swell * 0.5;
  }
  if (radiation) {
    radiation.alpha = 1 + closed * 0.35 + swell * 0.75;
  }
};
