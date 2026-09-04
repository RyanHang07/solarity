import {
  Particle,
  ParticleContainer,
  Rectangle,
  Texture,
} from "pixi.js";
import type { StarConfig } from "../types";

type TwinkleStar = {
  particle: Particle;
  seed: number;
  twinkle: number;
  baseAlpha: number;
  targetX: number;
  targetY: number;
};

export class Starfield {
  readonly container: ParticleContainer;
  private spin = 0;
  private readonly texture: Texture;
  private readonly stars: TwinkleStar[] = [];
  private configs: StarConfig[];
  private width: number;
  private height: number;
  private starScale = 1;

  constructor(opts: {
    texture: Texture;
    stars: StarConfig[];
    width: number;
    height: number;
    starScale?: number;
  }) {
    this.texture = opts.texture;
    this.configs = opts.stars;
    this.width = opts.width;
    this.height = opts.height;
    this.starScale = opts.starScale ?? 1;
    this.container = new ParticleContainer({
      texture: opts.texture,
      label: "starfield",
      boundsArea: new Rectangle(0, 0, opts.width, opts.height),
      dynamicProperties: {
        position: true,
        color: true,
        rotation: false,
      },
    });

    for (const config of opts.stars) {
      this.spawn(config, config.x * opts.width, config.y * opts.height);
    }
  }

  addStars(
    configs: StarConfig[],
    origin?: { x: number; y: number },
  ): Particle[] {
    const added: Particle[] = [];
    for (const config of configs) {
      const startX = origin?.x ?? config.x * this.width;
      const startY = origin?.y ?? config.y * this.height;
      const particle = this.spawn(config, startX, startY);
      added.push(particle);
    }
    this.configs = [...this.configs, ...configs];
    return added;
  }

  replaceStars(configs: StarConfig[]): void {
    for (const star of this.stars) {
      this.container.removeParticle(star.particle);
    }
    this.stars.length = 0;
    this.configs = configs;
    for (const config of configs) {
      this.spawn(config, config.x * this.width, config.y * this.height);
    }
  }

  layout(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.container.boundsArea = new Rectangle(0, 0, width, height);
    this.configs.forEach((config, index) => {
      const star = this.stars[index];
      if (!star) {
        return;
      }
      star.targetX = config.x * width;
      star.targetY = config.y * height;
      star.particle.x = star.targetX;
      star.particle.y = star.targetY;
    });
  }

  setStarScale(scale: number): void {
    if (scale === this.starScale) {
      return;
    }
    this.starScale = scale;
    for (let index = 0; index < this.stars.length; index += 1) {
      const star = this.stars[index];
      const config = this.configs[index];
      if (!star || !config) {
        continue;
      }
      const size = config.size * scale;
      star.particle.scaleX = size;
      star.particle.scaleY = size;
    }
  }

  /**
   * How fast the whole field turns, in radians per second.
   *
   * ## Why the container turns rather than the stars
   *
   * The look wanted here is gravitational — an accretion disc, the sky being
   * drawn around something. The literal version is differential rotation, with
   * inner stars turning faster than outer ones, and it costs **two trig calls
   * per star per frame**: at two thousand stars and 60fps that is a quarter of
   * a million `sin`/`cos` a second on a phone, for a background.
   *
   * Rotating the container is **one transform**, regardless of star count. The
   * sense of shear comes for free from the layer in front of it — the nebula
   * turns at its own rate, so the two slide against each other and read as
   * differential motion without anything being computed per star.
   *
   * The pivot is the middle of the canvas, because that is where the cluster
   * sits and what the sky should appear to turn around.
   */
  setSpin(radiansPerSecond: number): void {
    this.spin = radiansPerSecond;
  }

  tick(elapsedMs: number, animateTwinkle: boolean, twinkleBoost = 0): void {
    if (!animateTwinkle) {
      return;
    }

    if (this.spin !== 0) {
      this.container.pivot.set(this.width / 2, this.height / 2);
      this.container.position.set(this.width / 2, this.height / 2);
      this.container.rotation = (elapsedMs / 1000) * this.spin;
    }

    for (const star of this.stars) {
      const wave = Math.sin(elapsedMs / 700 + star.seed);
      star.particle.alpha =
        star.baseAlpha + (star.twinkle + twinkleBoost) * 0.35 * wave;
    }
  }

  private spawn(config: StarConfig, x: number, y: number): Particle {
    const size = config.size * this.starScale;
    const particle = new Particle({
      texture: this.texture,
      x,
      y,
      scaleX: size,
      scaleY: size,
      anchorX: 0.5,
      anchorY: 0.5,
      tint: config.color,
      alpha: 0.72 + config.twinkle * 0.18,
    });
    this.container.addParticle(particle);
    this.stars.push({
      particle,
      seed: config.seed,
      twinkle: config.twinkle,
      baseAlpha: 0.72 + config.twinkle * 0.18,
      targetX: config.x * this.width,
      targetY: config.y * this.height,
    });
    return particle;
  }
}
