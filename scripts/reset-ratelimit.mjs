/**
 * Clears rate-limit state during development.
 *
 * Deleting one key in the Upstash console is usually not enough. The sliding
 * window keeps a key per window and weights the *previous* window into the
 * current count, so a single delete leaves you limited by the leftover. With
 * `analytics: true` there are also separate analytics keys, which do not affect
 * limiting but clutter a manual search.
 *
 *   node --env-file=.env.local scripts/reset-ratelimit.mjs            # all limits
 *   node --env-file=.env.local scripts/reset-ratelimit.mjs createCircle
 *
 * Development only. Nothing calls this from the app.
 */
import { Redis } from "@upstash/redis"

const name = process.argv[2]
const pattern = name ? `solarity:${name}*` : "solarity:*"

if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
  console.error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN in .env.local")
  process.exit(1)
}

const redis = Redis.fromEnv()

// SCAN rather than KEYS: KEYS blocks the server, and this pattern is the one
// people copy into production scripts later.
const found = []
let cursor = "0"
do {
  const [next, keys] = await redis.scan(cursor, { match: pattern, count: 100 })
  cursor = String(next)
  found.push(...keys)
} while (cursor !== "0")

if (!found.length) {
  console.log(`No keys matching ${pattern}.`)
  console.log("If you are still limited, the identifier may differ: keys are")
  console.log("prefixed solarity:<limitName> and suffixed with the user id.")
  process.exit(0)
}

console.log(`Deleting ${found.length} key(s) matching ${pattern}:`)
for (const k of found) console.log("  " + k)

await redis.del(...found)
console.log("Done. The limit is clear for every user, so development only.")
console.log()
console.log("This is the whole story only because `lib/ratelimit.ts` sets")
console.log("`ephemeralCache: false`. Left on, @upstash/ratelimit also caches a")
console.log("refusal in the server process for the rest of the window, and no")
console.log("amount of deleting keys here would clear that. If this script ever")
console.log("stops working, check that setting before anything else.")
