// Solarity — self-serve account deletion (architecture doc section 11).
//
// ORDER MATTERS. Each step depends on the previous still being possible:
//   1. Identify the caller from their OWN JWT (never the request body).
//   2. Scrub note text and collect Storage paths — BEFORE the user row is gone,
//      because afterwards the rows cannot be located.
//   3. Delete the Storage objects.
//   4. Delete the auth user, which cascades into public.users -> group_members,
//      firing handle_membership_removal for owner succession and audit.
//
// progress_entries deliberately SURVIVE, anonymized: other members' historical
// group stats are computed against them, and hard-deleting would retroactively
// corrupt cycles those people shared. The FKs null the attribution; the scrub
// handles the free-text note, which a foreign key cannot reach.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  // Resolve the caller from their own token. The user id is never taken from
  // the request body — that would let anyone delete anyone.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await asUser.auth.getUser();
  if (authError || !user) return json({ error: "Not authenticated" }, 401);

  const userId = user.id;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // 2. Scrub notes and collect every Storage path to remove.
    //    job_* lives in public rather than private because PostgREST cannot
    //    address a non-exposed schema; EXECUTE is granted to service_role only.
    const { data: media, error: scrubError } = await admin.rpc(
      "job_scrub_and_list_user_media",
      { p_user_id: userId },
    );
    if (scrubError) throw new Error(`scrub failed: ${scrubError.message}`);

    // 3. Remove the objects, grouped by bucket.
    const byBucket = new Map<string, string[]>();
    for (const r of (media ?? []) as Array<{ bucket: string; path: string }>) {
      if (!r?.bucket || !r?.path) continue;
      const list = byBucket.get(r.bucket) ?? [];
      list.push(r.path);
      byBucket.set(r.bucket, list);
    }

    for (const [bucket, paths] of byBucket) {
      // Storage remove() caps at 1000 paths per call.
      for (let i = 0; i < paths.length; i += 1000) {
        const { error } = await admin.storage
          .from(bucket)
          .remove(paths.slice(i, i + 1000));
        // A missing object is not a failure — the goal is that it is gone.
        if (error) console.warn(`storage remove failed for ${bucket}`, error.message);
      }
    }

    // 4. Remove the auth user.
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) throw new Error(`auth delete failed: ${deleteError.message}`);

    return json({ deleted: true });
  } catch (err) {
    console.error("delete-account failed", { userId, err: String(err) });
    return json({ error: "Account deletion failed. Please try again." }, 500);
  }
});
