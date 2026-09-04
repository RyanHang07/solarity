# Portable galaxy module map

**Agents integrating Solarity:** read [`docs/GALAXY_AGENT.md`](../../docs/GALAXY_AGENT.md) first.  
**Agents modifying rendering:** use this file to locate code; still import only from `index.ts` in product code.

## Dependency rule

```
index.ts  →  mount.ts, buildSnapshot.ts, types, helpers
mount.ts  →  scene/Galaxy.ts (internal)
buildSnapshot.ts  →  systems/*, stars.ts, planetCosmetics.ts (no scene)
scene/*   →  systems/*, render/* (never mount.ts or adapters)
```

No file in this folder may import `src/playground`, `src/adapters`, React, or Next.

---

## Root files

| File | Responsibility |
|------|----------------|
| `index.ts` | Public exports (tiers 1–3) |
| `mount.ts` | `mountGalaxy`, pointer/wheel input, ticker, handle factory |
| `buildSnapshot.ts` | `buildGalaxySnapshot` — goals/achievements/cosmetics → snapshot |
| `types.ts` | `GalaxySnapshot`, `GalaxyHandle`, `MountOptions`, configs |
| `constants.ts` | Layout thresholds, FX durations, milestone step (5) |
| `categories.ts` | Goal category slugs + colours |
| `palettes.ts` | Sun colour presets |
| `onboarding.ts` | First-run snapshot helpers |
| `planetCosmetics.ts` | Belt roll, surface resolution, radius clamps |
| `stars.ts` | Achievement star placement algorithm |
| `cameraControls.ts` | DOM overlay buttons → handle pan/zoom |
| `galaxy-camera.css` | Toolbar styles (portable asset) |
| `rng.ts` | Seeded random helpers |
| `color.ts` | Colour utilities |

---

## scene/ (display graph — internal)

| File | Responsibility |
|------|----------------|
| `Galaxy.ts` | Scene orchestrator: diff, FX, tick, layout |
| `SkyAmbience.ts` | Tiered shooting stars / asteroids (not Starfield) |
| `Starfield.ts` | Achievement stars rendering |
| `Sun.ts` | Sun corona + surface tick |
| `Planet.ts` | Planet mesh, belt, spin, surface motion |
| `Ring.ts` | Saturn-style belt geometry |
| `Nebula.ts` | Background nebula sprite |
| `OrbitPaths.ts` | Orbit ellipse graphics |
| `planetSurfaceMotion.ts` | Achieve celebration ring + emissive surfaces |

---

## systems/ (logic — internal)

| File | Responsibility |
|------|----------------|
| `diffSnapshot.ts` | Compare snapshots; drive incremental updates |
| `planSnapshotFx.ts` | Schedule FX from diff |
| `fxQueue.ts` | Timed animation queue |
| `OrbitSystem.ts` | Orbit bodies, pose, tick |
| `orbitLayout.ts` | Orbit radius ladder by planet count |
| `orbitRefitCoordinator.ts` | Smooth orbit radius transitions |
| `nebulaClusters.ts` | Nebula colour weights from categories |
| `starMilestones.ts` | `achievementTier` from count |
| `skyAmbienceProfile.ts` | Tier 0–3 sky params + labels |
| `shineEnvelope.ts` | Check-in shine easing |
| `orbitSpeedScale.ts` | Warm-up orbit speed |

---

## render/ (assets — internal)

| File | Responsibility |
|------|----------------|
| `planetTexture.ts` | Procedural planet textures by `SurfaceKind` |
| `starTexture.ts` | Star sprite texture |
| `sunTexture.ts` | Sun glow / rays |
| `nebulaTexture.ts` | Nebula bitmap |
| `sphereShade.ts` | Shared sphere shading |

---

## Tests

Colocated `*.test.ts` files validate mapping and diff behaviour. Run `npm test` — do not import test files from product code.

---

## Safe extension points

| Change | Edit |
|--------|------|
| New planet cosmetic field | `types.ts` → `planetCosmetics.ts` → `buildSnapshot.ts` → `diffSnapshot.ts` |
| New snapshot flag | `types.ts` → `buildSnapshot.ts` → `Galaxy.setSnapshot` consumer |
| Sky tier tuning | `systems/skyAmbienceProfile.ts` only |
| New category | `categories.ts` |
| Solarity DB shape | `src/adapters/next/solarity/buildGalaxySnapshotForUser.ts` only |
