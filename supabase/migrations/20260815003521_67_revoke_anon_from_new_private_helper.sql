-- Found by the standing posture check after migration 64, not by review.
--
-- `private.current_checkin_date(uuid)` is a NEW signature rather than a
-- replacement of the no-argument version, so it was created fresh and picked up
-- Postgres's default of `EXECUTE` to `PUBLIC`. The no-argument version, created
-- long ago and explicitly revoked, was unaffected. The overload came out
-- anon-executable while its twin was not.
--
-- This is the trap architecture section 4 already documents, hit again:
-- `ALTER DEFAULT PRIVILEGES` is a convenience, not a guarantee, and a default
-- set once does not reach a function created later by a different path. The
-- correct habit is to revoke explicitly in the same migration that creates the
-- function, which migration 64 did not do.
--
-- IMPACT WAS NIL, and only because two other barriers held: `anon` has no
-- USAGE on `private`, and PostgREST does not expose the schema, so there was no
-- route to call it. That is precisely the situation the same section warns
-- about, where one barrier stands in place of the two that were intended, and
-- nobody notices until the other one moves.

revoke execute on function private.current_checkin_date(uuid) from public, anon;
grant execute on function private.current_checkin_date(uuid) to authenticated;

-- Belt and braces for the pair, so the two signatures cannot drift again.
revoke execute on function private.current_checkin_date() from public, anon;
grant execute on function private.current_checkin_date() to authenticated;;
