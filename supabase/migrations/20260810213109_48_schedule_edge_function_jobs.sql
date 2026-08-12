-- The two remaining jobs are Edge Functions, so pg_cron has to reach them over
-- HTTP via pg_net, which means the shared secret must be readable from Postgres.
-- It lives in Supabase Vault (encrypted at rest) rather than in the job command,
-- where it would sit in plaintext in cron.job for anyone with database access.

create function private.invoke_edge_function(p_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_url text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'cron_secret';

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'project_url';

  -- Fail quietly rather than hammering the endpoint with unauthenticated
  -- requests every hour. The Edge Functions also fail closed on a missing
  -- secret, so this is the second of two independent guards.
  if v_secret is null or v_url is null then
    raise warning 'invoke_edge_function(%): vault secrets not configured, skipping', p_name;
    return null;
  end if;

  select net.http_post(
    url     := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-secret', v_secret
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke execute on function private.invoke_edge_function(text) from public;

comment on function private.invoke_edge_function(text) is
  'Calls a Supabase Edge Function from pg_cron via pg_net, authenticating with '
  'the cron_secret stored in Vault. No-ops with a warning if the Vault secrets '
  'are missing.';

-- Push delivery: frequent, since notifications are also written by immediate
-- events (kicks, renewals), not only the daily digest.
select cron.schedule(
  'solarity-push-delivery',
  '25 * * * *',
  $$ select private.invoke_edge_function('send-digest-push'); $$
);

-- Photo retention: daily, off-peak, staggered from the row-retention sweep so
-- the two aren't competing.
select cron.schedule(
  'solarity-photo-purge-daily',
  '45 4 * * *',
  $$ select private.invoke_edge_function('purge-expired-photos'); $$
);;
