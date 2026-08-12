-- Helpers and guards required by step 4f.

-- Role of a specific member. Needed because "admins may kick anyone except the
-- owner" is a statement about the TARGET row's role, not the actor's.
create function private.member_role(p_group_id uuid, p_user_id uuid)
returns public.group_member_role
language sql
stable
security definer
set search_path = ''
as $$
  select gm.role
  from public.group_members gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id;
$$;

grant execute on function private.member_role(uuid, uuid) to authenticated;

-- Column grants are per-ROLE, not per-policy, so GRANT cannot express "admins
-- may edit name, but only the owner may edit the leaderboard settings". A
-- trigger can: it sees which columns actually changed and who is changing them.
create function public.guard_group_owner_only_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- service_role and internal jobs have no auth.uid(); leave them alone.
  if (select auth.uid()) is null then
    return new;
  end if;

  if (new.leaderboard_persists_across_cycles is distinct from old.leaderboard_persists_across_cycles
      or new.default_stats_view is distinct from old.default_stats_view)
     and not private.is_group_owner(new.id)
  then
    raise exception 'Only the circle owner may change leaderboard settings'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_group_owner_only_settings()
  from anon, authenticated, public;

create trigger groups_guard_owner_only_settings
  before update on public.groups
  for each row execute function public.guard_group_owner_only_settings();;
