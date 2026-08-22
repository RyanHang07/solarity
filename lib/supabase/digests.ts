import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import {
  DAYS_SHOWN,
  groupByDay,
  type DigestDay,
  type DigestSnapshot,
  type RosterEntry,
} from "@/lib/digest-days"

/**
 * Step 11a. The last five days of digests, for every Circle you are in.
 *
 * ## One query, not one per Circle
 *
 * The panel this replaces ran a `limit 1` query per Circle: ten Circles, ten
 * round trips, to render ten rows. Five days each would have made that thirty
 * to fifty.
 *
 * `.in("group_id", …)` with `limit(circles × DAYS_SHOWN)` is one trip. At most
 * one row exists per Circle per date — `digest_snapshots` is keyed
 * `(group_id, date)` — so that limit **cannot** cut into the fifth day while a
 * fifth day exists. Ordering by date descending means the rows that survive the
 * limit are the newest ones.
 *
 * PostgREST has no `DISTINCT ON`, and this needs no view to work around that.
 *
 * ## Nothing here trusts `summary`
 *
 * It is jsonb written by a scheduled job. A shape change ships silently and a
 * dashboard that destructures it goes blank for everyone at once. Every field
 * is read with a type check and a default, so a malformed row degrades to the
 * counts, and a malformed roll call degrades to an empty one.
 */

export type { DigestDay } from "@/lib/digest-days"

export async function getDigestDays(
  supabase: SupabaseClient<Database>,
  circles: { groupId: string; circleName: string; inactive: boolean }[],
  needsAttention: Set<string>,
): Promise<DigestDay[]> {
  if (circles.length === 0) return []

  const byId = new Map(circles.map((c) => [c.groupId, c]))

  const { data, error } = await supabase
    .from("digest_snapshots")
    .select("group_id, date, summary")
    .in(
      "group_id",
      circles.map((c) => c.groupId),
    )
    .order("date", { ascending: false })
    .limit(circles.length * DAYS_SHOWN)

  // A failed read renders as "no history yet" rather than taking the page down.
  // The dashboard is the screen people land on, and one broken panel should not
  // cost them the other three.
  if (error || !data) return []

  const snapshots: DigestSnapshot[] = []
  for (const row of data) {
    const circle = byId.get(row.group_id)
    // RLS already scopes this to Circles you belong to, so a row with no match
    // means the two reads disagreed — a Circle left between them. Dropping it
    // is right: there is no name to render it under.
    if (!circle) continue

    const summary = (row.summary ?? {}) as Record<string, unknown>

    snapshots.push({
      groupId: row.group_id,
      circleName: circle.circleName,
      date: row.date,
      completed: num(summary.completed_count),
      members: num(summary.member_count),
      groupStreak: num(summary.group_streak),
      roster: readRoster(summary.members),
      needsAttention: needsAttention.has(row.group_id),
      inactive: circle.inactive,
    })
  }

  return groupByDay(snapshots)
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/**
 * The roll call, or an empty one.
 *
 * **Usernames are frozen at write time and stay that way.** `build_daily_digests`
 * denormalises them deliberately: joining live would let a past digest relabel
 * itself when someone renames, quietly rewriting a record of a day. Someone who
 * has since renamed appears here under the name they had.
 */
function readRoster(value: unknown): RosterEntry[] {
  if (!Array.isArray(value)) return []

  const entries: RosterEntry[] = []
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue
    const m = raw as Record<string, unknown>

    // A member with no username cannot be rendered and must not become
    // "undefined" on screen. Onboarding requires one, so this is a guard
    // against a future shape rather than against today's data.
    if (typeof m.user_id !== "string" || typeof m.username !== "string") continue

    entries.push({
      userId: m.user_id,
      username: m.username,
      completed: m.completed === true,
      streak: num(m.streak),
    })
  }

  return entries
}
