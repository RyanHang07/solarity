-- Two bugs found by probing account deletion.
--
-- BUG 1 (critical): handle_membership_removal() inserted an audit_log row
-- referencing auth.uid() and old.user_id. During an account-deletion cascade
-- those users are already gone, so the FK check failed and the entire DELETE
-- aborted. Account deletion was impossible, not merely un-audited.
--
-- BUG 2: dropping groups.owner_id in migration 08 also dropped its ON DELETE
-- RESTRICT, which had been the only thing preventing a circle from losing its
-- owner. group_members cascades on user delete, so an owner's row vanished and
-- the circle survived with nobody able to rename it, manage invites, transfer
-- ownership, or reset the cycle. Unrecoverable for the remaining members.

create or replace function public.handle_membership_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_self boolean := (v_uid is not null and v_uid = old.user_id);
  v_actor uuid;
  v_target uuid;
  v_successor uuid;
begin
  -- Only reference users that still exist. During an account-deletion cascade
  -- the actor and/or target row is already gone, and audit_log's FKs are
  -- SET NULL (which protects existing rows) not deferred (which would allow
  -- inserting a dangling reference). Null them explicitly.
  select id into v_actor  from public.users where id = v_uid;
  select id into v_target from public.users where id = old.user_id;

  insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
  values (
    v_actor,
    old.group_id,
    v_target,
    (case when v_self then 'member_left' else 'member_kicked' end)::public.audit_action_type,
    jsonb_build_object(
      'role_at_removal', old.role,
      'via', case when v_target is null then 'account_deletion' else 'membership_change' end
    )
  );

  if not v_self then
    update public.group_member_category_stats
    set total_completions = 0, total_possible = 0,
        current_streak = 0, longest_streak = 0
    where group_id = old.group_id and user_id = old.user_id;
  end if;

  -- Owner succession. If the departing member was the owner and the circle
  -- still has members, promote the longest-tenured one rather than leaving the
  -- circle unmanageable. Normal owner departures are already blocked by the
  -- RLS policy (role <> 'owner'), so in practice this only fires on account
  -- deletion — but it is written defensively because an ownerless circle is
  -- unrecoverable and there is no second chance to notice.
  if old.role = 'owner' then
    select gm.user_id into v_successor
    from public.group_members gm
    where gm.group_id = old.group_id
    order by gm.joined_at asc
    limit 1;

    if v_successor is not null then
      update public.group_members
      set role = 'owner'
      where group_id = old.group_id and user_id = v_successor;

      insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
      values (null, old.group_id, v_successor, 'ownership_transferred',
              jsonb_build_object('reason', 'owner_departed', 'automatic', true));
    else
      -- Last member gone: archive rather than leave an empty active circle.
      update public.groups set group_status = 'archived' where id = old.group_id;
    end if;
  end if;

  return old;
end;
$$;;
