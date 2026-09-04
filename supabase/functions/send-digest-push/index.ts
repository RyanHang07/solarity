// Solarity — web push delivery.
//
// Two sources, one delivery path, and the split is migration 112:
//
//   * **Events** — `notifications` rows the SQL half already wrote. This only
//     DELIVERS them, so a push outage never blocks the in-app feed and either
//     half can be re-run without corrupting the other. `pushed_at` on the row
//     is the delivery record.
//   * **Digests** — read straight from `digest_snapshots`, with delivery
//     recorded in `digest_pushes`. There is no notification row to find; the
//     snapshot *is* the digest, and who should hear about it is a question
//     answered here, against live membership, rather than frozen at build time.
//
// **Why digests moved.** A digest row in `notifications` was rendered nowhere
// after step 11c — the day boxes on Overview replaced the list — so it existed
// only to be found by this function. Three separate readers (the tab, the
// badge, mark-read) each had to remember to exclude it, and a type filter is
// not a boundary. See migration 112.
//
// Teaser payloads only. iOS truncates long bodies, and a detailed body risks
// surfacing hidden-goal-adjacent information on a lock screen — outside the
// app's access controls entirely. **A goal is never named here, ever.**
//
// Circle names WERE kept out for the same reason, and 10g reversed that with a
// per-account setting: without a name, four Circles produce four notifications
// that read identically, which is not a prompt but noise. `users
// .push_shows_circle_name` decides, defaulting to on. The words themselves live
// in teaser.ts so they can be unit-tested.
//
// AUTH: scheduler-invoked, so verify_jwt is off and it checks a shared secret.
// Fails closed if the secret is unset.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { teaser } from "./teaser.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@solarity.app";

const BATCH = 500;

/**
 * How far back a digest is still worth pushing.
 *
 * **The delivery record is per member, so without a window a backlog is
 * permanent.** The old design could not have this problem: a notification row
 * existed or it did not, and `run_retention_sweep` eventually removed it.
 * Reading snapshots directly means a Circle whose members all lacked a
 * subscription for a week would come back into view the moment one appeared,
 * and deliver seven days of "yesterday" at once.
 *
 * Three days covers a scheduler that missed a run or two, which is the case
 * worth surviving. Older than that is not news, and a notification that is not
 * news is the thing this project has twice decided not to send.
 */
const DIGEST_WINDOW_DAYS = 3;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Sub = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

