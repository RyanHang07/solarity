import { Container, Graphics } from "pixi.js";
import { mulberry32 } from "../rng";
import type {
  AchieveBurstParams,
  AsteroidDriftParams,
  AsteroidFieldParams,
  ShootingStarParams,
  SkyAmbienceProfile,
} from "../systems/skyAmbienceProfile";
import { skyAmbienceProfileForTier } from "../systems/skyAmbienceProfile";

type Streak = {
  graphic: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ay: number;
  life: number;
  maxLife: number;
  trail: number;
  seenOnScreen: boolean;
};

type DriftRock = {
  graphic: Graphics;
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  spinSpeed: number;
  size: number;
};

type FieldPebble = {
  graphic: Graphics;
  x: number;
  y: number;
  size: number;
  alpha: number;
  twinklePhase: number;
  vx: number;
  vy: number;
};

const STREAK_OFFSCREEN_PAD = 28;
const STREAK_MAX_SAFETY_MS = 14_000;

const clusterOffset = (
  random: () => number,
  spreadX: number,
  spreadY: number,
): { dx: number; dy: number } => {
  const angle = random() * Math.PI * 2;
  const radius = random() ** 1.6;
  return {
    dx: Math.cos(angle) * radius * spreadX,
    dy: Math.sin(angle) * radius * spreadY,
  };
};

const paintStreak = (streak: Streak): void => {
  const t = streak.life / streak.maxLife;
  const fadeIn = Math.min(1, t * 5);
  const fadeOut = t > 0.82 ? Math.min(1, (1 - t) / 0.18 * 3.5) : 1;
  const alpha = fadeIn * fadeOut * 0.72;
  if (alpha <= 0.01) {
    streak.graphic.clear();
    return;
  }

  const tailX = streak.x - streak.vx * streak.trail * 0.22;
  const tailY = streak.y - streak.vy * streak.trail * 0.22;
  streak.graphic.clear();
  streak.graphic
    .moveTo(streak.x, streak.y)
    .lineTo(tailX, tailY)
    .stroke({ width: 0.45 + streak.trail * 0.006, color: 0xffffff, alpha });
  streak.graphic
    .circle(streak.x, streak.y, 0.35 + streak.trail * 0.008)
    .fill({ color: 0xffffff, alpha: alpha * 0.85 });
};

const paintDriftRock = (rock: DriftRock, elapsedMs: number): void => {
  rock.graphic.clear();
  rock.graphic.rotation = rock.spin + elapsedMs * rock.spinSpeed * 0.0006;
  rock.graphic
    .roundRect(-rock.size, -rock.size * 0.55, rock.size * 1.8, rock.size, 0.6)
    .fill({ color: 0x8a7f72, alpha: 0.5 });
  rock.graphic
    .roundRect(-rock.size * 0.35, -rock.size * 0.18, rock.size * 0.45, rock.size * 0.28, 0.4)
    .fill({ color: 0xb8aea3, alpha: 0.28 });
};

const paintFieldPebble = (pebble: FieldPebble, elapsedMs: number): void => {
  const twinkle = 0.5 + Math.sin(elapsedMs * 0.0008 + pebble.twinklePhase) * 0.12;
  pebble.graphic.clear();
  pebble.graphic
    .circle(0, 0, pebble.size)
    .fill({ color: 0x9a9088, alpha: pebble.alpha * twinkle });
};

class ShootingStarLayer {
  readonly container = new Container({ label: "shooting-stars" });

  private width = 1;
  private height = 1;
  private params: ShootingStarParams = {
    maxActive: 3,
    minSpawnMs: 2800,
    maxSpawnMs: 7200,
  };
  private spawnTimer = 0;
  private nextSpawnMs = 2800;
  private readonly streaks: Streak[] = [];
  private readonly random: () => number;

  constructor(seed: number) {
    this.container.eventMode = "none";
    this.random = mulberry32(seed);
    this.scheduleNextSpawn();
  }

  setParams(params: ShootingStarParams): void {
    this.params = params;
    while (this.streaks.length > params.maxActive) {
      this.removeStreak(this.streaks.length - 1);
    }
  }

