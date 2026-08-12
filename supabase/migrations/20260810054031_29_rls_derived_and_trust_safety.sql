-- Solarity RLS, steps 4g + 4h
-- group_cycle_stats, group_daily_completion, group_member_category_stats,
-- digest_snapshots, content_reports, audit_log

-- Two of the derived tables key off cycle_id rather than group_id (they were
-- normalized that way in step 2g), so membership has to be reached through
-- group_cycles.
create function private.is_cycle_member(p_cycle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_cycles gc
    join public.group_members gm on gm.group_id = gc.group_id
    where gc.id = p_cycle_id
      and gm.user_id = (select auth.uid())
  );
$$;

grant execute on function private.is_cycle_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4g: group-scoped derived tables — read by members, written only by jobs
-- ---------------------------------------------------------------------------

create policy group_cycle_stats_select_member on public.group_cycle_stats
  for select to authenticated
  using (private.is_cycle_member(cycle_id));

create policy group_daily_completion_select_member on public.group_daily_completion
  for select to authenticated
  using (private.is_cycle_member(cycle_id));

create policy gmcs_select_member on public.group_member_category_stats
  for select to authenticated
  using (private.is_group_member(group_id));

create policy digest_snapshots_select_member on public.digest_snapshots
  for select to authenticated
  using (private.is_group_member(group_id));

grant select on public.group_cycle_stats to authenticated;
grant select on public.group_daily_completion to authenticated;
grant select on public.group_member_category_stats to authenticated;
grant select on public.digest_snapshots to authenticated;

-- No INSERT / UPDATE / DELETE anywhere in 4g. Every one of these is derived:
-- streaks and completion come from the 2 AM rollover, leaderboard counters from
-- check-in triggers, digests from the daily job — all under service_role. A
-- client that could write here could fabricate its own leaderboard standing.

-- ---------------------------------------------------------------------------
-- 4h: trust & safety
-- ---------------------------------------------------------------------------

-- A reporter can follow their own submissions. The reported user gets nothing:
-- revealing who reported what would undermine reporting and invite retaliation
-- (section 4).
create policy content_reports_select_own_submissions on public.content_reports
  for select to authenticated
  using (reporter_user_id = (select auth.uid()));

-- You may only report someone you share a circle with. Without this the table
-- is a harassment vector against strangers, and the moderation queue fills with
-- reports about content the reporter could never have seen.
create policy content_reports_insert_own on public.content_reports
  for insert to authenticated
  with check (
    reporter_user_id = (select auth.uid())
    and reported_user_id <> (select auth.uid())
    and private.shares_group_with(reported_user_id)
  );

grant select on public.content_reports to authenticated;

-- status, reviewed_at and reviewed_by are omitted: a report is filed pending and
-- only moderation may resolve it. Their absence from the grant means a
-- pre-resolved report cannot be submitted.
grant insert (reporter_user_id, reported_user_id, content_type, content_reference, reason)
  on public.content_reports to authenticated;

-- No UPDATE (review happens under service_role via the Supabase dashboard at v1
-- scale) and no DELETE (a reporter withdrawing a report would destroy evidence
-- mid-review).

-- Hardening: self-reports are meaningless and would pollute the queue.
alter table public.content_reports
  add constraint content_reports_no_self_report
  check (reporter_user_id is distinct from reported_user_id);

-- audit_log: no policy, no grant, deliberately.
-- Section 4 specifies no client-facing read policy for v1 — there is no admin
-- UI to display it, it is written by trusted server-side paths, and it is the
-- durable record that notification deletion was allowed to rely on. Like
-- username_history, RLS-enabled-with-zero-policies is the intended end state and
-- its linter notice is permanent and correct.

comment on table public.audit_log is
  'Append-only. No client access by design: no policy, no grant, service_role '
  'only. The rls_enabled_no_policy linter notice for this table is expected and '
  'should not be "fixed". This is the durable history that lets notifications '
  'be user-deletable.';;
