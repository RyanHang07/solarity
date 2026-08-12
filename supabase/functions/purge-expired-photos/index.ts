// Solarity — check-in photo retention (architecture doc section 9).
//
// Deletes check-in photos older than 90 days. The check-in row and every
// statistic derived from it SURVIVE; only the image is removed and photo_url is
// nulled.
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

    return json({ purged, batches, retention_days: RETENTION_DAYS });
  } catch (err) {
    console.error("purge-expired-photos failed", { purged, batches, err: String(err) });
    return json({ error: "Purge failed", detail: String(err), purged, batches }, 500);
  }
});
