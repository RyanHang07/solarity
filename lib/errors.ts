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
 * Maps a database error to a message worth showing. See architecture.md
 * section 2b.
 *
 * Keyed on SQLSTATE, not message text, so renaming a constraint can't silently
 * change what users see. Unrecognised codes fall through to a generic message,
 * since raw Postgres errors disclose table and column names.
 */
export function toMessage(error: unknown): string {
  if (error instanceof RateLimitError) return error.message

  const pg = error as Partial<PostgrestError> | null
  if (!pg || typeof pg !== "object") return "Something went wrong. Please try again."

  switch (pg.code) {
    // unique_violation
    case "23505":
      if (pg.message?.includes("username")) return "That username is taken."
      return "That already exists."

    // check_violation — the RPC's own guards and column CHECKs
    case "23514":
      return "That value isn't allowed."

    // raised by the RPCs with `using errcode = 'invalid_parameter_value'`
    case "22023":
      return pg.message ?? "That value isn't allowed."

    // RLS rejection or a missing grant. Both mean "not yours".
    case "42501":
      return pg.message === "Not authenticated"
        ? "Please sign in again."
        : "You don't have access to that."

    default:
      return "Something went wrong. Please try again."
  }
}