  layout(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  tick(deltaMs: number, animate: boolean): void {
    if (animate) {
      this.spawnTimer += deltaMs;
      if (
        this.spawnTimer >= this.nextSpawnMs &&
        this.streaks.length < this.params.maxActive
      ) {
        this.spawnStreak();
        this.spawnTimer = 0;
        this.scheduleNextSpawn();
      }
    }

    for (let index = this.streaks.length - 1; index >= 0; index -= 1) {
      const streak = this.streaks[index];
      if (!streak) {
        continue;
      }
      if (animate) {
        streak.life += deltaMs;
        streak.vy += streak.ay * (deltaMs / 16);
        streak.x += streak.vx * (deltaMs / 16);
        streak.y += streak.vy * (deltaMs / 16);
        if (!streak.seenOnScreen && this.isStreakOnScreen(streak)) {
          streak.seenOnScreen = true;
        }
      }
      paintStreak(streak);
      if (
        streak.life >= streak.maxLife ||
        (streak.seenOnScreen && this.isStreakOffScreen(streak)) ||
        streak.life > STREAK_MAX_SAFETY_MS
      ) {
        this.removeStreak(index);
      }
    }
  }

  spawnBurst(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const horizontal = this.random() < 0.5 ? -1 : 1;
      const speed = 1.6 + this.random() * 1.8;
      const vx = horizontal * speed * (0.75 + this.random() * 0.2);
      const vy = (this.random() - 0.5) * speed * 0.22;
      const ay = horizontal * 0.012;
      const graphic = new Graphics({ label: "celebration-streak" });
      graphic.eventMode = "none";
      graphic.blendMode = "add";
      this.container.addChild(graphic);
      this.streaks.push({
        graphic,
        x,
        y,
        vx,
        vy,
        ay,
        life: 0,
        maxLife: this.estimateTravelMs(x, y, vx, vy, ay),
        trail: 10 + this.random() * 12,
        seenOnScreen: false,
      });
    }
  }

  clear(): void {
    for (let index = this.streaks.length - 1; index >= 0; index -= 1) {
      this.removeStreak(index);
    }
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }

  private scheduleNextSpawn(): void {
    const span = this.params.maxSpawnMs - this.params.minSpawnMs;
    this.nextSpawnMs = this.params.minSpawnMs + this.random() * span;
  }

  private spawnStreak(): void {
    const spawn = this.pickStreakSpawn();
    const graphic = new Graphics({ label: "shooting-star" });
    graphic.eventMode = "none";
    graphic.blendMode = "add";
    this.container.addChild(graphic);

    this.streaks.push({
      graphic,
      x: spawn.x,
      y: spawn.y,
      vx: spawn.vx,
      vy: spawn.vy,
      ay: spawn.ay,
      life: 0,
      maxLife: this.estimateTravelMs(
        spawn.x,
        spawn.y,
        spawn.vx,
        spawn.vy,
        spawn.ay,
      ),
      trail: 12 + this.random() * 16,
      seenOnScreen: false,
    });
  }

  /** Bias spawn lanes toward thirds so paths do not all cross center. */
  private pickLane(alongWidth: boolean): number {
    const span = alongWidth ? this.width : this.height;
    const roll = this.random();
    if (roll < 0.22) {
      return span * (0.04 + this.random() * 0.18);
    }
    if (roll < 0.44) {
      return span * (0.36 + this.random() * 0.22);
    }
    if (roll < 0.66) {
      return span * (0.68 + this.random() * 0.2);
    }
    return this.random() * span;
  }

