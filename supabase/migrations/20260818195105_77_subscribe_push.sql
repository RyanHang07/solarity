create or replace function public.subscribe_push(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_device_label text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Not authenticated'
      using errcode = 'insufficient_privilege', hint = 'NOT_AUTHENTICATED';
  end if;

  -- Mirrors push_subscriptions_endpoint_is_https, so a bad value becomes a
  -- sentence rather than a bare 23514 naming a constraint.
  if p_endpoint is null or p_endpoint !~ '^https://' then
    raise exception 'A push endpoint must be an https URL'
      using errcode = 'invalid_parameter_value', hint = 'PUSH_ENDPOINT_INVALID';
  end if;

  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'A push subscription needs both of its keys'
      using errcode = 'invalid_parameter_value', hint = 'PUSH_KEYS_MISSING';
  end if;

  -- ---------------------------------------------------------------------
  -- Take the endpoint over, rather than failing on it.
  --
  -- `endpoint` is globally unique, which is right: it identifies one browser
  -- to one push service, and two rows would mean the sender delivering twice.
  -- But it makes re-subscribing impossible from the client, and that is why
  -- this function exists rather than an upsert:
  --
  --   * `authenticated` may UPDATE `device_label` and nothing else, so
  --     `ON CONFLICT DO UPDATE SET user_id = …` names columns it cannot write
  --     and dies with a bare 42501. Grants are checked before RLS.
  --   * A second account signing in on the same browser cannot delete the
  --     first account's row either, because the DELETE policy is self-scoped.
  --     From the client that state is unresolvable.
  --
  -- Deleting someone else's row here is correct rather than rude: a push
  -- endpoint belongs to a browser, and the browser has just told us who is
  -- using it now. The displaced account stops receiving push on a device it no
  -- longer occupies, which is the outcome anyone would expect.
  -- ---------------------------------------------------------------------
  delete from public.push_subscriptions where endpoint = p_endpoint;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (v_uid, p_endpoint, p_p256dh, p_auth, nullif(p_device_label, ''));
end;
$$;

comment on function public.subscribe_push(text, text, text, text) is
  'The writer push_subscriptions never had. SECURITY DEFINER because endpoint is globally unique and a client can neither update another row nor delete one it does not own, so re-subscribing and account switching are both unreachable without this. Takes the endpoint over: it identifies a browser, and the browser has just said who is using it.';

revoke all on function public.subscribe_push(text, text, text, text) from public;
revoke all on function public.subscribe_push(text, text, text, text) from anon;
grant execute on function public.subscribe_push(text, text, text, text) to authenticated;

do $$
begin
  if not has_function_privilege('authenticated', 'public.subscribe_push(text, text, text, text)', 'EXECUTE') then
    raise exception 'authenticated cannot call subscribe_push';
  end if;
  if has_function_privilege('anon', 'public.subscribe_push(text, text, text, text)', 'EXECUTE') then
    raise exception 'anon can call subscribe_push';
  end if;

  -- The client keeps its own DELETE path, so unsubscribing needs no RPC.
  if not has_table_privilege('authenticated', 'public.push_subscriptions', 'DELETE') then
    raise exception 'authenticated cannot delete its own subscriptions';
  end if;

  -- And still cannot forge one. If this ever passes, the RPC has stopped being
  -- the only writer.
  if has_column_privilege('authenticated', 'public.push_subscriptions', 'user_id', 'UPDATE') then
    raise exception 'authenticated can move a subscription between accounts';
  end if;
end;
$$;
