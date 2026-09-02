# Part 3: the galaxy — what the handoff actually ships

**Read on 1 September**: `docs/GALAXY_AGENT.md`, `src/adapters/next/SOLARITY_INTEGRATION.md`, `src/adapters/next/README.md`, `src/galaxy/MODULE.md`, the full public API surface, `buildGalaxySnapshotForUser.ts`, `GalaxyView.tsx`, `sql/001_galaxy_cosmetics.sql`, and the import graph of the portable layer.

---

## The verdict first

**It is genuinely portable, and better organised than most code written to be copied.** The claim that it drops in easily is close to true, and four specific things stop it being true. None is expensive; all four are cheaper now than after the module is inside Solarity.

**The best thing about it is not the renderer.** It is that migration 4, written on 10 August, seeded `goal_categories` with a `color_hex` column whose comment says:

> Unused by v1 UI. Populated now so the deferred galaxy visualization can consume it later without a data migration.

**All nine slugs and all nine hex values match `src/galaxy/categories.ts` exactly.** A decision made three weeks before the renderer existed still holds, and the palette needs no migration and no mapping table.

---

## What is true

| Claim | Verified |
|---|---|
| Portable layer has no React, Next, or database imports | **True.** `src/galaxy` imports `pixi.js` and nothing else external |
| Single public export surface | **True.** `index.ts`, in three documented tiers, and the `Galaxy` class is not exported |
| ~6,050 lines portable, ~1,155 lines of tests, 74 tests | Counted |
| `prefers-reduced-motion` is honoured | **True, and it is not a token gesture** — thirteen call sites inside the scene, including orbit spin-up, refit animation and the achieve burst |
| Category colours match Solarity's seed | **True**, all nine |
| Solarity caps active goals at 10 (`GOAL_LIMIT`) | So the planet count is bounded at ten. `DEFAULT_STAR_CAP` is 2000 with 1–3 stars per achievement, which is not a limit anyone reaches |
| **The CSP needs no change** | Checked directive by directive. `pixi.js` is bundled, so `script-src: 'self'` covers it; textures are canvas-generated, and `img-src` already allows `data:` and `blob:`; `worker-src` already allows `blob:` — widened in step 13 for the photo compressor, and it happens to cover Pixi too. **Nothing to widen, which is worth knowing before someone widens it just in case** |

---

## The four things to fix before copying

### 1. The pure half of the module drags PixiJS in, through one string array

**This is the significant one**, and it is invisible from every file you would think to read.

```
buildSnapshot.ts → planetCosmetics.ts → render/planetTexture.ts → pixi.js
```

`planetCosmetics.ts` imports `SURFACE_KINDS` from `render/planetTexture.ts`. `SURFACE_KINDS` is an array of six strings. `planetTexture.ts` imports `pixi.js`.

So **`buildGalaxySnapshot` — the server-side data mapper — transitively imports the entire renderer.** And `index.ts` re-exports `mountGalaxy` unconditionally, so *any* import from `@/lib/galaxy` pulls PixiJS in, including a server component that only wanted `categoryBySlug`.

**Why it matters here specifically.** The handoff's own sequence has the server build the snapshot and a `dynamic(ssr: false)` client component render it. That arrangement is designed to keep a WebGL library out of the initial payload, and this import defeats it: the "server-only" mapper is in the client graph the moment anything shared touches it.

**This codebase has met this exact shape before.** `patterns.md`, "a boundary only the bundler enforces": `today-roster.tsx` imported a *value* from a module that later gained `server-only`, and the build failed naming a file nobody had touched. `tsc` and ESLint both pass here, before and after. **`npm run build` is the only thing that can see it.**

**The fix is two lines.** Move `SURFACE_KINDS` into `constants.ts` (already pixi-free, already imported by `buildSnapshot.ts`), and split the entry point:

| Entry | Exports | Safe from |
|---|---|---|
| `lib/galaxy/data.ts` | `buildGalaxySnapshot`, types, `categoryBySlug`, `GOAL_CATEGORIES`, cosmetics resolvers, `achievementTier` | A server component |
| `lib/galaxy/index.ts` | `mountGalaxy` and the above | Client only, behind `dynamic(ssr: false)` |

### 2. The adapter files have never been typechecked

`src/adapters/next/README.md` says it plainly:

> Not compiled in this repo (`tsconfig.json` excludes `src/adapters`).

**The only files intended to be copied into Solarity are the only files with no compiler over them.** That is `GalaxyView.tsx`, `GalaxyCosmeticsEditor.tsx`, `buildGalaxySnapshotForUser.ts`, and two example pages. Expect real errors on first `npm run typecheck` after the copy, and treat them as ordinary rather than as a sign the port went wrong.

### 3. `dynamic(ssr: false)` cannot live in a Server Component

The handoff's step 2 shows the dynamic import next to a server loader. **Next 16 App Router forbids `ssr: false` in a Server Component**, and the failure is a build error rather than a bad render. The wrapper has to be a small `"use client"` component that takes the snapshot as a prop; the server page imports *that*.

### 4. A snapshot update during mount is dropped

`GalaxyView.tsx` mounts in an async effect and sets `handleRef.current` when it resolves. The second effect calls `handleRef.current?.setSnapshot(snapshot)` — so a snapshot that changes while `mountGalaxy` is still awaiting is silently lost, and the galaxy shows the state it started with.

Unlikely on a slow-changing screen and **exactly the kind of thing that happens on a check-in**, which is the one interaction that changes the snapshot immediately after a navigation. Hold the latest snapshot in a ref and apply it once the handle exists.

---

## Two smaller things, named rather than fixed

**No WebGL context-loss handling.** There is no `webglcontextlost` listener anywhere in the module. On an installed iOS PWA, a backgrounded tab under memory pressure loses its context and the canvas goes blank permanently until remount. This is a real mobile-PWA condition rather than a theoretical one, and Solarity's whole push story assumes people install it. Worth a listener that remounts, or at minimum a documented known-issue.

**The background is a hardcoded near-black** (`DEFAULT_BACKGROUND = 0x07070e`), and it is a `MountOptions` field so it is overridable. Solarity has real light and dark modes. **A black rectangle in an otherwise light app is a design decision, not a default to inherit** — decide it in part 1 alongside the category-colour question, and pass `background` from a token either way.

---

## What does not need doing

- **No colour mapping layer.** The palettes already agree.
- **No CSP change.** Verified above.
- **No new bundler config.** Pixi is a plain ESM dependency.
- **Do not reimplement planet or star layout in Solarity.** `buildGalaxySnapshot` is the supported path and the playground uses the same function, which is what keeps the two honest.
- **Do not deep-import `scene/`, `systems/` or `render/`.** The one exception is the `SURFACE_KINDS` move in fix 1, which removes a deep import rather than adding one.