  private pickStreakSpawn(): {
    x: number;
    y: number;
    vx: number;
    vy: number;
    ay: number;
  } {
    const span = Math.max(this.width, this.height);
    const margin = 18 + this.random() * span * 0.14;
    const speed = 1.5 + this.random() * 2.1;
    const horizontalWeight = 0.84 + this.random() * 0.12;
    const mode = Math.floor(this.random() * 10);

    if (mode === 0) {
      return {
        x: this.pickLane(true),
        y: -margin,
        vx: (this.random() < 0.5 ? -1 : 1) * speed * horizontalWeight,
        vy: speed * (0.03 + this.random() * 0.09),
        ay: 0.006 + this.random() * 0.006,
      };
    }
    if (mode === 1) {
      return {
        x: this.pickLane(true),
        y: this.height + margin,
        vx: (this.random() < 0.5 ? -1 : 1) * speed * horizontalWeight,
        vy: -speed * (0.03 + this.random() * 0.09),
        ay: -(0.005 + this.random() * 0.005),
      };
    }
    if (mode === 2) {
      return {
        x: -margin,
        y: this.pickLane(false),
        vx: speed * horizontalWeight,
        vy: (this.random() - 0.5) * speed * 0.16,
        ay: (this.random() - 0.5) * 0.004,
      };
    }
    if (mode === 3) {
      return {
        x: this.width + margin,
        y: this.pickLane(false),
        vx: -speed * horizontalWeight,
        vy: (this.random() - 0.5) * speed * 0.16,
        ay: (this.random() - 0.5) * 0.004,
      };
    }
    if (mode === 4) {
      const depth = margin + this.random() * span * 0.08;
      return {
        x: -depth,
        y: -depth * (0.35 + this.random() * 0.45),
        vx: speed * (0.72 + this.random() * 0.22),
        vy: speed * (0.12 + this.random() * 0.22),
        ay: 0.005 + this.random() * 0.005,
      };
    }
    if (mode === 5) {
      const depth = margin + this.random() * span * 0.08;
      return {
        x: this.width + depth,
        y: -depth * (0.35 + this.random() * 0.45),
        vx: -speed * (0.72 + this.random() * 0.22),
        vy: speed * (0.12 + this.random() * 0.22),
        ay: 0.005 + this.random() * 0.005,
      };
    }
    if (mode === 6) {
      const depth = margin + this.random() * span * 0.08;
      return {
        x: -depth,
        y: this.height + depth * (0.25 + this.random() * 0.35),
        vx: speed * (0.7 + this.random() * 0.24),
        vy: -speed * (0.1 + this.random() * 0.18),
        ay: -(0.004 + this.random() * 0.004),
      };
    }
    if (mode === 7) {
      const depth = margin + this.random() * span * 0.08;
      return {
        x: this.width + depth,
        y: this.height + depth * (0.25 + this.random() * 0.35),
        vx: -speed * (0.7 + this.random() * 0.24),
        vy: -speed * (0.1 + this.random() * 0.18),
        ay: -(0.004 + this.random() * 0.004),
      };
    }
    if (mode === 8) {
      const skimY = this.height * (0.08 + this.random() * 0.22);
      return {
        x: -margin - this.random() * span * 0.06,
        y: skimY,
        vx: speed * (0.92 + this.random() * 0.08),
        vy: (this.random() - 0.5) * speed * 0.08,
        ay: (this.random() - 0.5) * 0.003,
      };
    }

    const midY = this.height * (0.42 + this.random() * 0.28);
    const fromLeft = this.random() < 0.5;
    return {
      x: fromLeft ? -margin - this.random() * span * 0.05 : this.width + margin + this.random() * span * 0.05,
      y: midY,
      vx: (fromLeft ? 1 : -1) * speed * (0.78 + this.random() * 0.18),
      vy: (this.random() - 0.5) * speed * 0.12,
      ay: (this.random() - 0.5) * 0.004,
    };
  }

  private estimateTravelMs(
    x: number,
    y: number,
    vx: number,
    vy: number,
    ay: number,
  ): number {
    let px = x;
    let py = y;
    let pvy = vy;
    let ms = 0;
    const step = 16;
    const pad = STREAK_OFFSCREEN_PAD;

    while (ms < STREAK_MAX_SAFETY_MS) {
      ms += step;
      pvy += ay * (step / 16);
      px += vx * (step / 16);
      py += pvy * (step / 16);
      if (
        px < -pad ||
        px > this.width + pad ||
        py < -pad ||
        py > this.height + pad
      ) {
        return ms + 280 + this.random() * 180;
      }
    }

    return STREAK_MAX_SAFETY_MS;
  }

