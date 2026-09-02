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

  // Step 17. A site admin, not a Circle admin — `NOT_ADMIN` above is the
  // Circle one and its copy says "owner or admin", which would be wrong here.
  // Reachable only by calling an admin RPC directly, since `/admin` is a 404
  // to everyone else; a person who sees this went looking.
  NOT_SITE_ADMIN: "That's an administrator action.",

  // Roles. Each names the rule rather than the refusal, because each exists to
  // stop a specific way of locking everyone out.
  // **`ROLE_SELF_CHANGE` is gone**, not renamed. Migration 93 forbade changing
  // your own role, and migration 95 removed that rule because it made
  // `LAST_ADMIN` unreachable: to reach the last-admin check the caller must be
  // an admin and the target a *different* admin, which means there are two.
  // Self-demotion is now allowed and the last-admin rule is the real guard.
  LAST_ADMIN:
    "You're the last administrator. Give somebody else the role first, then step down.",
  NO_SUCH_ACCOUNT: "There's no account with that username.",

  /**
   * Step 20a. `TERMS_VERSION` is a dated constant the app owns, so a version
   * the database refuses is a caller bug rather than anything a person typed.
   * The copy still has to exist, because this is reachable the moment somebody
   * calls the RPC directly, and "Something went wrong" would be the alternative.
   */
  TERMS_VERSION_INVALID: "Couldn't record that. Try again, or write to us.",
  REPORT_NOT_FOUND: "That report no longer exists.",
  NOT_AUTHENTICATED: "Please sign in again.",

  // Goal lifecycle. Migration 83 refuses to clear or move `achieved_at` once
  // set, because `goals_count_achievement` would count the goal twice. The copy
  // names the consequence rather than the trigger: "final" is the fact, and the
  // way out is a new goal.
  ACHIEVEMENT_FINAL:
    "Achieving a goal is final. Start a new goal if you want to keep going.",

  // Circle state
  CIRCLE_INACTIVE: "That Circle isn't active.",
  CIRCLE_LOCKED: "That Circle has finished its cycle and isn't taking new members.",
  CIRCLE_ARCHIVED: "That Circle is no longer active.",
  CIRCLE_ORPHANED: "That Circle is no longer available.",
  ALREADY_ARCHIVED: "That Circle is already archived.",
  ALREADY_OWNER: "You already own that Circle.",

  // Step 18b. Inviting a named person.
  ALREADY_MEMBER: "They're already in this Circle.",

  // Names the fix, because there is a button for it on the same screen. The
  // RPC refuses rather than minting a link, since `create_invite_link` disables
  // every existing one and a silent regeneration would revoke the link members
  // are already passing around.
  INVITE_LINK_MISSING:
    "This Circle has no live invite link. Generate one below, then invite them.",

  /**
   * **Deliberately the same answer for "blocked" and "no such account".**
   *
   * `invite_user_to_circle` raises this when either of you has blocked the
   * other, and also when the id names nobody. Two messages would turn the
   * invite button into a detector for being blocked, which is the one thing
   * blocking must never announce. Same masking as `profile_by_username`.
   *
   * Distinct from `NO_SUCH_ACCOUNT` above, which answers a username somebody
   * typed and can afford to be literal.
   */
  NOT_FOUND: "That person isn't available to invite.",

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

    /**
     * **PostgREST could not find the function.** Not a database refusal at all:
     * the row exists, the grant is right, and the API is serving a cached
     * schema that predates the change.
     *
     * This cost a puzzling bug report the day migration 105 landed. Dropping
     * `complete_onboarding(text, text)` and creating `(text, text, text)` is
     * two DDL statements PostgREST has to notice, and until it does, a
     * three-argument call matches nothing. The database was correct throughout;
     * the app said "Something went wrong. Please try again." and retrying could
     * never have helped.
     *
     * **The fix is `notify pgrst, 'reload schema';`**, and it is named in the
     * copy because the only person who ever sees this is whoever just deployed.
     * Every signature change is a chance to meet it again, and step 20 makes
     * several.
     */
    case "PGRST202":
      return "That action isn't available yet — the API is still catching up with a database change. Reload the schema cache."

    default:
      return "Something went wrong. Please try again."
  }
}
