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
  // Step 18b. **One edit, three readers**, which is the whole reason this list
  // exists: the tab query, the unread badge and mark-read all read it, and an
  // invite that appeared in the list without counting in the badge would be an
  // offer nobody was told about.
  "invited",

  /**
   * Step 19. Three of the four new types, and the omission is the point.
   *
   * These are events worth finding again: somebody achieved something, somebody
   * was first, the Circle is waiting on you. `circle_activity` is **not** here,
   * for the same reason `digest` never was. It can arrive every hour, the badge
   * counts unread tab rows, and a badge that is never zero is a badge nobody
   * reads — which would cost the three types above the attention they are for.
   *
   * So `circle_activity` is push-only: it interrupts once, in the moment it is
   * useful, and leaves nothing behind to clear.
   */
  "goal_achieved",
  "circle_first_finisher",
  "last_one_left",
] as const satisfies readonly NotificationType[]

/**
 * **There was a `TabNotificationType` alias here, and it had no reader.**
 *
 * Its stated job — making it visible when the enum grows and this list does not
 * — is already done by `satisfies readonly NotificationType[]` above, which is
 * checked by the compiler rather than by someone reading. The alias was the same
 * claim a second time, with nothing consuming it, so it went in the step 13
 * audit. Removed rather than kept: a symbol with no reader is the shape
 * `patterns.md` opens with.
 */
