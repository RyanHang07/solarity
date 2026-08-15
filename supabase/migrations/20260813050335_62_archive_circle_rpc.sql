-- archive_circle: the only deliberate way to retire a Circle.
--
-- THE HOLE THIS CLOSES. Before this, a Circle could only become 'archived'
-- through handle_membership_removal, on the succession path when the last
-- member leaves. But an owner can never be the one to leave: the group_members
-- DELETE policy is `role <> 'owner'`. So for a Circle of one, that path was
-- unreachable, and the owner had no exit at all:
--
--   archive  -  group_status is not in the authenticated UPDATE grant
--   leave    -  blocked by the DELETE policy
--   transfer -  needs a target member, and there is none
--   delete   -  authenticated holds no DELETE on groups
--
-- Every Circle a person created and did not fill was permanent. The first
-- thing anyone does is make a test Circle, so this was reachable on day one.
--
-- WHY AN RPC RATHER THAN A COLUMN GRANT. Archiving is three writes that must
-- happen together: the status, closing the open cycle, and the audit row.
-- Granting UPDATE on group_status would let a client do the first without the
-- others, leaving an archived Circle with a cycle still open, which
-- run_daily_rollover would keep processing.
--
-- WHAT IT DELIBERATELY DOES NOT DO:
--
--   Disable invite links.  trg_disable_links_on_status_change already does
--   this on any move away from 'active'. Duplicating it here would mean two
--   places to keep correct.
--
--   Remove members.  They stay in group_members so the Circle keeps appearing
--   in their Archived list with its history intact. Archiving retires a
--   Circle; it does not evict people from it.
--
--   Notify anyone.  That needs a new notification_type value, a writer and a
--   digest teaser, in separate migrations. Members see the Circle move to
--   Archived on their next visit. Worth revisiting.
--
-- NOT REVERSIBLE. Un-archiving would have to decide whether to reopen the old
-- cycle or start a new one, and cycle_reset already covers wanting to run
-- again. Left out rather than guessed at.

create or replace function public.archive_circle(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status public.group_status;
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  -- Locked before reading the status, so two simultaneous archive attempts
  -- cannot both see 'active' and both proceed.
  select group_status into v_status
  from public.groups where id = p_group_id
  for update;

  -- Indistinguishable from "not the owner" below, deliberately: a caller who
  -- is not a member should not learn whether the Circle exists.
  if v_status is null then
    raise exception 'Only the owner can archive a Circle'
      using errcode = 'insufficient_privilege', hint = 'NOT_OWNER';
  end if;

  -- Owner only. An admin can manage members and links, but retiring the Circle
  -- is the one act with no undo, so it stays with the person who owns it.
  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = v_uid
      and gm.role = 'owner'
  ) then
    raise exception 'Only the owner can archive a Circle'
      using errcode = 'insufficient_privilege', hint = 'NOT_OWNER';
  end if;

  if v_status = 'archived' then
    raise exception 'That Circle is already archived'
      using errcode = 'invalid_parameter_value', hint = 'ALREADY_ARCHIVED';
  end if;

  -- Close the open cycle. Without this, run_daily_rollover keeps selecting it
  -- (it filters on ended_at is null, not on group_status) and would go on
  -- advancing a group streak nobody can contribute to.
  update public.group_cycles
  set ended_at = now()
  where group_id = p_group_id and ended_at is null;

  update public.groups
  set group_status = 'archived'
  where id = p_group_id;

  insert into public.audit_log (actor_user_id, group_id, action_type, metadata)
  values (v_uid, p_group_id, 'group_archived',
          jsonb_build_object('previous_status', v_status));
end;
$function$;

revoke execute on function public.archive_circle(uuid) from public, anon;
grant execute on function public.archive_circle(uuid) to authenticated;

comment on function public.archive_circle(uuid) is
  'Owner-only. Retires a Circle: closes the open cycle, sets status archived, '
  'audits. Invite links are disabled by trigger. Not reversible.';;
