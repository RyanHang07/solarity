import { createClient } from "@supabase/supabase-js"
import { Redis } from "@upstash/redis"
import type { Database } from "@/lib/database.types"
import { loadEnvLocal } from "./env"

// Before anything reads `process.env`, including the `admin` client below.
// `playwright.config.ts` also calls this, but `e2e/clean.ts` runs under tsx and
// never loads the Playwright config, so this file cannot rely on that.
loadEnvLocal()

/**
 * Service-role client, for the two things a test needs that no user can do:
 * putting a Circle into a state the UI cannot reach, and cleaning up after
 * itself.
 *
 * **Confined to `e2e/`.** The ESLint rule that keeps this key out of anything
 * reachable by the browser covers `components/**` and `app/**\/*.tsx`; nothing
 * here is bundled, and the key never leaves the test runner.
 *
 * It bypasses RLS entirely, so it is deliberately NOT used to drive the flows
 * under test. A test that seeds through this client and asserts through the UI
 * proves the UI renders, not that a real user could have got there.
 */
export const admin = createClient<Database>(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SECRET_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
)

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set.\n` +
        `e2e/env.ts loads .env.local from the working directory, so run ` +
        `Playwright from the project root. See .env.example for the full list.`,
    )
  }
  return value
}

/** Every Circle a test creates starts with this, so strays are obvious. */
export const E2E_PREFIX = "E2E "

export function circleName(label: string): string {
  // The suffix keeps a retried run from colliding with rows a failed run left.
  return `${E2E_PREFIX}${label} ${Date.now().toString().slice(-6)}`
}

/**
 * Puts a group streak on the board.
 *
 * There is no way to do this through the UI in under a fortnight, and the
 * pending-streak decision only exists when someone joins a Circle whose streak
 * is above zero. So this is the one piece of state the tests fabricate.
 */
export async function setGroupStreak(groupId: string, streak: number) {
  const { error } = await admin
    .from("group_cycles")
    .update({ current_streak: streak })
    .eq("group_id", groupId)
    .is("ended_at", null)
  if (error) throw error
}

export async function findCircleByName(name: string) {
  const { data, error } = await admin
    .from("groups")
    .select("id, name, group_status, streak_decision_pending")
    .eq("name", name)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * Clears the rate-limit budget for the two test accounts.
 *
 * **Why this is necessary rather than lazy.** Circle creation is capped at 5
 * per day per user, and `invite.spec.ts` alone needs 4 while
 * `streak-decision.spec.ts` needs 3. Run back to back on one account that is 7,
 * and the run would fail on abuse control rather than on a bug. Worse, it would
 * fail *differently* depending on how much manual testing happened that day,
 * which is the least useful kind of flake.
 *
 * **Why not raise the limit.** 5 a day is a product decision that belongs in
 * `lib/ratelimit.ts`, and a test suite that quietly widens a production control
 * to suit itself stops testing the product. Clearing a budget is visible and
 * scoped; changing the number is neither.
 *
 * **Scoped to the two test users**, unlike `scripts/reset-ratelimit.mjs`, which
 * clears every user and is a development convenience. Keys are
 * `solarity:<limit>:<user id>`, so matching on the id cannot touch anyone else.
 *
 * Called per spec file rather than once per run, so each file starts with a
 * full budget and neither has to know what the other spent.
 */
export async function clearRateLimits() {
  const patterns: string[] = []

  for (const email of [
    requireEnv("E2E_OWNER_EMAIL"),
    requireEnv("E2E_JOINER_EMAIL"),
  ]) {
    patterns.push(`solarity:*${await userIdByEmail(email)}*`)
  }

  // The invite limits key on client IP and on a hash of the token, not on a
  // user id, so the per-user patterns above cannot reach them. Every request
  // from the test runner shares one IP bucket, and the suite opens `/join`
  // roughly a dozen times against a cap of 20 an hour, so without this the last
  // spec of a second run in the same hour would fail on the limiter.
  patterns.push("solarity:inviteAttempt:*", "solarity:inviteToken:*")

  await deleteByPattern(patterns)
}

async function deleteByPattern(patterns: string[]) {
  const redis = Redis.fromEnv()
  const keys = new Set<string>()

  for (const match of patterns) {
    let cursor = "0"
    // SCAN, not KEYS: KEYS blocks the Redis server. And the sliding window
    // keeps a key per window, weighting the previous one into the current
    // count, so deleting a single key leaves you limited by the leftover.
    do {
      const [next, found] = await redis.scan(cursor, { match, count: 100 })
      cursor = String(next)
      found.forEach((k) => keys.add(k))
    } while (cursor !== "0")
  }

  if (keys.size) await redis.del(...keys)
}

export async function userIdByEmail(email: string): Promise<string> {
  // `listUsers` is paginated and these projects have a handful of users, so one
  // page is enough. If that stops being true this needs a filter, not a bigger
  // page.
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error

  const user = data.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase(),
  )
  if (!user) {
    throw new Error(
      `No account for ${email}. E2E_OWNER_EMAIL and E2E_JOINER_EMAIL must be real, onboarded accounts.`,
    )
  }
  return user.id
}

/**
 * Removes everything a run created. Called from an `afterAll`, and again by
 * `npm run test:e2e:clean` for whatever a crashed run left behind.
 *
 * Deletes rather than archives, which is the opposite of what the product does
 * on purpose: archived test Circles would pile up in a real account's sidebar
 * forever. See build-plan.md, "Clearing test data".
 */
export async function deleteE2ECircles() {
  const { data: groups, error: findError } = await admin
    .from("groups")
    .select("id")
    .like("name", `${E2E_PREFIX}%`)
  if (findError) throw findError
  if (!groups?.length) return

  const ids = groups.map((g) => g.id)

  // ---------------------------------------------------------------------
  // Order matters, and getting it wrong fails loudly.
  //
  // Deleting `groups` first cascades into `group_members`, which fires
  // `handle_membership_removal`. That trigger inserts an `audit_log` row
  // referencing `old.group_id` — and by then the group row is gone, because
  // Postgres removes the parent before cascading to children. The insert hits
  // `audit_log_group_id_fkey` and the whole delete fails with 23503.
  //
  // `audit_log.group_id` is ON DELETE SET NULL rather than CASCADE, so the FK
  // cannot save us here: it tolerates a group disappearing later, not a row
  // written for a group that has already gone.
  //
  // So: memberships first, while the group still exists and the audit insert
  // has something to point at.
  // ---------------------------------------------------------------------
  const { error: memberError } = await admin
    .from("group_members")
    .delete()
    .in("group_id", ids)
  if (memberError) throw memberError

  // That trigger also wrote a `kicked` notification per member, because the
  // service role has no `auth.uid()` and the removal therefore reads as a kick
  // rather than as leaving. Those notifications hang off `users`, not `groups`,
  // so deleting the Circle would leave them in a real account's feed forever.
  //
  // Cleared after the memberships, since that is what creates them.
  //
  // Filtered in JS rather than with a PostgREST JSON-path filter. `group_id`
  // lives inside a jsonb payload, and a filter that silently matches nothing
  // would leave notifications behind without failing, which is the kind of
  // cleanup bug you only find months later.
  const { data: notifications, error: readError } = await admin
    .from("notifications")
    .select("id, payload")
    .in("type", ["kicked", "invite_accepted"])
  if (readError) throw readError

  const mine = (notifications ?? [])
    .filter((n) => {
      const payload = n.payload as { group_id?: string } | null
      return !!payload?.group_id && ids.includes(payload.group_id)
    })
    .map((n) => n.id)

  if (mine.length) {
    const { error } = await admin.from("notifications").delete().in("id", mine)
    if (error) throw error
  }

  const { error: groupError } = await admin.from("groups").delete().in("id", ids)
  if (groupError) throw groupError
}

/**
 * Throws with the database's own message instead of returning null.
 *
 * Supabase returns `{ data: null, error }` rather than throwing, so an
 * unchecked write fails three lines later as `Cannot read properties of null`.
 * That is how a plain "Active goal limit reached (10 maximum)" reached a test
 * report as a TypeError pointing at the wrong line.
 *
 * An assertion function rather than one that returns the row: supabase-js types
 * the result as a discriminated union, and `asserts` lets TypeScript narrow it
 * in place. Anything that takes the union and hands back `T` has to fight the
 * inference, which lands on either `never` or `T | null` depending on which
 * branch it picks first.
 */
export function assertOk<T>(
  result: { data: T | null; error: { message: string } | null },
  what: string,
): asserts result is { data: T; error: null } {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`)
  if (result.data === null) throw new Error(`${what} returned no row`)
}

