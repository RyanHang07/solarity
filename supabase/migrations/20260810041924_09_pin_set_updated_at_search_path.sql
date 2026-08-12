-- Linter 0011: set_updated_at() had a mutable search_path.
--
-- Lower severity than the handle_new_user case, since this function is
-- SECURITY INVOKER and references no schema-qualified objects. Pinning it
-- anyway: a trigger function that runs on every update to four tables should
-- not inherit whatever search_path the calling session happens to have.
-- pg_catalog is always searched, so now() still resolves.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;;
