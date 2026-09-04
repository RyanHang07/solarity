import type { Container } from "pixi.js";
import { MAX_TILT, MIN_TILT, ORBIT_SPIN_UP_MS } from "../constants";
import { hashRange, hashString } from "../rng";
import type { PlanetConfig, ViewRotation } from "../types";

export type OrbitBody = {
  id: string;
  container: Container;
  orbitRadius: number;
  displayOrbitRadius?: number;
  orbitSpeed: number;
  spinSpeed: number;
  angle: number;
  baseRadius: number;
  appearScale: number;
};

export const effectiveOrbitRadius = (body: OrbitBody): number =>
  body.displayOrbitRadius ?? body.orbitRadius;

export const flattenFromTilt = (tilt: number): number =>
  Math.max(0.08, Math.sin(tilt));

export const clampTilt = (tilt: number): number =>
  Math.min(MAX_TILT, Math.max(MIN_TILT, tilt));

export const orbitSpeedScale = (
  elapsedMs: number,
  durationMs = ORBIT_SPIN_UP_MS,
): number => {
  if (elapsedMs <= 0) {
    return 0;
  }
  if (elapsedMs >= durationMs) {
    return 1;
  }
  const t = elapsedMs / durationMs;
  return 1 - (1 - t) ** 3;
};

export const createOrbitBody = (
  container: Container,
  config: PlanetConfig,
): OrbitBody => ({
  id: config.id,
  container,
  orbitRadius: config.orbitRadius,
  displayOrbitRadius: config.orbitRadius,
  orbitSpeed: config.orbitSpeed,
  spinSpeed: 0.18 + hashRange(hashString(config.id), 280) / 500,
  angle: config.phase,
  baseRadius: config.radius,
  appearScale: 1,
});

export const projectOrbit = (
  angle: number,
  radius: number,
  view: ViewRotation,
): { x: number; y: number; depth: number } => {
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const cosYaw = Math.cos(view.yaw);
  const sinYaw = Math.sin(view.yaw);
  const xr = x * cosYaw - z * sinYaw;
  const zr = x * sinYaw + z * cosYaw;
  return {
    x: xr,
    y: zr * Math.sin(view.tilt),
    depth: zr * Math.cos(view.tilt),
  };
};

export const lerpOrbitRadii = (
  bodies: OrbitBody[],
  fromById: ReadonlyMap<string, number>,
  t: number,
  toById?: ReadonlyMap<string, number>,
): void => {
  for (const body of bodies) {
    const from = fromById.get(body.id);
    if (from === undefined) {
      continue;
    }
    const to = toById?.get(body.id) ?? body.orbitRadius;
    body.displayOrbitRadius = from + (to - from) * t;
  }
};

export const snapOrbitRadii = (
  bodies: OrbitBody[],
  toById?: ReadonlyMap<string, number>,
): void => {
  for (const body of bodies) {
    const to = toById?.get(body.id);
    if (to !== undefined) {
      body.orbitRadius = to;
    }
    body.displayOrbitRadius = body.orbitRadius;
  }
};

/**
 * **The hot loop.** One sun's ten planets made this shape irrelevant; a Circle
 * of ten members is up to a hundred bodies, sixty times a second.
 *
 * `projectOrbit` is kept — it is the readable definition and the tests are
 * written against it — but it is not what runs here. Two things made it
 * unsuitable for the inner loop, and both are invisible at ten bodies:
 *
 * - **It recomputes `view`'s four trig values per body**, when `yaw` and
 *   `tilt` are fixed for the whole pass. Four hundred `Math.sin`/`Math.cos`
 *   calls a frame where four would do.
 * - **It returns a fresh object per body**, so a full Circle allocates six
 *   thousand short-lived objects a second. On iOS that is not the arithmetic
 *   cost, it is the collector waking up mid-animation.
 *
 * Inlined below with the trig hoisted and nothing allocated.
 */
export const poseOrbits = (bodies: OrbitBody[], view: ViewRotation): void => {
  const cosYaw = Math.cos(view.yaw);
  const sinYaw = Math.sin(view.yaw);
  const sinTilt = Math.sin(view.tilt);
  const cosTilt = Math.cos(view.tilt);

  for (const body of bodies) {
    const radius = effectiveOrbitRadius(body);
    const x = Math.cos(body.angle) * radius;
    const z = Math.sin(body.angle) * radius;
    const xr = x * cosYaw - z * sinYaw;
    const zr = x * sinYaw + z * cosYaw;
    const depth = zr * cosTilt;

    body.container.position.set(xr, zr * sinTilt);
    const depthScale = Math.max(0.62, Math.min(1.38, 1 + depth / 420));
    body.container.scale.set(depthScale * body.appearScale);
    body.container.zIndex = depth;
  }
};

export const tickOrbits = (
  bodies: OrbitBody[],
  deltaMS: number,
  view: ViewRotation,
  speedScale = 1,
): void => {
  const dt = (deltaMS / 1000) * speedScale;
  for (const body of bodies) {
    body.angle += body.orbitSpeed * dt;
  }
  poseOrbits(bodies, view);
};
