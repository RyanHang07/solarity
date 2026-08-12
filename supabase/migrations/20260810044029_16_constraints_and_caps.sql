-- Solarity initial schema, step 2j: length caps, format rules, count caps
-- Architecture doc section 18 item 5, section 9, section 20 item 12

-- ---------------------------------------------------------------------------
-- Length and format caps, enforced at the database rather than only client-side
-- ---------------------------------------------------------------------------

-- Alphanumeric + underscore only: no unicode lookalikes, which closes off a
-- cheap impersonation trick inside small groups. Uniqueness is already
-- case-insensitive (users_username_lower_key).
alter table public.users
  add constraint users_username_format
  check (
    username is null
    or (char_length(username) between 3 and 30 and username ~ '^[A-Za-z0-9_]+$')
  );

alter table public.users
  add constraint users_name_lengths
  check (
    (first_name is null or char_length(first_name) <= 100)
    and (last_name is null or char_length(last_name) <= 100)
  );

alter table public.goals
  add constraint goals_title_length
  check (char_length(title) between 1 and 100);

alter table public.progress_entries
  add constraint progress_entries_note_length
  check (note is null or char_length(note) <= 500);

alter table public.groups
  add constraint groups_name_length
  check (char_length(name) between 1 and 50);

alter table public.content_reports
  add constraint content_reports_reason_length
  check (reason is null or char_length(reason) <= 500);

alter table public.push_subscriptions
  add constraint push_subscriptions_device_label_length
  check (device_label is null or char_length(device_label) <= 50);

-- ---------------------------------------------------------------------------
-- Count-based caps
--
-- These cannot be CHECK constraints, because a CHECK sees only the row being
-- written and these rules depend on counting other rows. Hence triggers.
--
-- The subtle part is concurrency. A naive "count, then decide" trigger is
-- broken: two simultaneous joins to a 9-member group can BOTH read 9, both
-- conclude there is room, and both insert, leaving 11 members. Reading is not
-- serialized with writing unless something forces it to be.
--
-- The fix is to lock the parent row (SELECT ... FOR UPDATE) before counting.
-- Concurrent inserts for the SAME group then queue behind each other, so the
-- second one counts 10 and is correctly rejected. Inserts into DIFFERENT groups
-- take different locks and never block one another, so the cost is confined to
-- the exact case that needs it.
-- ---------------------------------------------------------------------------

create function public.enforce_group_member_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_count integer;
begin
  -- Serializes concurrent joins to this group. Does not block other groups.
  perform 1 from public.groups where id = new.group_id for update;

  select count(*) into member_count
  from public.group_members
  where group_id = new.group_id;

  if member_count >= 10 then
    raise exception 'Circle is full (10 member maximum)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_group_member_cap()
  from anon, authenticated, public;

create trigger group_members_enforce_cap
  before insert on public.group_members
  for each row execute function public.enforce_group_member_cap();

-- Ten ACTIVE goals per user. Achieved and archived goals do not count, so this
-- must also fire when a goal is reactivated, not only on insert.
create function public.enforce_active_goal_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_count integer;
begin
  perform 1 from public.users where id = new.user_id for update;

  select count(*) into active_count
  from public.goals
  where user_id = new.user_id
    and achieved_at is null
    and archived_at is null
    and id <> new.id;   -- exclude self, so UPDATEs are counted correctly

  if active_count >= 10 then
    raise exception 'Active goal limit reached (10 maximum)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_active_goal_cap()
  from anon, authenticated, public;

-- The WHEN clause means the trigger only runs when the resulting row is
-- actually active: creating a goal, or un-archiving one. Archiving or achieving
-- a goal never needs to be checked, since it can only reduce the count.
create trigger goals_enforce_active_cap
  before insert or update of achieved_at, archived_at, user_id on public.goals
  for each row
  when (new.achieved_at is null and new.archived_at is null)
  execute function public.enforce_active_goal_cap();;