  private isStreakOnScreen(streak: Streak): boolean {
    return (
      streak.x >= 0 &&
      streak.x <= this.width &&
      streak.y >= 0 &&
      streak.y <= this.height
    );
  }

  private isStreakOffScreen(streak: Streak): boolean {
    const pad = STREAK_OFFSCREEN_PAD;
    return (
      streak.x < -pad ||
      streak.x > this.width + pad ||
      streak.y < -pad ||
      streak.y > this.height + pad
    );
  }

  private removeStreak(index: number): void {
    const streak = this.streaks[index];
    if (!streak) {
      return;
    }
    streak.graphic.destroy();
    this.streaks.splice(index, 1);
  }
}

class AsteroidDriftLayer {
  readonly container = new Container({ label: "asteroid-drift" });

  private width = 1;
  private height = 1;
  private params: AsteroidDriftParams | null = null;
  private spawnTimer = 0;
  private nextSpawnMs = 3000;
  private readonly rocks: DriftRock[] = [];
  private readonly random: () => number;
  private elapsedMs = 0;

  constructor(seed: number) {
    this.container.eventMode = "none";
    this.random = mulberry32(seed ^ 0xa57e);
  }

  setParams(params: AsteroidDriftParams | null): void {
    this.params = params;
    this.container.visible = params !== null;
    if (!params) {
      this.clear();
      return;
    }
    while (this.rocks.length > params.maxActive) {
      this.removeRock(this.rocks.length - 1);
    }
  }

  layout(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  tick(deltaMs: number, animate: boolean): void {
    this.elapsedMs += deltaMs;
    if (!this.params) {
      return;
    }

    if (animate) {
      this.spawnTimer += deltaMs;
      if (
        this.spawnTimer >= this.nextSpawnMs &&
        this.rocks.length < this.params.maxActive
      ) {
        this.spawnRockCluster();
        this.spawnTimer = 0;
        this.scheduleNextSpawn();
      }
    }

    for (let index = this.rocks.length - 1; index >= 0; index -= 1) {
      const rock = this.rocks[index];
      if (!rock) {
        continue;
      }
      if (animate) {
        rock.x += rock.vx * (deltaMs / 16);
        rock.y += rock.vy * (deltaMs / 16);
      }
      rock.graphic.position.set(rock.x, rock.y);
      paintDriftRock(rock, this.elapsedMs);
      if (
        rock.x < -40 ||
        rock.x > this.width + 40 ||
        rock.y < -40 ||
        rock.y > this.height + 40
      ) {
        this.removeRock(index);
      }
    }
  }

  spawnScatter(x: number, y: number, count: number): void {
    if (!this.params) {
      return;
    }
    const pileCount = Math.max(1, Math.round(count / 3));
    for (let pile = 0; pile < pileCount; pile += 1) {
      const { dx: pileDx, dy: pileDy } = clusterOffset(this.random, 16, 12);
      const rocksInPile = Math.ceil(count / pileCount);
      for (let i = 0; i < rocksInPile; i += 1) {
        const { dx, dy } = clusterOffset(this.random, 10, 8);
        const speed = 0.15 + this.random() * 0.35;
        const horizontal = this.random() < 0.5 ? -1 : 1;
        const size = 0.9 + this.random() * 1.6;
        const graphic = new Graphics({ label: "burst-rock" });
        graphic.eventMode = "none";
        this.container.addChild(graphic);
        this.rocks.push({
          graphic,
          x: x + pileDx + dx,
          y: y + pileDy + dy,
          vx: horizontal * speed,
          vy: (this.random() - 0.5) * speed * 0.35,
          spin: this.random() * Math.PI,
          spinSpeed: (this.random() - 0.5) * 0.8,
          size,
        });
      }
    }
  }

  clear(): void {
    for (let index = this.rocks.length - 1; index >= 0; index -= 1) {
      this.removeRock(index);
    }
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }

  private scheduleNextSpawn(): void {
    if (!this.params) {
      return;
    }
    const span = this.params.maxSpawnMs - this.params.minSpawnMs;
    this.nextSpawnMs = this.params.minSpawnMs + this.random() * span;
  }

  private spawnRockCluster(): void {
    if (!this.params) {
      return;
    }
    const fromLeft = this.random() < 0.5;
    const clusterX = fromLeft
      ? -24 - this.random() * 36
      : this.width + 24 + this.random() * 36;
    const clusterY = this.height * (0.18 + this.random() * 0.64);
    const speed =
      this.params.speedMin +
      this.random() * (this.params.speedMax - this.params.speedMin);
    const vx = (fromLeft ? 1 : -1) * speed;
    const vy = (this.random() - 0.5) * speed * 0.12;
    const rocksInCluster = 3 + Math.floor(this.random() * 4);
    const room = this.params.maxActive - this.rocks.length;
    const count = Math.min(rocksInCluster, room);

    for (let i = 0; i < count; i += 1) {
      const { dx, dy } = clusterOffset(this.random, 22, 16);
      const size = 0.9 + this.random() * 1.8;
      const graphic = new Graphics({ label: "drift-rock" });
      graphic.eventMode = "none";
      this.container.addChild(graphic);
      this.rocks.push({
        graphic,
        x: clusterX + dx,
        y: clusterY + dy,
        vx: vx + (this.random() - 0.5) * speed * 0.08,
        vy: vy + (this.random() - 0.5) * speed * 0.06,
        spin: this.random() * Math.PI,
        spinSpeed: (this.random() - 0.5) * 0.6,
        size,
      });
    }
  }

  private removeRock(index: number): void {
    const rock = this.rocks[index];
    if (!rock) {
      return;
    }
    rock.graphic.destroy();
    this.rocks.splice(index, 1);
  }
}

class AsteroidFieldLayer {
  readonly container = new Container({ label: "asteroid-field" });

