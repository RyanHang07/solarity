-- Solarity: align progress_entries with section 16 (deletion & export), and
-- enforce the denormalized owner column.

-- 1. Check-ins must survive account deletion in anonymized form, since other
--    members' historical group stats are computed against them. Cascading
--    deletes contradicted that, so both foreign keys become nullable with
--    ON DELETE SET NULL. A surviving row keeps its date, note, and photo
--    reference while losing its attribution.
--
--    The Edge Function described in section 16 still does the substantive
--    work (purging Storage objects, scrubbing note text). These constraints
--    only guarantee the rows themselves are not silently swept away first.

alter table public.progress_entries
  drop constraint progress_entries_goal_id_fkey,
  drop constraint progress_entries_user_id_fkey;

alter table public.progress_entries
  alter column goal_id drop not null,
  alter column user_id drop not null;

alter table public.progress_entries
  add constraint progress_entries_goal_id_fkey
    foreign key (goal_id) references public.goals (id) on delete set null,
  add constraint progress_entries_user_id_fkey
    foreign key (user_id) references public.users (id) on delete set null;

comment on column public.progress_entries.goal_id is
  'Nullable only for anonymized rows retained after deletion. A live check-in '
  'always has a goal.';
comment on column public.progress_entries.user_id is
  'Denormalized from goals.user_id and validated by trigger. Nullable only for '
  'anonymized rows retained after deletion (section 16).';

-- The unique constraint on (goal_id, check_in_date) is unaffected in a useful
-- way: NULLs are distinct in Postgres, so any number of anonymized rows can
-- coexist without colliding.

-- 2. Enforce that the denormalized user_id actually matches the goal's owner.
--    This column exists to avoid a join on the hottest read path in the app,
--    but a denormalized value with nothing checking it is exactly how data
--    quietly goes wrong. Validation is skipped for anonymized rows, where the
--    mismatch is intentional.
create function public.validate_progress_entry_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  goal_owner uuid;
begin
  if new.goal_id is null or new.user_id is null then
    return new;  -- anonymized row, nothing to reconcile
  end if;

  select g.user_id into goal_owner
  from public.goals g
  where g.id = new.goal_id;

  if goal_owner is distinct from new.user_id then
    raise exception
      'progress_entries.user_id (%) does not match the owner of goal % (%)',
      new.user_id, new.goal_id, goal_owner
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_progress_entry_owner()
  from anon, authenticated, public;

create trigger progress_entries_validate_owner
  before insert or update of goal_id, user_id on public.progress_entries
  for each row execute function public.validate_progress_entry_owner();;
