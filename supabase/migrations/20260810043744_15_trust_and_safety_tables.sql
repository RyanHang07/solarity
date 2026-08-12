-- Solarity initial schema, step 2i: trust & safety
-- Architecture doc section 3 (`content_reports`), section 19 (`audit_log`),
-- section 20 item 11 (`user_blocks`)

create table public.content_reports (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE SET NULL on both parties: a report must outlive the accounts
  -- involved. Deleting an account should not erase the moderation record of
  -- what was reported, nor destroy a pending review.
  reporter_user_id uuid references public.users (id) on delete set null,
  reported_user_id uuid references public.users (id) on delete set null,

  content_type public.content_report_type not null,

  -- Captured verbatim at report time (Storage path for photos, the literal
  -- text for notes) so a later edit or deletion cannot undermine a pending
  -- review. Deliberately a snapshot, not a reference.
  content_reference text not null,

  reason text,
  status public.content_report_status not null default 'pending',

  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.users (id) on delete set null,

  -- A report cannot be reviewed before it was filed.
  constraint content_reports_reviewed_after_created
    check (reviewed_at is null or reviewed_at >= created_at),

  -- Terminal states must record when review happened; pending must not.
  constraint content_reports_status_matches_review
    check (
      (status = 'pending' and reviewed_at is null)
      or (status <> 'pending' and reviewed_at is not null)
    )
);

comment on table public.content_reports is
  'Reviewed via direct Supabase dashboard query at v1 scale; no admin UI. '
  'The reported user has no read access (see section 4) — revealing who '
  'reported what would enable retaliation.';
comment on column public.content_reports.content_reference is
  'Snapshot of the flagged content at report time, not a live reference.';

-- The moderation queue: pending reports, oldest first.
create index content_reports_pending_idx
  on public.content_reports (created_at)
  where status = 'pending';

create index content_reports_reported_user_idx
  on public.content_reports (reported_user_id);
create index content_reports_reporter_idx
  on public.content_reports (reporter_user_id);
create index content_reports_reviewed_by_idx
  on public.content_reports (reviewed_by);

-- Blocking. Distinct from kicking: a block prevents future contact, a kick
-- removes present membership. Kicking someone does NOT block them, which is
-- why the kick flow surfaces "also block this user?" as a deliberate second
-- step (section 20 item 11).
create table public.user_blocks (
  blocker_user_id uuid not null references public.users (id) on delete cascade,
  blocked_user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (blocker_user_id, blocked_user_id),

  constraint user_blocks_no_self_block
    check (blocker_user_id <> blocked_user_id)
);

comment on table public.user_blocks is
  'Directional: A blocking B is a separate row from B blocking A. Cascades on '
  'both sides — a block is meaningless once either party is gone.';

-- "Who has blocked me?" is needed server-side to filter invite-link joins.
create index user_blocks_blocked_idx on public.user_blocks (blocked_user_id);

-- Append-only record of privileged actions. No UPDATE or DELETE path is ever
-- expected; correcting a mistaken entry means writing a new one.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),

  -- SET NULL rather than CASCADE throughout: an audit trail that deletes
  -- itself when the actor leaves is not an audit trail.
  actor_user_id uuid references public.users (id) on delete set null,
  group_id uuid references public.groups (id) on delete set null,
  target_user_id uuid references public.users (id) on delete set null,

  action_type public.audit_action_type not null,

  -- Action-specific detail, e.g. old/new deadline on group_deadline_changed.
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

comment on table public.audit_log is
  'Append-only. Covers privileged actions that do not already carry their own '
  'history elsewhere — content_reports (status/reviewed_at/reviewed_by) and '
  'username changes (username_history) are deliberately not duplicated here.';

-- Primary read pattern: one group's history, newest first.
create index audit_log_group_created_idx
  on public.audit_log (group_id, created_at desc);

create index audit_log_actor_idx on public.audit_log (actor_user_id);
create index audit_log_target_idx on public.audit_log (target_user_id);;
