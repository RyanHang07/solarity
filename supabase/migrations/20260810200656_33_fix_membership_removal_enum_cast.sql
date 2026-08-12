-- Fix: a CASE expression yielding text literals does not implicitly cast to an
-- enum column type, so the membership-removal trigger errored on every DELETE.
-- Caught immediately by test, but worth noting that it would have made leaving
-- or kicking impossible in production rather than merely un-audited.

create or replace function public.handle_membership_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_self boolean := (v_uid is not null and v_uid = old.user_id);
begin
  insert into public.audit_log (actor_user_id, group_id, target_user_id, action_type, metadata)
  values (
    v_uid,
    old.group_id,
    old.user_id,
    (case when v_self then 'member_left' else 'member_kicked' end)::public.audit_action_type,
    jsonb_build_object('role_at_removal', old.role)
  );

  -- Being removed by someone else costs leaderboard standing, including for a
  -- member who later rejoins (section 21). Leaving voluntarily does not.
  if not v_self then
    update public.group_member_category_stats
    set total_completions = 0, total_possible = 0,
        current_streak = 0, longest_streak = 0
    where group_id = old.group_id and user_id = old.user_id;
  end if;

  return old;
end;
$$;;
