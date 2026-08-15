-- Let a signed-out visitor preview an invite before being asked to sign in.
--
-- WHY. Asking someone to create an account before telling them what they are
-- joining is the wrong order. The plumbing already assumed this: the proxy
-- treats /join as public, and `safeRedirect` permits /join/... as a `next`
-- target that survives the OAuth round trip. The grant was the missing piece.
--
-- WHAT THIS EXPOSES, and only to someone already holding a token: whether the
-- link is still live, the Circle's name, and its member count. Tokens are 32
-- CSPRNG bytes, so this is not a guessing surface. The realistic case is a link
-- screenshotted into a group chat and a stranger checking whether it still
-- works, which is a smaller cost than a blind sign-up wall.
--
-- WHAT IT DOES NOT EXPOSE. `circle_preview` returns 'not_found' with three
-- nulls for an unknown token, so it cannot be used to enumerate Circles. It
-- reads no member identities, no goals and no check-ins.
--
-- NOT GRANTED: join_circle. Joining still requires `authenticated`, and the
-- function's own auth.uid() guard raises NOT_AUTHENTICATED regardless.
--
-- UNMETERED FOR NOW. This becomes the app's only unauthenticated endpoint, so
-- it needs the per-IP limit from step 7f. Tracked there rather than here
-- because the limiter lives in Next.js, not in Postgres.

grant execute on function public.circle_preview(text) to anon;

comment on function public.circle_preview(text) is
  'Invite preview. Granted to anon so /join/[token] can render before sign-in. '
  'Returns status/name/member_count/is_full, and status not_found with nulls '
  'for an unknown token, so it cannot enumerate Circles.';;
