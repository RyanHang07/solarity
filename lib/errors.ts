import type { PostgrestError } from "@supabase/supabase-js"
import { RateLimitError } from "@/lib/ratelimit"

/**
 * Shape every server action returns. Actions never throw: a thrown error
 * reaches production as an opaque "An error occurred", useless in a form.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

/**
 * Copy for every machine code the database raises in a HINT.
 *
 * **The HINT is the contract, not the message and not the SQLSTATE.** A
 * function may raise `check_violation` for something a person should read
 * ("you already have 10 goals") or for something they should not ("value too
 * long for type character varying(50)"). The code is what tells them apart.
 *
 * Adding a `raise ... using hint = 'X'` in a migration and forgetting to add
 * `X` here degrades to the generic message rather than leaking Postgres text,
 * so the failure mode is dull rather than dangerous.
 */
export const BY_HINT: Record<string, string> = {
  // Caps
  GOAL_LIMIT: "You already have 10 active goals. Archive one before adding another.",
  CIRCLE_FULL: "That Circle is full. Circles hold up to 10 people.",

  // Permission. Shared by several callers, so the copy states the fact and
  // stops. Copy that mentions why *you* were refused cannot be reused by the
  // next function that raises the same code.
  NOT_ADMIN: "Only an owner or admin can do that.",
  NOT_OWNER: "Only the Circle's owner can do that.",
  NOT_A_MEMBER: "You're not a member of that Circle.",
  NOT_YOUR_GOAL: "That isn't your goal.",
  NOT_AUTHENTICATED: "Please sign in again.",

  // Circle state
  CIRCLE_INACTIVE: "That Circle isn't active.",
  CIRCLE_LOCKED: "That Circle has finished its cycle and isn't taking new members.",
  CIRCLE_ARCHIVED: "That Circle is no longer active.",
  CIRCLE_ORPHANED: "That Circle is no longer available.",
  ALREADY_ARCHIVED: "That Circle is already archived.",
  ALREADY_OWNER: "You already own that Circle.",

  // Cycles and deadlines
  NO_ACTIVE_CYCLE: "That Circle has no cycle running right now.",
  NO_PENDING_DECISION: "There's no streak decision waiting on that Circle.",
  DEADLINE_TOO_SOON: "A deadline has to be at least tomorrow.",
  DEADLINE_BACKWARDS: "A renewed deadline can only move later, or be removed.",

  // Invite links
  INVITE_INVALID: "That invite link isn't valid. Ask whoever invited you for a new one.",
  INVITE_REVOKED: "That invite link was turned off. Ask for a new one.",
  INVITE_EXPIRED: "That invite link has expired. Ask for a new one.",

  // Profile
  USERNAME_RENAME_TOO_SOON: "You can only change your username once every 14 days.",
  TIMEZONE_INVALID: "We didn't recognise that timezone. Try reloading the page.",

  // Push. Both mean the browser handed us a subscription we can't use, which
  // nobody can act on, so the copy points at the one thing that ever fixes it.
  PUSH_ENDPOINT_INVALID: "We couldn't set up notifications on this device. Try turning them off and on again.",
  PUSH_KEYS_MISSING: "We couldn't set up notifications on this device. Try turning them off and on again.",
}

/**
 * Maps a database error to a message worth showing. See architecture/
 * section 2b.
 *
 * Order matters: **hint first, then SQLSTATE.** The hint is deliberate and
 * specific; the SQLSTATE is a category that often covers both readable and
 * unreadable failures. Anything unrecognised gets a generic message, since raw
 * Postgres errors disclose table and column names.
 *
 * Never keyed on message text. Renaming a constraint would then silently change
 * what people read.
 */
export function toMessage(error: unknown): string {
  if (error instanceof RateLimitError) return error.message

  const pg = error as Partial<PostgrestError> | null
  if (!pg || typeof pg !== "object") return "Something went wrong. Please try again."

  if (pg.hint && BY_HINT[pg.hint]) return BY_HINT[pg.hint]

  switch (pg.code) {
    // unique_violation
    case "23505":
      if (pg.message?.includes("username")) return "That username is taken."
      return "That already exists."

    // check_violation. Reached only when no hint was set, which now means a
    // column CHECK rather than a raise: every raise in the database carries one
    // as of migration 65.
    case "23514":
      return "That value isn't allowed."

    // RLS rejection or a missing grant.
    //
    // The `pg.message === "Not authenticated"` special case that used to live
    // here is gone. It existed because nine RPCs raised that text with no code,
    // so message matching was the only way to tell "your session died" from
    // "that isn't yours". All nine carry NOT_AUTHENTICATED as of migration 65,
    // and the hint is read before this switch.
    case "42501":
      return "You don't have access to that."

    default:
      return "Something went wrong. Please try again."
  }
}
