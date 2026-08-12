// Solarity — web push delivery for pending notifications.
//
// The SQL half already wrote the in-app notification rows. This only DELIVERS
// them. Keeping the two separate means a push outage never blocks the in-app
// feed, and either half can be re-run without corrupting the other.
//
// Teaser payloads only. iOS truncates long bodies, and a detailed body risks
// surfacing hidden-goal-adjacent information on a lock screen — outside the
// app's access controls entirely. Circle names are deliberately kept out of
// push bodies for the same reason, even though the payload carries them for
// in-app rendering.
//
// AUTH: scheduler-invoked, so verify_jwt is off and it checks a shared secret.
// Fails closed if the secret is unset.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY");
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@solarity.app";

const BATCH = 500;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function teaser(type: string, payload: Record<string, unknown>): { title: string; body: string } {
  switch (type) {
    case "digest": {
      const done = Number(payload.completed_count ?? 0);
      const total = Number(payload.member_count ?? 0);
      if (done === 0) return { title: "Solarity", body: "Nobody checked in yesterday — tap to see" };
      if (done === total) return { title: "Solarity", body: "Everyone checked in yesterday — tap to see" };
      return { title: "Solarity", body: `${done} of ${total} checked in yesterday — tap to see` };
    }
    case "deadline_changed":
      return payload.cleared
        ? { title: "Solarity", body: "A circle is now open-ended — tap to see" }
        : { title: "Solarity", body: "A circle's deadline changed — tap to see" };
    case "kicked":
      return { title: "Solarity", body: "There's an update about one of your circles" };
    case "group_locked_renewal":
      return { title: "Solarity", body: "A circle's cycle has ended — tap to decide what's next" };
    case "invite_accepted":
      return { title: "Solarity", body: "Someone joined your circle" };
    default:
      return { title: "Solarity", body: "You have a new notification" };
  }
}

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
  if (!pending || pending.length === 0) return json({ sent: 0, delivered: 0, pruned: 0 });

  const userIds = [...new Set(pending.map((n) => n.user_id))];

  const { data: subs, error: subsError } = await admin
    .from("push_subscriptions")
    .select("id, user_id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  if (subsError) {
    console.error("failed to read subscriptions", subsError.message);
    return json({ error: "Query failed", detail: subsError.message }, 500);
  }

  const byUser = new Map<string, typeof subs>();
  for (const s of subs ?? []) {
    const list = byUser.get(s.user_id) ?? [];
    list.push(s);
    byUser.set(s.user_id, list);
  }

  const deadSubscriptionIds: string[] = [];
  const handledNotificationIds: string[] = [];
  let delivered = 0;

  for (const n of pending) {
    const targets = byUser.get(n.user_id) ?? [];

    // No subscription is not a failure. On iOS push only works for an installed
    // PWA, so many users legitimately have none. Mark it handled so it isn't
    // retried forever — the in-app row is the durable channel.
    if (targets.length === 0) {
      handledNotificationIds.push(n.id);
      continue;
    }

    const { title, body } = teaser(n.type, n.payload ?? {});
    const message = JSON.stringify({
      title,
      body,
      data: { notification_id: n.id, ...(n.payload ?? {}) },
    });

    // Fan out to every device — a user may have the PWA on phone and laptop.
    for (const t of targets) {
      try {
        await webpush.sendNotification(
          { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          message,
        );
        delivered++;
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

    handledNotificationIds.push(n.id);
  }

  if (deadSubscriptionIds.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", deadSubscriptionIds);
  }

  if (handledNotificationIds.length > 0) {
    await admin
      .from("notifications")
      .update({ pushed_at: new Date().toISOString() })
      .in("id", handledNotificationIds);
  }

  return json({ sent: pending.length, delivered, pruned: deadSubscriptionIds.length });
});