  private width = 1;
  private height = 1;
  private params: AsteroidFieldParams | null = null;
  private readonly pebbles: FieldPebble[] = [];
  private readonly random: () => number;
  private elapsedMs = 0;

  constructor(seed: number) {
    this.container.eventMode = "none";
    this.random = mulberry32(seed ^ 0xf1e1d);
  }

  setParams(params: AsteroidFieldParams | null): void {
    this.params = params;
    this.container.visible = params !== null;
    this.rebuildField();
  }

  layout(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.rebuildField();
  }

  tick(deltaMs: number, animate: boolean): void {
    if (!this.params || this.pebbles.length === 0) {
      return;
    }
    if (animate) {
      this.elapsedMs += deltaMs;
      const dt = deltaMs / 16;
      for (const pebble of this.pebbles) {
        pebble.x += pebble.vx * dt;
        pebble.y += pebble.vy * dt;
        pebble.graphic.position.set(pebble.x, pebble.y);
      }
    }
    for (const pebble of this.pebbles) {
      paintFieldPebble(pebble, this.elapsedMs);
    }
  }

  destroy(): void {
    this.clear();
    this.container.destroy({ children: true });
  }

  private rebuildField(): void {
    this.clear();
    if (!this.params) {
      return;
    }
    const bandTop =
      this.height * (this.params.bandCenterY - this.params.bandHeight / 2);
    const bandHeight = this.height * this.params.bandHeight;
    const clusterCount = 5 + Math.floor(this.random() * 4);
    const pebblesPerCluster = Math.ceil(this.params.pebbleCount / clusterCount);
    let placed = 0;

    for (let cluster = 0; cluster < clusterCount && placed < this.params.pebbleCount; cluster += 1) {
      const centerX = this.width * (0.08 + this.random() * 0.84);
      const centerY = bandTop + bandHeight * (0.1 + this.random() * 0.8);
      const clusterDriftX = (this.random() - 0.5) * 0.04;
      const clusterDriftY = (this.random() - 0.5) * 0.02;
      const pileSpreadX = 28 + this.random() * 36;
      const pileSpreadY = 16 + this.random() * 22;
      const count = Math.min(
        pebblesPerCluster + Math.floor(this.random() * 3),
        this.params.pebbleCount - placed,
      );

      for (let i = 0; i < count; i += 1) {
        const { dx, dy } = clusterOffset(this.random, pileSpreadX, pileSpreadY);
        const dist = Math.hypot(dx, dy) / Math.max(pileSpreadX, pileSpreadY);
        const graphic = new Graphics({ label: "field-pebble" });
        graphic.eventMode = "none";
        this.container.addChild(graphic);
        const x = centerX + dx;
        const y = centerY + dy;
        const size = (0.45 + this.random() * 1.1) * (1 - dist * 0.35);
        const pebble: FieldPebble = {
          graphic,
          x,
          y,
          size,
          alpha: 0.18 + this.random() * 0.28,
          twinklePhase: this.random() * Math.PI * 2,
          vx: clusterDriftX + (this.random() - 0.5) * 0.008,
          vy: clusterDriftY + (this.random() - 0.5) * 0.006,
        };
        graphic.position.set(x, y);
        this.pebbles.push(pebble);
        paintFieldPebble(pebble, this.elapsedMs);
        placed += 1;
      }
    }
  }

