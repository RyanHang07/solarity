import fs from "node:fs"
import path from "node:path"
import type { Database } from "@/lib/database.types"

export type TodayMode = Database["public"]["Enums"]["today_screen_mode"]

/**
 * Where the run parks each account's real `today_screen_mode`.
 *
 * A file rather than a module variable, because setup and teardown are separate
 * processes in Playwright and a variable would be empty by the time it mattered.
 * Same reasoning as the parked-goals journal in `db.ts`.
 *
 * Lives beside the auth states, which are already gitignored.
 */
function modesPath() {
  return path.join(process.cwd(), "e2e", ".auth", "today-modes.json")
}

export function readSavedModes(): Record<string, TodayMode> {
  try {
    return JSON.parse(fs.readFileSync(modesPath(), "utf8")) as Record<string, TodayMode>
  } catch {
    return {}
  }
}

export function saveModes(modes: Record<string, TodayMode>) {
  fs.mkdirSync(path.dirname(modesPath()), { recursive: true })
  fs.writeFileSync(modesPath(), JSON.stringify(modes, null, 2))
}

export function clearSavedModes() {
  try {
    fs.unlinkSync(modesPath())
  } catch {
    // Never written, or already cleaned. Neither is a problem.
  }
}