Deno.serve(async (req: Request) => {
  if (!CRON_SECRET) {
    console.error("CRON_SECRET is not set; refusing to run");
    return json({ error: "Not configured" }, 503);
  }
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "Forbidden" }, 403);
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.error("VAPID keys are not set; refusing to run");
    return json({ error: "Not configured" }, 503);
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── what is waiting ────────────────────────────────────────────────────────

  const { data: pending, error: pendingError } = await admin
    .from("notifications")
    .select("id, user_id, type, payload")
    .is("pushed_at", null)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (pendingError) {
    console.error("failed to read pending notifications", pendingError.message);
    return json({ error: "Query failed", detail: pendingError.message }, 500);
  }

  const since = new Date(Date.now() - DIGEST_WINDOW_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const { data: snapshots, error: snapshotsError } = await admin
    .from("digest_snapshots")
    .select("group_id, date, summary, groups(name)")
    .gte("date", since)
    .order("date", { ascending: true });

  if (snapshotsError) {
    console.error("failed to read digest snapshots", snapshotsError.message);
    return json({ error: "Query failed", detail: snapshotsError.message }, 500);
  }

  /**
   * **Who a digest is for, resolved now rather than at build time.**
   *
   * `build_daily_digests` used to fan out to `group_members` as it wrote, which
   * froze the audience at the moment the snapshot was built. Reading membership
   * here means somebody who joined overnight gets the digest for the day they
   * joined — a small thing that the old shape simply could not do.
   *
   * It also means somebody who *left* stops receiving them, which the old shape
   * also could not do: their row was already written and addressed to them.
   */
  const digestGroupIds = [...new Set((snapshots ?? []).map((s) => s.group_id))];

  const { data: members, error: membersError } = digestGroupIds.length
    ? await admin
        .from("group_members")
        .select("group_id, user_id")
        .in("group_id", digestGroupIds)
    : { data: [], error: null };

  if (membersError) {
    console.error("failed to read Circle membership", membersError.message);
    return json({ error: "Query failed", detail: membersError.message }, 500);
  }

  const { data: alreadySent, error: sentError } = digestGroupIds.length
    ? await admin
        .from("digest_pushes")
        .select("group_id, date, user_id")
        .in("group_id", digestGroupIds)
        .gte("date", since)
    : { data: [], error: null };

  if (sentError) {
    console.error("failed to read digest delivery records", sentError.message);
    return json({ error: "Query failed", detail: sentError.message }, 500);
  }

  // Composite keys are awkward to filter server-side and trivial here: the
  // window bounds this to a few days of a handful of Circles.
  const delivered = new Set(
    (alreadySent ?? []).map((r) => `${r.group_id}|${r.date}|${r.user_id}`),
  );

  const byGroup = new Map<string, string[]>();
  for (const m of members ?? []) {
    const list = byGroup.get(m.group_id) ?? [];
    list.push(m.user_id);
    byGroup.set(m.group_id, list);
  }

  type DigestTarget = {
    group_id: string;
    date: string;
    user_id: string;
    payload: Record<string, unknown>;
  };

  const digestTargets: DigestTarget[] = [];
  for (const snapshot of snapshots ?? []) {
    const summary = (snapshot.summary ?? {}) as Record<string, unknown>;
    // `groups(name)` comes back as an object or an array depending on how
    // PostgREST resolves the relationship; both are handled rather than
    // assumed, because the fallback is a nameless push rather than a crash.
    const related = snapshot.groups as unknown;
    const circleName = Array.isArray(related)
      ? (related[0] as { name?: string } | undefined)?.name
      : (related as { name?: string } | null)?.name;

    for (const userId of byGroup.get(snapshot.group_id) ?? []) {
      if (delivered.has(`${snapshot.group_id}|${snapshot.date}|${userId}`)) {
        continue;
      }
      digestTargets.push({
        group_id: snapshot.group_id,
        date: snapshot.date,
        user_id: userId,
        payload: {
          group_id: snapshot.group_id,
          circle_name: circleName ?? null,
          date: snapshot.date,
          completed_count: summary.completed_count,
          member_count: summary.member_count,
          group_streak: summary.group_streak,
        },
      });
    }
  }

  if ((pending?.length ?? 0) === 0 && digestTargets.length === 0) {
    return json({ sent: 0, digests: 0, delivered: 0, pruned: 0 });
  }

  // ── everything the delivery loop needs, in two queries ─────────────────────

  const userIds = [
    ...new Set([
      ...(pending ?? []).map((n) => n.user_id),
      ...digestTargets.map((d) => d.user_id),
    ]),
  ];

  const { data: subs, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  if (subsError) {
    console.error("failed to read subscriptions", subsError.message);
    return json({ error: "Query failed", detail: subsError.message }, 500);
  }

  // One query for the batch, not one per notification. The sender did not read
  // `users` at all before 10g; this keeps that cost at a single round trip
  // however many notifications are pending.
  const { data: prefs, error: prefsError } = await admin
    .from("users")
    .select("id, push_shows_circle_name")
    .in("id", userIds);

  if (prefsError) {
    console.error("failed to read notification preferences", prefsError.message);
    return json({ error: "Query failed", detail: prefsError.message }, 500);
  }

  // Absent means on, matching the column default. A user row that somehow did
  // not come back should get the useful notification, not the blank one.
  const showsName = new Map<string, boolean>();
  for (const u of prefs ?? []) showsName.set(u.id, u.push_shows_circle_name !== false);

  const byUser = new Map<string, Sub[]>();
  for (const s of (subs ?? []) as Sub[]) {
    const list = byUser.get(s.user_id) ?? [];
    list.push(s);
    byUser.set(s.user_id, list);
  }

  const deadSubscriptionIds: string[] = [];
  let deliveredCount = 0;

  /**
   * Send one message to every device a person has.
   *
   * **Returns whether it was handled, not whether it arrived.** No subscription
   * is not a failure: on iOS push only works for an installed PWA, so many
   * accounts legitimately have none, and a delivery that is retried forever is
   * worse than one that is recorded as done. Both callers record the attempt
   * either way — the in-app row, or the snapshot, is the durable channel.
   */
  const sendTo = async (
    userId: string,
    type: string,
    payload: Record<string, unknown>,
    seed: string,
  ): Promise<void> => {
    const targets = byUser.get(userId) ?? [];
    if (targets.length === 0) return;

    const { title, body } = teaser(type, payload, showsName.get(userId) ?? true, seed);
    const message = JSON.stringify({
      title,
      body,
      // **`type` explicitly, and it has never been here.** `sw.js` branches on
      // `d.type === "digest"` to open a Circle's Overview tab, and `data` was
      // only ever `{ notification_id, ...payload }` — no payload has ever
      // carried a `type` key. Spread last would let a payload key shadow it;
      // spread first means the real type wins.
      data: { notification_id: seed, ...payload, type },
    });

    for (const t of targets) {
      try {
        await webpush.sendNotification(
          { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          message,
        );
        deliveredCount++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410 mean the browser permanently discarded this subscription.
        // Pruning is required maintenance: dead endpoints otherwise accumulate
        // forever and every future send retries them.
        if (status === 404 || status === 410) {
          deadSubscriptionIds.push(t.id);
        } else {
          console.warn(`push failed for subscription ${t.id}`, status, String(err));
        }
      }
    }
  };

  // ── events ─────────────────────────────────────────────────────────────────

  const handledNotificationIds: string[] = [];
  for (const n of pending ?? []) {
    // `n.id` seeds the copy variance added in 18f: one stable sentence per
    // notification, so a retry says what the first attempt said.
    await sendTo(n.user_id, n.type, (n.payload ?? {}) as Record<string, unknown>, n.id);
    handledNotificationIds.push(n.id);
  }

  // ── digests ────────────────────────────────────────────────────────────────

  for (const d of digestTargets) {
    /**
     * **The seed is the delivery key, and it has to be.** 18f's copy variance
     * is stable per message so a retry says what the first attempt said, and
     * the seed used to be the notification's uuid. There is no row now, so the
     * three things that identify this digest stand in — same Circle, same day,
     * same person, same sentence, however many times it is attempted.
     */
    await sendTo(d.user_id, "digest", d.payload, `${d.group_id}|${d.date}|${d.user_id}`);
  }

  // ── record what happened ───────────────────────────────────────────────────

  if (deadSubscriptionIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", deadSubscriptionIds);
  }

  if (handledNotificationIds.length > 0) {
    await admin
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .in("id", handledNotificationIds);
  }

  if (digestTargets.length > 0) {
    /**
     * **Written even for accounts with no subscription**, which is the same
     * rule `pushed_at` follows for events and the reason it is worth stating:
     * without it, every member without a device would be reconsidered on every
     * run for three days, and the only thing bounding the work would be the
     * window.
     *
     * `ignoreDuplicates` because two overlapping runs are a scheduler
     * misconfiguration rather than an error, and the second one has nothing to
     * add. The primary key is what makes that safe.
     */
    const { error: recordError } = await admin.from("digest_pushes").upsert(
      digestTargets.map((d) => ({
        group_id: d.group_id,
        date: d.date,
        user_id: d.user_id,
      })),
      { onConflict: "group_id,date,user_id", ignoreDuplicates: true },
    );

    if (recordError) {
      // Logged loudly rather than swallowed: the pushes went out, and a failure
      // here means they will go out again tomorrow. That is the one duplicate
      // this design can produce, and it should be visible.
      console.error("failed to record digest delivery", recordError.message);
    }
  }

  return json({
    sent: pending?.length ?? 0,
    digests: digestTargets.length,
    delivered: deliveredCount,
    pruned: deadSubscriptionIds.length,
  });
});
