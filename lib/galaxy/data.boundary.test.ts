import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * **`lib/galaxy/data.ts` must not reach `pixi.js`.**
 *
 * ## Why a test walks the import graph instead of trusting the file
 *
 * The rule this protects is not visible in any file you would think to read.
 * `data.ts` imports no renderer and looks obviously safe; the leak arrives two
 * or three hops down, when some pure module gains a convenient import from
 * `render/` or `scene/`. `tsc` passes. ESLint passes. **`next build` is the
 * only other thing that can see it**, and it reports it as a failure in a file
 * nobody touched — which is exactly how this codebase met the shape the first
 * time (`patterns.md`, "a boundary only the bundler enforces": `today-roster`
 * imported a value from a module that later gained `server-only`).
 *
 * It has already happened here once. `planetCosmetics.ts` imported
 * `SURFACE_KINDS` — six strings — from `render/planetTexture.ts`, which imports
 * PixiJS. So `buildGalaxySnapshot`, the server-side data mapper, transitively
 * imported the entire renderer.
 *
 * **`import type` does not count**, because TypeScript erases it: the specifier
 * is gone before a bundler sees the file. `import { type Foo }` inside an
 * otherwise value import *does* count, because the import statement survives.
 * The stripping below is deliberately conservative in that direction — it would
 * rather flag a safe import than miss an unsafe one.
 */
const GALAXY_DIR = dirname(fileURLToPath(import.meta.url));

/** `lib/galaxy` → the repo root, so `@/…` can be followed like a relative path. */
const REPO_ROOT = resolve(GALAXY_DIR, "..", "..");

const RELATIVE = /^\.{1,2}\//;

/**
 * **`@/` is this repo, not a package.** Treating it as external would make the
 * walk stop at the alias and report a clean graph for a file whose imports it
 * never opened — the exact failure this test exists to prevent, dressed as a
 * pass.
 */
const ALIAS = /^@\//;

/** Every module specifier that survives to runtime, in source order. */
const runtimeImports = (source: string): string[] => {
  const withoutTypeOnly = source
    // `import type { A } from "x"` and `export type { A } from "x"`.
    .replace(/^\s*(?:import|export)\s+type\s[\s\S]*?from\s*["'][^"']+["'];?/gm, "")
    // Block comments, so a specifier quoted in prose is not read as an import.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  const found: string[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)\s[\s\S]*?from\s*["']([^"']+)["']/g;
  let match = pattern.exec(withoutTypeOnly);
  while (match) {
    if (match[1]) {
      found.push(match[1]);
    }
    match = pattern.exec(withoutTypeOnly);
  }
  return found;
};

const readModule = (file: string): string => {
  for (const candidate of [file, `${file}.ts`, join(file, "index.ts")]) {
    try {
      return readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
  }
  throw new Error(`cannot resolve ${file}`);
};

/** Depth-first walk from an entry, returning every file reached and the externals seen. */
const walk = (entry: string) => {
  const seen = new Set<string>();
  const externals = new Map<string, string>();
  const queue = [resolve(GALAXY_DIR, entry)];

  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) {
      continue;
    }
    seen.add(file);

    const source = readModule(file);
    for (const specifier of runtimeImports(source)) {
      if (RELATIVE.test(specifier)) {
        queue.push(resolve(dirname(file), specifier));
        continue;
      }
      if (ALIAS.test(specifier)) {
        queue.push(resolve(REPO_ROOT, specifier.slice(2)));
        continue;
      }
      if (!externals.has(specifier)) {
        externals.set(specifier, file);
      }
    }
  }

  return { files: seen, externals };
};

describe("the data half of the galaxy", () => {
  it("never reaches pixi.js, however many hops away", () => {
    const { externals } = walk("data.ts");
    const leak = externals.get("pixi.js");
    expect(
      leak,
      leak
        ? `data.ts reaches pixi.js through ${leak.slice(GALAXY_DIR.length + 1)}`
        : "",
    ).toBeUndefined();
  });

  it("imports nothing external at all", () => {
    // Stronger than the rule above and worth holding: the data half is pure
    // TypeScript over plain objects. Anything new appearing here is a decision,
    // not an accident, and the failure names it.
    const { externals } = walk("data.ts");
    expect([...externals.keys()]).toEqual([]);
  });

  it("stays clean through the Solarity adapter, which a page imports", () => {
    /**
     * `lib/supabase/galaxy.ts` is `server-only` and imports
     * `solarity/snapshots.ts`, so that file is in a **server** graph now — and
     * it is one hop from `../data` rather than being `data.ts` itself, which
     * is exactly where a convenient `from "../"` would go unnoticed.
     *
     * It imports `@/lib/roster`, which the walk follows into the repo rather
     * than counting as a package — so this asserts the *whole* reachable graph
     * is free of external imports, `lib/roster.ts` included. Had the alias been
     * treated as external, this test would have passed by never opening the
     * file.
     */
    const { externals } = walk("solarity/snapshots.ts");
    expect([...externals.keys()]).toEqual([]);
  });

  it("proves the walk can fail, by finding pixi from the renderer entry", () => {
    // Without this, every assertion above would also pass if `walk` silently
    // resolved nothing — which is the failure mode of a graph test.
    const { externals, files } = walk("index.ts");
    expect(externals.has("pixi.js")).toBe(true);
    expect(files.size).toBeGreaterThan(20);
  });
});
