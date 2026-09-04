/**
 * Migration 111's backfill: give every existing account the sun it already has.
 *
 * ## Why this is a script and not part of the migration
 *
 * The value each row needs is the one `memberSun.ts` derives — an FNV-1a hash
 * of the account id, taken through `pickIndex` rather than `% 6`. **Writing
 * that in SQL would be a second implementation of a hash**, and this codebase
 * already has the scar: `hashString % 6` reached three of six buckets, so half
 * the planet surfaces were unreachable in production and every harness using
 * short ids looked correct. A re-implementation that drifted by one bit here
 * would silently change the colour of every account that has ever been seen.
 *
 * So the backfill calls the function the app calls. There is exactly one hash.
 *
 * ## Idempotent, and it only ever fills a blank
 *
 * `is("sun_preset_id", null)` scopes every write, so running this twice is
 * harmless and running it after somebody has chosen a colour cannot overwrite
 * their choice. That matters more than it sounds: the natural instinct on a
 * failed run is to run it again.
 *
 * ## What it does not do
 *
 * It does not make the fallback redundant. `null` still means "derive from my
 * id" everywhere in the app, because an account can be created between this
 * running and its owner reaching the picker. This removes the *reliance* on the
 * fallback for accounts that already exist, which is what backfilling buys:
 * changing the preset list later reshuffles nobody who was already here.
 *
 *   npx tsx scripts/backfill-sun-presets.ts
 */
import { createClient } from "@supabase/supabase-js"
import { sunPresetIdForMember } from "@/lib/galaxy/memberSun"
import type { Database } from "@/lib/database.types"
import { loadEnvLocal } from "../e2e/env"

loadEnvLocal()

const need = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. See .env.example.`)
  return value
}

/**
 * The service key, because this writes rows it does not own.
 *
 * The same confinement rule the e2e client documents applies: nothing in
 * `scripts/` is bundled, and the key never reaches a browser.
 */
const admin = createClient<Database>(
  need("NEXT_PUBLIC_SUPABASE_URL"),
  need("SUPABASE_SECRET_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
)

async function main() {
  const { data: rows, error } = await admin
    .from("users")
    .select("id")
    .is("sun_preset_id", null)

  if (error) throw error
  if (!rows?.length) {
    console.log("Nothing to backfill: every account already has a sun.")
    return
  }

  console.log(`${rows.length} account${rows.length === 1 ? "" : "s"} to fill.`)

  let filled = 0
  for (const row of rows) {
    const preset = sunPresetIdForMember(row.id)
    const { error: writeError } = await admin
      .from("users")
      .update({ sun_preset_id: preset })
      .eq("id", row.id)
      // **Belt and braces against a concurrent pick.** The read above could be
      // seconds old, and losing somebody's chosen colour to a backfill would be
      // the worst possible outcome of a cosmetic script.
      .is("sun_preset_id", null)

    if (writeError) {
      console.error(`  ${row.id}: ${writeError.message}`)
      continue
    }
    filled += 1
  }

  console.log(`Filled ${filled} of ${rows.length}.`)

  // **The check that makes this worth running rather than assuming.** A partial
  // failure above is logged per row and easy to scroll past; this fails loudly.
  const { count, error: countError } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .is("sun_preset_id", null)

  if (countError) throw countError
  if (count && count > 0) {
    throw new Error(
      `${count} account${count === 1 ? " is" : "s are"} still null. ` +
        `They will render the derived colour, which is correct but not stored.`,
    )
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
