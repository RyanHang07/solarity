import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

/**
 * Step 14a. The caller's Circles, split by status.
 *
 * **Shared by all three sections, and read once per section rather than once
 * in the layout.** There is no way to hand layout data to a child page, and the
 * layout is not re-rendered on a section switch anyway — so hoisting this would
 * mean fetching it for sections that then fetch it again. One query per section
 * is the honest cost of partial rendering, and it is one query.
 *
 * Kept here rather than inlined three times so the `.eq("user_id", …)` below
 * cannot be forgotten in one of them.
 */
export async function readMemberships(
  supabase: SupabaseClient<Database>,
  userId: string,
) {
  // `.eq("user_id", …)` is load-bearing, and leaving it out was a bug.
  //
  // The SELECT policy is `private.is_group_member(group_id)`: you can read
  // every member row of every Circle you belong to, which is exactly what the
  // roster on `/circles/[id]` needs. So RLS scopes this to the caller's
  // **Circles**, not to the caller's **memberships**, and without the filter a
  // Circle of three came back as three rows and rendered three times, each
  // showing a different person's role.
  //
  // The general form: RLS is not a substitute for a WHERE clause. It bounds
  // what you *may* read, never what you *meant* to read.
  const { data } = await supabase
    .from("group_members")
    // `streak_decision_pending` is one more column on a query these pages
    // already run, and it is half of what orders the digest boxes.
    .select("group_id, role, groups(name, group_status, streak_decision_pending)")
    .eq("user_id", userId)
    .order("joined_at", { ascending: true })

  // `locked` and `archived` move beneath rather than disappearing: locked is
  // awaiting a renewal decision, archived is retired, and both are still
  // history the owner may want. product-and-design.md section 3.
  return {
    active: data?.filter((m) => m.groups?.group_status === "active") ?? [],
    inactive: data?.filter((m) => m.groups?.group_status !== "active") ?? [],
  }
}