  private clear(): void {
    for (const pebble of this.pebbles) {
      pebble.graphic.destroy();
    }
    this.pebbles.length = 0;
  }
}

export class SkyAmbience {
  readonly container: Container;

  private width = 1;
  private height = 1;
  private enabled = true;
  private tier = 0;
  private profile: SkyAmbienceProfile = skyAmbienceProfileForTier(0);
  private readonly fieldLayer: AsteroidFieldLayer;
  private readonly driftLayer: AsteroidDriftLayer;
  private readonly streakLayer: ShootingStarLayer;

  constructor(seed = 0xfa11_5eed) {
    this.container = new Container({ label: "sky-ambience" });
    this.container.eventMode = "none";
    this.fieldLayer = new AsteroidFieldLayer(seed);
    this.driftLayer = new AsteroidDriftLayer(seed);
    this.streakLayer = new ShootingStarLayer(seed);
    this.container.addChild(
      this.fieldLayer.container,
      this.driftLayer.container,
      this.streakLayer.container,
    );
    this.applyProfile();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.container.visible = enabled;
    if (!enabled) {
      this.streakLayer.clear();
      this.driftLayer.clear();
    }
  }

  setTier(tier: number): void {
    const next = Math.min(3, Math.max(0, tier));
    if (next === this.tier) {
      return;
    }
    this.tier = next;
    this.profile = skyAmbienceProfileForTier(next);
    this.applyProfile();
  }

  getTier(): number {
    return this.tier;
  }

  getAchieveBurstParams(): AchieveBurstParams {
    return this.profile.achieveBurst;
  }

  layout(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.fieldLayer.layout(width, height);
    this.driftLayer.layout(width, height);
    this.streakLayer.layout(width, height);
  }

  tick(deltaMs: number, animate: boolean): void {
    if (!this.enabled) {
      return;
    }
    this.fieldLayer.tick(deltaMs, animate);
    this.driftLayer.tick(deltaMs, animate);
    this.streakLayer.tick(deltaMs, animate);
  }

  spawnAchieveBurst(x: number, y: number, tier = this.tier): void {
    if (!this.enabled) {
      return;
    }
    const burst = skyAmbienceProfileForTier(tier).achieveBurst;
    this.streakLayer.spawnBurst(x, y, burst.streakCount);
    if (burst.rockScatter) {
      this.driftLayer.spawnScatter(x, y, Math.max(3, Math.round(burst.streakCount * 0.35)));
    }
  }

  destroy(): void {
    this.fieldLayer.destroy();
    this.driftLayer.destroy();
    this.streakLayer.destroy();
    this.container.destroy({ children: true });
  }

  private applyProfile(): void {
    this.streakLayer.setParams(this.profile.shootingStars);
    this.driftLayer.setParams(this.profile.asteroidDrift);
    this.fieldLayer.setParams(this.profile.asteroidField);
    this.fieldLayer.layout(this.width, this.height);
  }
}
