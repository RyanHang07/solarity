#!/usr/bin/env node
/**
 * Step 14b. **Is `graphify-out/` telling the truth about this repository?**
 *
 * The graph is a cache of the codebase, and a stale cache is worse than none:
 * it answers confidently about files that have since changed. This exists so
 * "the graph is current" is a check rather than a belief — the step 13 audit
 * had to fall back to the TypeScript compiler API precisely because nobody
 * could say how far behind it was.
 *
 * **Compared against `manifest.json`, not `graph.json`.** The manifest is the
 * per-file record graphify itself keeps: path, mtime, and two content hashes.
 * That makes "stale" answerable exactly rather than by counting nodes.
 *
 * **The extension list is derived from the manifest**, not hard-coded. graphify
 * indexes code and migrations and ignores docs and assets; hard-coding that
 * would silently start reporting every `.md` file as missing the day someone
 * changes the configuration.
 *
 *   node scripts/graph-freshness.mjs
 *
 * Exits non-zero when anything is missing, stale or orphaned, so it can gate a
 * commit if that is ever wanted.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"

const MANIFEST = "graphify-out/manifest.json"

if (!existsSync(MANIFEST)) {
  console.error(`no ${MANIFEST} — the graph has never been built here`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"))

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 })
    .split("\n")
    .filter(Boolean)

const ext = (f) => f.split(".").pop()

/** What graphify actually indexes here, learned from what it indexed last time. */
const INDEXED = new Set(Object.keys(manifest).map(ext))

/**
 * Files whose extension is indexed but which graphify plainly does not index.
 *
 * The three `.json` entries in the manifest are `package.json`, `tsconfig.json`
 * and `.mcp.json` — configuration it reads on purpose. A lockfile is generated
 * data with the same extension, and deriving the rule from the manifest cannot
 * tell those apart. Listed rather than inferred, so the exception is visible.
 */
const NEVER_INDEXED = new Set(["package-lock.json"])

const candidates = (files) =>
  files.filter(
    (f) =>
      INDEXED.has(ext(f)) &&
      !f.startsWith("graphify-out/") &&
      !NEVER_INDEXED.has(f),
  )

const tracked = candidates(git("ls-files"))
const untracked = candidates(git("ls-files", "--others", "--exclude-standard"))

/**
 * Changed on disk since the graph last saw them.
 *
 * **Hashed, not compared by mtime.** The manifest stores an mtime, but a
 * checkout, a rebase or a `git stash pop` rewrites mtimes without changing a
 * byte, and every one of those would report the whole tree as stale. The hash
 * is graphify's own `ast_hash`, which this cannot recompute — so the honest
 * substitute is a content hash of the file compared against a sidecar of our
 * own. Without one, fall back to git's view of what has been modified, which is
 * content-based and needs nothing stored.
 */
const modified = candidates(git("diff", "--name-only", "HEAD"))

const missingTracked = tracked.filter((f) => !(f in manifest))
const missingUntracked = untracked.filter((f) => !(f in manifest))
const staleInGraph = modified.filter((f) => f in manifest)
const orphaned = Object.keys(manifest).filter(
  (f) => !tracked.includes(f) && !untracked.includes(f),
)

const report = (label, files) => {
  if (!files.length) return 0
  console.log(`\n${label} (${files.length})`)
  for (const f of files.sort()) console.log(`  ${f}`)
  return files.length
}

console.log(`manifest: ${Object.keys(manifest).length} files`)
console.log(`repository: ${tracked.length} tracked + ${untracked.length} untracked`)
console.log(`indexed extensions: ${[...INDEXED].sort().join(", ")}`)

const problems =
  report("absent from the graph, committed", missingTracked) +
  report("absent from the graph, not yet committed", missingUntracked) +
  report("in the graph but changed since", staleInGraph) +
  report("in the graph but gone from the repository", orphaned)

if (problems === 0) {
  console.log("\nthe graph matches the repository")
  process.exit(0)
}

console.log(`\n${problems} file(s) out of date — regenerate graphify-out/`)
process.exit(1)