/**
 * Makes room for one more active goal, and hands back what to undo.
 *
 * The cap is 10 per user and both test accounts are real ones that get used by
 * hand, so a test cannot assume a free slot. Archiving the newest active goal
 * is the smallest possible disturbance: `archived_at` is reversible, unlike a
 * delete, and picking the newest leaves older history untouched.
 *
 * Always pair with `restoreGoalSlot` in a `finally`.
 */
export async function freeGoalSlot(userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("goals")
    .select("id")
    .eq("user_id", userId)
    .is("archived_at", null)
    .is("achieved_at", null)
    .order("created_at", { ascending: false })
  if (error) throw error
  if ((data?.length ?? 0) < 10) return null

  const victim = data![0].id
  const { error: archiveError } = await admin
    .from("goals")
    .update({ archived_at: archivedAtNow() })
    .eq("id", victim)
  if (archiveError) throw archiveError
  return victim
}

/**
 * A timestamp the `goals_archived_not_future` CHECK will accept.
 *
 * The constraint is `archived_at <= now()`, evaluated against the **database**
 * clock, while `new Date()` reads the caller's. A few hundred milliseconds of
 * skew is enough to be refused, which is exactly what happened: a value 217ms
 * ahead of the server failed with a bare `23514` and no hint.
 *
 * A minute of slack is far more than any sane skew and far less than anything
 * that could matter to a timestamp nobody reads to the second.
 *
 * The app has the same exposure in `archiveGoal`. Noted in build-plan.md: the
 * real fix is for the database to set the value, not the caller.
 */
function archivedAtNow(): string {
  return new Date(Date.now() - 60_000).toISOString()
}

export async function restoreGoalSlot(goalId: string | null) {
  if (!goalId) return
  const { error } = await admin
    .from("goals")
    .update({ archived_at: null })
    .eq("id", goalId)
  if (error) throw error
}
