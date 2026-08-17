import fs from "node:fs"
import path from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
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

/** The `goals_active_limit` trigger's ceiling. Mirrored, not imported. */
const GOAL_CAP = 10

/**
 * Makes room for `needed` more active goals, and hands back what to undo.
 *
 * The cap is 10 per user and both test accounts are real ones that get used by
 * hand, so a test cannot assume a free slot. Archiving the newest active goals
 * is the smallest possible disturbance: `archived_at` is reversible, unlike a
 * delete, and picking the newest leaves older history untouched.
 *
 * **`needed` is not optional, and that is the point.** This used to free
 * exactly one slot, which was silently wrong for `roster.spec.ts`: it seeds two
 * goals, so the first insert took the slot and the second hit the cap. The
 * failure then landed in the middle of seeding, before any cleanup, leaving the
 * first goal behind — and each failed run left one more, until the account held
 * eight stray E2E goals and every roster test failed on the cap from the start.
 * Requiring the count makes the caller state how many it will create.
 *
 * Always pair with `restoreGoalSlots` in a `finally`.
 */
export async function freeGoalSlots(userId: string, needed: number): Promise<string[]> {
  const { data, error } = await admin
    .from("goals")
    .select("id")
    .eq("user_id", userId)
    .is("archived_at", null)
    .is("achieved_at", null)
    .order("created_at", { ascending: false })
  if (error) throw error

  const active = data ?? []
  const surplus = active.length + needed - GOAL_CAP
  if (surplus <= 0) return []
  if (surplus > active.length) {
    throw new Error(
      `Cannot free ${needed} slots: ${userId} has only ${active.length} active goals ` +
        `and the cap is ${GOAL_CAP}.`,
    )
  }

  const victims = active.slice(0, surplus).map((g) => g.id)
  const { error: archiveError } = await admin
    .from("goals")
    .update({ archived_at: archivedAtNow() })
    .in("id", victims)
  if (archiveError) throw archiveError
  return victims
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

export async function restoreGoalSlots(goalIds: string[]) {
  if (!goalIds.length) return
  const { error } = await admin
    .from("goals")
    .update({ archived_at: null })
    .in("id", goalIds)
  if (error) throw error
  forgetParked(goalIds)
}

/**
 * Archives every one of a user's active goals, so a test's seeded goals are the
 * only ones there are.
 *
 * **Because a roster count is a claim about the whole account.** `roster.spec`
 * asserts a member's row reads "1 of 2", which is true only if the two seeded
 * goals are the account's only active ones. Both test accounts are real and get
 * used by hand, so the moment the joiner had two goals of their own the row
 * read "2 of 4" and four assertions failed at once. Freeing *slots* is not
 * enough; the fixture has to own the whole list.
 *
 * Reversible, and journalled, because this archives a real person's real goals.
 * See `parkedPath`.
 */
export async function parkActiveGoals(userId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("goals")
    .select("id")
    .eq("user_id", userId)
    .is("archived_at", null)
    .is("achieved_at", null)
  if (error) throw error

  const ids = (data ?? []).map((g) => g.id)
  if (!ids.length) return []

  // Journalled *before* the write, not after. A crash between the two leaves an
  // id recorded that was never archived, and restoring it is a no-op. The other
  // order loses the record of a goal that really was archived.
  rememberParked(ids)

  const { error: archiveError } = await admin
    .from("goals")
    .update({ archived_at: archivedAtNow() })
    .in("id", ids)
  if (archiveError) throw archiveError
  return ids
}

/**
 * Where parked goal ids are written down.
 *
 * Playwright kills a test that exceeds its timeout, and a killed test does not
 * finish its `finally`. Without this, one timeout leaves a real account's goals
 * archived with nothing but this process's memory recording which ones, and
 * that memory dies with the run. The file survives, and
 * `npm run test:e2e:clean` restores from it.
 */
function parkedPath() {
  return path.join(process.cwd(), "e2e", ".auth", "parked-goals.json")
}

function readParked(): string[] {
  try {
    return JSON.parse(fs.readFileSync(parkedPath(), "utf8")) as string[]
  } catch {
    return []
  }
}

function writeParked(ids: string[]) {
  fs.mkdirSync(path.dirname(parkedPath()), { recursive: true })
  fs.writeFileSync(parkedPath(), JSON.stringify(ids, null, 2))
}

function rememberParked(ids: string[]) {
  writeParked([...new Set([...readParked(), ...ids])])
}

function forgetParked(ids: string[]) {
  const remaining = readParked().filter((id) => !ids.includes(id))
  writeParked(remaining)
}

/** Un-archives anything a killed run left parked. Used by `e2e/clean.ts`. */
export async function restoreParkedGoals(): Promise<number> {
  const ids = readParked()
  if (!ids.length) return 0
  await restoreGoalSlots(ids)
  writeParked([])
  return ids.length
}

/**
 * Deletes every goal a test made, active or archived, along with what hangs off
 * it.
 *
 * A safety net rather than the normal path: tests delete their own goals, but a
 * throw between two inserts skips that, and unlike a stray Circle a stray goal
 * counts against a cap. Eight of them made every roster test fail before its
 * first assertion, with an error that named the cap and not the cause.
 *
 * Matched on the `E2E ` title prefix, the same convention `deleteE2ECircles`
 * uses for names, so it cannot touch a goal someone made by hand unless they
 * named it that way.
 *
 * **Global, not scoped to the caller.** Safe only because the suite runs with
 * one worker; a second worker would have this delete goals another file was
 * still using. If `workers` ever goes above 1, this has to take a list of ids.
 */
export async function deleteE2EGoals() {
  const { data: goals, error } = await admin
    .from("goals")
    .select("id")
    .like("title", `${E2E_PREFIX}%`)
  if (error) throw error
  if (!goals?.length) return 0

  const ids = goals.map((g) => g.id)
  // Children first: neither of these is ON DELETE CASCADE.
  for (const table of ["progress_entries", "goal_group_visibility"] as const) {
    const { error: childError } = await admin.from(table).delete().in("goal_id", ids)
    if (childError) throw childError
  }
  const { error: goalError } = await admin.from("goals").delete().in("id", ids)
  if (goalError) throw goalError
  return ids.length
}

/**
 * A Supabase client signed in as a real user.
 *
 * Built the same way `auth.setup.ts` builds its cookies: mint a magic-link
 * token with the admin API and redeem it. No password, no Google, no user
 * modified.
 *
 * **Use this rather than `admin` for anything that depends on who is asking.**
 * The service role has no `auth.uid()`, so `current_checkin_date()` falls back
 * to UTC for it. Writing a check-in with that date and then asserting against a
 * roster computed in the member's real timezone fails whenever the two differ,
 * and passes whenever they happen not to.
 */
const sessionCache = new Map<string, Promise<SupabaseClient<Database>>>()

export function sessionFor(email: string): Promise<SupabaseClient<Database>> {
  // Cached for the same reason as `storageStateFor`: every `verifyOtp` spends
  // from Supabase's hourly *auth* request budget, which is separate from
  // anything in `lib/ratelimit.ts` and cannot be cleared from here.
  let existing = sessionCache.get(email)
  if (!existing) {
    existing = mintSession(email)
    sessionCache.set(email, existing)
  }
  return existing
}

async function mintSession(email: string): Promise<SupabaseClient<Database>> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (error) throw new Error(`generateLink failed for ${email}: ${error.message}`)

  const client = createClient<Database>(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
  const { error: verifyError } = await client.auth.verifyOtp({
    token_hash: data.properties!.hashed_token,
    type: "email",
  })
  if (verifyError) throw new Error(`verifyOtp failed for ${email}: ${verifyError.message}`)
  return client
}

/**
 * A Circle, created through the RPC rather than the dashboard form.
 *
 * **This spends no rate-limit budget at all**, which is the single biggest
 * source of flakiness this suite had. `enforce("createCircle")` lives in the
 * server action, not in `create_circle`, so the UI path is metered at 5 a day
 * and the RPC path is not. The two stable spec files were stable precisely
 * because they had always used the RPC.
 *
 * **Use this for setup; use the form only when the form is what is under test.**
 * A test that needs a Circle in order to assert something else should not also
 * be re-testing Circle creation, and paying a daily quota to do it.
 */
export async function createCircleViaApi(email: string, label: string) {
  const client = await sessionFor(email)
  const name = circleName(label)

  const created = await client.rpc("create_circle", { p_name: name })
  if (created.error) throw new Error(`create_circle: ${created.error.message}`)

  return { groupId: created.data as string, name }
}

/** An invite token for a Circle, likewise without touching the UI. */
export async function inviteTokenFor(email: string, groupId: string) {
  const client = await sessionFor(email)
  const link = await client.rpc("create_invite_link", { p_group_id: groupId })
  if (link.error) throw new Error(`create_invite_link: ${link.error.message}`)
  return link.data as string
}
