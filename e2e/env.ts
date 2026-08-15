import fs from "node:fs"
import path from "node:path"

/**
 * Loads `.env.local` into `process.env`.
 *
 * **Why this exists.** Next.js loads `.env.local` automatically, which makes it
 * easy to assume everything does. Playwright's runner is a plain Node process
 * and loads nothing, so `NEXT_PUBLIC_SUPABASE_URL` is undefined inside a spec
 * even though the dev server three terminals over reads it fine.
 *
 * **Why not `dotenv`.** It would work, and it is what Playwright's own docs
 * suggest. But a `.env.local` in this project is a flat list of unquoted keys,
 * and the parser below is the whole feature: an extra dependency and an extra
 * install step buys nothing here.
 *
 * **What it deliberately does not support**, because nothing in this project
 * uses them: multi-line values, `export` prefixes, and variable interpolation
 * like `FOO=${BAR}`. If `.env.local` ever grows one of those, replace this with
 * `dotenv` rather than extending it.
 *
 * **Existing environment variables win.** `E2E_BASE_URL=... npm run test:e2e`
 * has to be able to override the file, and CI has no `.env.local` at all, which
 * is also why a missing file is not an error.
 */
export function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local")
  if (!fs.existsSync(file)) return

  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue

    // `indexOf`, not `split`: values contain `=` (base64 padding on the VAPID
    // and Supabase keys), and splitting would truncate them.
    const eq = line.indexOf("=")
    if (eq === -1) continue

    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()

    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    if (quoted && value.length >= 2) value = value.slice(1, -1)

    if (process.env[key] === undefined) process.env[key] = value
  }
}
