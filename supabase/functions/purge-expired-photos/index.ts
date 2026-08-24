// Solarity — check-in photo retention and garbage collection (security.md
// section 9).
//
// THREE SWEEPS, one job.
//
// 1. RETENTION. Photos older than 90 days. The check-in row and every statistic
//    derived from it SURVIVE; only the image goes and photo_url is nulled.
//
// 2. ORPHANS (step 13e). Objects no progress_entries row references. Sweep 1
//    cannot see these: it finds objects THROUGH photo_url, so a file nothing
//    points at is invisible to the only job meant to remove it, and would sit
//    in a private bucket forever. Reachable because the upload and the attach
//    are separate steps on purpose — the check-in wins and the photo is best
//    effort — and because undoCheckIn deletes the object first and continues
//    even if the row delete then fails.
//
//    THE GRACE WINDOW IS THE SAFETY-CRITICAL PARAMETER. An object is only an
//    orphan if nothing WILL reference it either, and there is a real gap
//    between upload and attach on a slow connection. 24 hours, because the two
//    mistakes are not symmetrical: an unreferenced object is invisible and
//    costs only storage, while deleting a live photo is silent and permanent.
//
// 3. MISSING (step 13e). The mirror image: rows naming an object that is gone.
//    Deletes nothing; it stops rows claiming a photo that cannot be served.
//
// WHY AN EDGE FUNCTION. Postgres can null photo_url but cannot delete the
// underlying Storage object — that needs the Storage API.
//
// WHY public.job_* AND NOT private.*. PostgREST only honours a schema header
// for schemas it is configured to expose, and `private` deliberately is not one.
// These helpers therefore live in `public` with EXECUTE granted to service_role
// alone, which keeps them unreachable by clients while remaining callable here.
//
// AUTH: scheduler-invoked, so verify_jwt is off and it checks a shared secret.
// Fails closed if the secret is unset.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const RETENTION_DAYS = 90;
const BATCH_SIZE = 500;
const MAX_BATCHES = 40;

// See the header. Not a tuning knob: shortening this deletes photos people
// just took.
const ORPHAN_GRACE_HOURS = 24;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (!CRON_SECRET) {
    console.error("CRON_SECRET is not set; refusing to run");
    return json({ error: "Not configured" }, 503);
  }
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let purged = 0;
  let batches = 0;

  try {
    for (let i = 0; i < MAX_BATCHES; i++) {
      const { data: expired, error: listError } = await admin.rpc(
        "job_list_expired_photos",
        { p_days: RETENTION_DAYS, p_limit: BATCH_SIZE },
      );

      if (listError) throw new Error(`list failed: ${listError.message}`);
      if (!expired || expired.length === 0) break;

      const paths = expired.map((r: { path: string }) => r.path).filter(Boolean);
      const ids = expired.map((r: { entry_id: string }) => r.entry_id);

      if (paths.length > 0) {
        const { error: removeError } = await admin.storage
          .from("checkin-photos")
          .remove(paths);
        // A missing object is not a failure — the desired end state is that it
        // is gone. Log and continue so one bad path cannot stall the sweep.
        if (removeError) {
          console.warn("storage remove reported an error", removeError.message);
        }
      }

      // Null photo_url only AFTER attempting removal. Reversed, a crash between
      // the two would leave rows claiming no photo while the objects lingered
      // in Storage with nothing pointing at them.
      const { error: markError } = await admin.rpc("job_mark_photos_purged", {
        p_entry_ids: ids,
      });
      if (markError) throw new Error(`mark failed: ${markError.message}`);

      purged += ids.length;
      batches++;
      if (expired.length < BATCH_SIZE) break;
    }

    // Sweeps 2 and 3 run after retention and are reported separately, so a
    // number that starts climbing is attributable. A rising orphan count means
    // the attach step is failing for real users; a rising missing count means
    // row deletes are.
    const swept = await sweepOrphans(admin);
    const cleared = await clearMissing(admin);

    return json({
      purged,
      batches,
      retention_days: RETENTION_DAYS,
      orphans_removed: swept,
      missing_cleared: cleared,
    });
  } catch (err) {
    console.error("purge-expired-photos failed", { purged, batches, err: String(err) });
    return json({ error: "Purge failed", detail: String(err), purged, batches }, 500);
  }
});

/** Objects nothing references, older than the grace window. */
async function sweepOrphans(admin: ReturnType<typeof createClient>): Promise<number> {
  let removed = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data, error } = await admin.rpc("job_list_orphan_photos", {
      p_grace_hours: ORPHAN_GRACE_HOURS,
      p_limit: BATCH_SIZE,
    });
    if (error) throw new Error(`orphan list failed: ${error.message}`);

    const names = (data ?? []).map((r: { name: string }) => r.name).filter(Boolean);
    if (names.length === 0) break;

    const { error: removeError } = await admin.storage
      .from("checkin-photos")
      .remove(names);
    // Same rule as the retention sweep: a missing object is the desired end
    // state, not a failure. Logged so one bad path cannot stall the loop.
    if (removeError) {
      console.warn("orphan remove reported an error", removeError.message);
    }

    removed += names.length;
    if (names.length < BATCH_SIZE) break;
  }

  return removed;
}

/**
 * Rows naming an object that is not there.
 *
 * No Storage call at all, which is why it is a single RPC rather than a loop
 * with a remove in it. The helper is limited per call, so it is repeated until
 * it stops finding rows.
 */
async function clearMissing(admin: ReturnType<typeof createClient>): Promise<number> {
  let cleared = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    const { data, error } = await admin.rpc("job_null_missing_photos", {
      p_limit: BATCH_SIZE,
    });
    if (error) throw new Error(`missing sweep failed: ${error.message}`);

    const n = Number(data ?? 0);
    cleared += n;
    if (n < BATCH_SIZE) break;
  }

  return cleared;
}
