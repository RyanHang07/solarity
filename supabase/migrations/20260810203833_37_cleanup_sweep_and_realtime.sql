-- Solarity: retention sweep + Realtime publication.

-- ---------------------------------------------------------------------------
-- 90-day retention sweep (section 17)
-- ---------------------------------------------------------------------------
-- Batched deliberately. A single unbounded DELETE against a table with months
-- of accumulation holds locks and bloats WAL; deleting in chunks lets the job
-- make progress without ever taking a long lock, and lets it be stopped and
-- resumed safely.
--
-- Only notifications and digest_snapshots are swept. audit_log and
-- username_history are never swept — they are the durable history that made
-- user-deletable notifications acceptable in the first place.

create function public.run_retention_sweep(
  p_days integer default 90,
  p_batch_size integer default 5000,
  p_max_batches integer default 100
)
returns table (notifications_deleted bigint, digests_deleted bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => p_days);
  v_cutoff_date date := (now() - make_interval(days => p_days))::date;
  v_deleted bigint;
  v_notif bigint := 0;
  v_digest bigint := 0;
  i integer;
begin
  for i in 1..p_max_batches loop
    delete from public.notifications
    where id in (
      select n.id from public.notifications n
      where n.created_at < v_cutoff
      limit p_batch_size
    );
    get diagnostics v_deleted = row_count;
    v_notif := v_notif + v_deleted;
    exit when v_deleted = 0;
  end loop;

  for i in 1..p_max_batches loop
    delete from public.digest_snapshots
    where ctid in (
      select d.ctid from public.digest_snapshots d
      where d.date < v_cutoff_date
      limit p_batch_size
    );
    get diagnostics v_deleted = row_count;
    v_digest := v_deleted + v_digest;
    exit when v_deleted = 0;
  end loop;

  return query select v_notif, v_digest;
end;
$$;

comment on function public.run_retention_sweep(integer, integer, integer) is
  'Scheduled retention sweep. Deletes notifications and digest_snapshots older '
  'than p_days (default 90), in batches. Never touches audit_log or '
  'username_history. Not client-callable.';

-- Scheduled work only: a client that could call this could erase its own
-- notification history wholesale, or be used to force load on the database.
revoke execute on function public.run_retention_sweep(integer, integer, integer)
  from anon, authenticated, public;

-- Supports the sweep's scan; also the natural ordering for any future
-- housekeeping over old notifications.
create index if not exists notifications_created_at_idx
  on public.notifications (created_at);

-- ---------------------------------------------------------------------------
-- Realtime publication (section 5)
-- ---------------------------------------------------------------------------
-- Only notifications. The product deliberately uses a daily batched digest for
-- progress rather than live updates, so publishing progress_entries or
-- daily_completion would contradict the design and add load for no benefit.
--
-- Realtime respects RLS: notifications_select_own already restricts rows to
-- user_id = auth.uid(), so that same policy governs what arrives over the
-- socket. There is no second access model to maintain.

alter publication supabase_realtime add table public.notifications;;
