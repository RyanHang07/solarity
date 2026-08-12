-- Solarity initial schema, step 2h: notifications, push delivery, digests
-- Architecture doc section 3, plus sections 5 and 6

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type public.notification_type not null,

  -- Written once at generation time and never recomputed. The digest job must
  -- denormalize usernames INTO this payload rather than joining live: a
  -- chronological feed that silently relabels itself when someone renames
  -- would misrepresent history. See section 3, username changes.
  payload jsonb not null default '{}'::jsonb,

  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on column public.notifications.payload is
  'Immutable snapshot. Denormalize usernames at write time; never join live.';

-- The notifications tab reads one user's feed newest-first.
create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- The unread badge counts only unread rows, which stay a small fraction of the
-- table over time. Partial index keeps that count cheap permanently.
create index notifications_unread_idx
  on public.notifications (user_id)
  where read_at is null;

-- Web Push (VAPID) subscriptions. One row per device, so a user with the PWA
-- installed on a phone and a laptop has two.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,

  -- Browser-provided push endpoint. Globally unique: the same endpoint must
  -- never be registered twice, or that device receives duplicate pushes.
  endpoint text not null unique,

  -- Required by the Web Push protocol for payload encryption.
  p256dh text not null,
  auth text not null,

  -- Cosmetic, so a user can tell their own devices apart in settings.
  device_label text,

  created_at timestamptz not null default now()
);

comment on table public.push_subscriptions is
  'On iOS, push only works for a PWA added to the home screen (16.4+). A user '
  'in a plain browser tab silently has no subscription row at all, which is '
  'why onboarding must include an explicit add-to-home-screen step.';

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- One computed summary per group per day. The Overview subtab and the daily
-- push notification both read this same row, so the in-app summary and the
-- notification can never disagree.
create table public.digest_snapshots (
  group_id uuid not null references public.groups (id) on delete cascade,
  date date not null,

  -- Per-member completion status and streak deltas. Same immutability rule as
  -- notifications.payload: usernames are baked in at write time.
  summary jsonb not null,

  created_at timestamptz not null default now(),

  primary key (group_id, date)
);

comment on column public.digest_snapshots.summary is
  'Immutable snapshot, same denormalization rule as notifications.payload.';;
