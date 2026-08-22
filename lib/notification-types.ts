import type { Database } from "@/lib/database.types"

type NotificationType = Database["public"]["Enums"]["notification_type"]

/**
 * Step 11c. Which notification types belong on the Notifications tab.
 *
 * ## Why this list exists at all
 *
 * `digest` rows are no longer rendered anywhere in that list — the day boxes on
 * Overview replaced them, from `digest_snapshots` — so a digest row now exists
 * for exactly one purpose: carrying a push. `notifications` became an outbox
 * for these four types and a **delivery queue** for digests.
 *
 * ## One list, three readers, on purpose
 *
 * The tab query, the unread badge and the mark-read action must agree. If any
 * one of them drifts, the failure is silent and each direction is its own bug:
 *
 * | Drift | What it looks like |
 * |---|---|
 * | Badge counts digests, tab hides them | a number you cannot clear by looking anywhere |
 * | Tab lists digests, badge ignores them | a list that never explains its own badge |
 * | Mark-read includes digests | the app claims you read something it never showed |
 *
 * A shared constant is not much of a guard, but it is the guard that fits the
 * size of the risk. The structural fix — digests leaving this table entirely —
 * is in `deferred.md`.
 *
 * ## `read_at` does not apply to a digest
 *
 * It exists to drive the badge, and digests are not in the badge. Neither value
 * would be true: a timestamp claims you read something never shown, and marking
 * it on Overview would be a write with no reader. It stays `null` forever,
 * because `null` is the one value that asserts nothing.
 */
export const TAB_NOTIFICATION_TYPES = [
  "kicked",
  "invite_accepted",
  "group_locked_renewal",
  "deadline_changed",
] as const satisfies readonly NotificationType[]

/**
 * Guards the list against the enum growing without anyone deciding.
 *
 * A new `notification_type` lands in a migration; its renderer and its place in
 * this list land later, or not at all. Until someone chooses, a new type is
 * simply absent here — which is the safe direction, and this type makes the
 * omission visible to anyone reading rather than silent.
 */
export type TabNotificationType = (typeof TAB_NOTIFICATION_TYPES)[number]
