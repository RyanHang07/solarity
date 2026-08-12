-- Refinement: distinguish account deletion from a kick.
--
-- The previous logic decided via `auth.uid() = old.user_id`. During an
-- account-deletion cascade auth.uid() is null (service_role) or belongs to
-- whoever's session happens to be active, so a self-initiated account deletion
-- was being recorded as `member_kicked` — which also wrongly implies a
-- moderation action and, per section 21, would zero leaderboard stats as a
-- penalty.
--
-- The reliable signal is whether the target user row still exists. If it is
-- gone, the membership row is disappearing because the account is, which is a
-- departure, not a removal by someone else.

create or replace function public.handle_membership_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_actor uuid;
  v_target uuid;
  v_account_deleted boolean;
  v_self boolean;
  v_action public.audit_action_type;
  v_successor uuid;
begin
  select id into v_actor  from public.users where id = v_uid;
  select id into v_target from public.users where id = old.user_id;

  v_account_deleted := (v_target is null);
  v_self := (v_uid is not null and v_uid = old.user_id);

  v_action := case
    when v_account_deleted then 'member_left'   -- the account itself is going
    when v_self           then 'member_left'    -- voluntary departure
    else                       'member_kicked'  -- removed by someone else
  end;

  insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
  values (
    case when v_account_deleted then null else v_actor end,
    old.group_id,
    v_target,
    v_action,
    jsonb_build_object(
      'role_at_removal', old.role,
      'via', case when v_account_deleted then 'account_deletion'
                  when v_self then 'left' else 'kicked' end
    )
  );

  -- Only a genuine kick costs leaderboard standing (section 21). Leaving
  -- voluntarily does not, and neither does deleting an account — those rows
  -- cascade away with the user regardless.
  if v_action = 'member_kicked' then
    update public.group_member_category_stats
    set total_completions = 0, total_possible = 0,
        current_streak = 0, longest_streak = 0
    where group_id = old.group_id and user_id = old.user_id;
  end if;

  -- Owner succession: promote the longest-tenured remaining member, or archive
  -- the circle if nobody is left. An ownerless circle is unrecoverable, so this
  -- is written defensively even though RLS already blocks a normal owner exit.
  if old.role = 'owner' then
    select gm.user_id into v_successor
    from public.group_members gm
    where gm.group_id = old.group_id
    order by gm.joined_at asc
    limit 1;

    if v_successor is not null then
      update public.group_members set role = 'owner'
      where group_id = old.group_id and user_id = v_successor;

      insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
      values (null, old.group_id, v_successor, 'ownership_transferred',
              jsonb_build_object('reason', 'owner_departed', 'automatic', true));
    else
      update public.groups set group_status = 'archived' where id = old.group_id;
    end if;
  end if;

  return old;
end;
$$;;
