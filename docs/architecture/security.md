# Security model

RLS, grants, the error contract, response headers, photo access, and what happens to data when an account ends.

---

## 3b. Response headers

Step 12. The policy lives in `lib/security-headers.ts`, in one module, so the two mechanisms that ship it cannot drift apart.

**There are two mechanisms, and the split is not stylistic.**

| | Where | Why there |
|---|---|---|
| HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` | `next.config.ts` → `headers()` | Applies to **every** path |
| The CSP and `Reporting-Endpoints` | `proxy.ts` | Carries a per-request nonce, which a static config cannot mint |

The proxy's matcher deliberately excludes `_next/static`, `sw.js`, the manifest and every image, because a service worker handed a redirect instead of JavaScript fails to register and iOS then gets no push at all. Headers set only there would therefore miss exactly the responses most worth protecting from sniffing and framing. `e2e/headers.spec.ts` fetches `/sw.js` and asserts `nosniff` on it, so deleting the `headers()` block fails a test rather than going unnoticed.

### The nonce

**Next reads it from the *request*, not from anything we return.** `updateSession` sets `Content-Security-Policy` on a copy of the request headers, Next parses the nonce out of it, and stamps it onto the inline `<script>` tags it streams for the RSC payload. It also goes on as `x-nonce`, which the root layout reads for the app's one inline script.

Three consequences worth knowing before debugging anything here:

- **Both copies are needed.** The request copy is what nonces Next's scripts; the response copy is what the browser enforces. Setting only the first protects nothing; setting only the second blocks Next's own bootstrap and the app never hydrates, with nothing in any server log.
- **The headers object is rebuilt on each `NextResponse.next()`, not captured once.** `request.cookies.set` writes through to the request's `cookie` header, so a copy taken before the session refresh would pin the stale cookie.
- **The root layout is `async` and reads `headers()`**, which makes every route dynamic. That costs nothing here, because every page already reads cookies through `createClient()`. If a genuinely static page is ever added, the answer is a hash rather than a nonce.

### Dev is not what ships

Production is `'self' 'nonce-…'`. Development is `'unsafe-inline' 'unsafe-eval'` with **no nonce at all**, because Turbopack compiles with `eval` and injects both scripts and stylesheets at runtime.

**A nonce anywhere in `script-src` switches `'unsafe-inline'` off.** That is the rule in every modern browser: the nonce is the more specific instruction and the blanket permission is discarded. A dev policy listing both is therefore not belt-and-braces, it is the strict policy with a decorative string beside it.

The first cut listed both, to keep the nonce plumbing exercised locally. Chromium tolerated it. **WebKit did not**, and the whole `mobile-safari` project failed as four tests reporting missing text and missing padding — the padding because with JavaScript blocked, Turbopack never injected the stylesheets either. Nothing in any failure message said "CSP". `e2e/ios.spec.ts` now opens with a test that says it in those terms, and prints the policy alongside its own result, because this failure shape took three rounds to place.

The suite runs against dev unless `E2E_PROD=1`, **so an ordinary local run is not testing the policy that ships**. `e2e/headers.spec.ts` asserts the invariants always and the strict form only under `E2E_PROD`; that is the run that has to pass before a deploy. The nonce is still minted and still sent as `x-nonce`, so the layout stamps it on the install script and the plumbing is at least present. What it is not, in dev, is *enforced* — which is why the two tests that assert on it skip unless `E2E_PROD` is set, rather than asserting something weaker and looking like coverage.

### `upgrade-insecure-requests` keys on the connection, not the build

It is sent only when the request arrived over https, read from `x-forwarded-proto` first because Vercel terminates TLS and the request reaching the proxy is plain http.

**Over http the directive is not a block, it is a redirect to nowhere.** It rewrites every subresource URL to `https://<host>` before fetching, so on a local production build the page's own bundle and stylesheet point at a port that is not listening. The page loads, raises **no violation**, and runs nothing.

**Chromium hides this; WebKit does not.** Chromium exempts `localhost` as potentially-trustworthy and skips the upgrade. So `E2E_PROD=1` passed the whole Chromium suite and failed every `mobile-safari` test, with the diagnostic reading *12 scripts, all nonced, one stylesheet, no violations, body unstyled* — every element present and none of them fetched.

HSTS already forces https on the deployed origin, so skipping this over a plain connection costs nothing.

### No `strict-dynamic`

It was in the first cut and was removed **on a wrong diagnosis**, which is worth recording plainly: the WebKit failure was `upgrade-insecure-requests`, above, and `strict-dynamic` was innocent. It was removed one step earlier because dropping it was the cheapest way to change a single variable, and the failure it was meant to explain persisted afterwards.

It stays out on its own merits rather than that one. `strict-dynamic` **discards `'self'`** and requires Next to nonce every `<script src>` in the initial HTML — real machinery, worth its weight when an origin serves scripts you do not control.

**Here it would buy nothing, and that is a fact about this app rather than a general claim.** `strict-dynamic` earns its complexity when an origin serves scripts you do not control. This one serves no third-party scripts, uses no CDN, and hosts no user-uploaded content on its own origin: photos live in Supabase storage. So the set of scripts `'self'` admits is exactly the set the build produced. Revisit if any of those three stops being true — restoring it is one array element and the `mobile-safari` project would test it.

### Choices that will look arbitrary later

| | |
|---|---|
| `style-src` is **not** nonced | A nonce there switches off `'unsafe-inline'` for styles, and `next/font` injects a `<style>` while every React `style={}` prop is an inline attribute. Scripts are where injection means code execution; styles are defacement at worst |
| `connect-src` allows `wss:` | No client subscribes to realtime yet, but `notifications` is published to `supabase_realtime`, and a socket blocked by CSP produces **silence**, not an error. That is already the documented failure mode of realtime here, and a header is the last place anyone would look |
| The Supabase origin is normalised | A CSP source **with a path is a prefix match**, so a stray `/rest/v1` from the environment variable would silently forbid `/auth/v1` and break sign-in |
| HSTS has no `preload` | Preload is compiled into browser binaries and comes back out over months. This header expires on its own if it stops being sent. Revisit when the custom domain is final |
| `camera=()` | Step 13 uses a plain file input, which hands off to the OS camera app rather than `getUserMedia`. **Confirmed on a real iPhone: this stays shut and Take Photo works.** When Take Photo did fail, the causes were a `display:none` input and `worker-src`, not this |
| `worker-src` allows `blob:` | `browser-image-compression` builds its worker with `createObjectURL(new Blob(...))`. With `'self'` alone the phone silently uploaded nothing while a desktop worked, because the library falls back to the main thread on some engines and not others. A real widening, accepted because the blob comes from our own bundle |
| `form-action` names **three** origins | `'self'` plus the Supabase auth origin plus `accounts.google.com`. `form-action` is enforced at every **redirect hop**, which Chrome does and Safari and Firefox do not, and sign-in is a form that redirects twice. Hydrated it never applies, because React submits by `fetch`; the exposure is a **click before hydration** on the first page a signed-out visitor sees. Found by audit, not by a test |

### Violation reports

`POST /api/csp-report`, logging only, `console.warn` and nothing else. The body is unauthenticated attacker-controlled JSON arriving at a URL published in every response header, so the cheapest way to stop it becoming a storage problem is to give it nowhere to go.

- **Always answers 204**, on malformed JSON, an oversized body, or a limiter that will not start. The browser discards the response and retries nothing, so any other status is noise nobody can act on.
- **Rate-limited by IP, and refusal is silent** — it stops logging rather than starting to fail. On localhost there is no `x-forwarded-for`, so every request shares one bucket; a limiter that returned an error would turn one noisy test run into a broken endpoint.
- **But only a real refusal stops the log.** `Redis.fromEnv()` throws when the Upstash variables are absent, and catching that the same way would mean an environment with no Upstash config silently discarding **every** report while answering 204 and looking healthy: this endpoint's own failure mode, reproduced inside it. Only a `RateLimitError` short-circuits.
- **The proxy returns before `getUser()` for this path.** A page with a wrong policy emits a report per blocked resource per load, and letting those through the session refresh would spend the project's Supabase **auth** rate limit, whose exhaustion signs people out several requests later. A reporting endpoint must not be able to break the thing it is reporting on.
- **Both spellings are sent**, `report-to` and the deprecated `report-uri`, because Safari supports only the latter. The two body shapes do not share field names (`blocked-uri` versus `blockedURL`), and `lib/csp-report.ts` reads both. A parser that knew one would log a row of `undefined` for the other, which produces log lines rather than errors and so looks like nothing is wrong.

---

## 4. Security model

### Grants come first

**Postgres checks table grants before evaluating any policy.** A perfect policy with no grant returns nothing. Because "Automatically expose new tables" is disabled on this project, no role: including `service_role`: holds DML by default. Every table needs an **explicit grant paired with its policy in the same migration** so they can't drift.

This is the stronger posture: access is an allowlist, and a forgotten grant fails closed.

- **`anon` holds no grant on any table.** The product is invite-only and unauthenticated visitors are routed through sign-in before anything is read.
- **Column-scoped `UPDATE` grants** where a table has immutable columns. A column that was never granted can't be targeted at all, which is stronger than a `WITH CHECK` expression someone has to write correctly.
- **`TRUNCATE` is revoked** from all client roles, with default privileges altered so new tables don't reacquire it. **TRUNCATE bypasses RLS entirely**: policies are never consulted, so the grant would have undercut every rule here. Not reachable through PostgREST today, but relying on the API surface staying narrow forever isn't a security argument.
- `REFERENCES` and `TRIGGER` remain: both need ownership-level access and neither reads data.
- **`service_role` bypasses RLS but still needs grants.** When grants were rebuilt as an explicit allowlist, everything went to `authenticated` and nothing to `service_role`, so every Edge Function query returned a 500. Grants are checked *before* RLS, and bypassing RLS does not help a role that cannot touch the table at all.

  It went unnoticed because pg_cron runs as the table owner; only the Edge Functions exercise that path.

  `service_role` now holds blanket DML deliberately. It already bypasses RLS, so per-table grants add no real restriction and only produce failures of this kind. Its real control is that the key never leaves server-side contexts. `TRUNCATE` stays revoked even here, since it bypasses RLS *and* skips triggers.
- **PostgREST cannot address the `private` schema, so job helpers live in `public`.** Edge Functions calling `.schema("private").rpc(...)` fail, because PostgREST honours a schema header only for schemas in its exposed list. `private` deliberately is not one, since exposing it would hand clients the RLS-bypassing helpers it exists to hide. The three job-only functions (`job_list_expired_photos`, `job_mark_photos_purged`, `job_scrub_and_list_user_media`) therefore sit in `public` with `EXECUTE` granted to **`service_role` alone**. PostgREST resolves them, Postgres refuses any other caller, and they stay off the linter's report, which flags only what `anon` and `authenticated` can call.

### Access matrix (`authenticated`)

| Table | Read | Insert | Update (columns) | Delete |
|---|---|---|---|---|
| `users` | self + circle-mates | none | `display_name, avatar_url` | none |
| `user_lifetime_stats` | self; circle-mate if opted-in and not blocking you | none | `visible_on_profile` | none |
| `goal_categories` | all | none | none | none |
| `goals` | self + circle-mates | own | `title, category_id, deadline, achieved_at, archived_at` | none |
| `progress_entries` | self + circle-mates | own, **active** goal, **today only** | `note, photo_url` | own |
| `daily_completion` | self + circle-mates | none | none | none |
| `goal_group_visibility` | goal owner or circle member | own goal + member | `hidden` (member only) | own goal |
| `groups` | members | none | `name` (admin); leaderboard settings (owner, via trigger) | none |
| `group_members` | circle-mates | none | `role` (owner only, never targeting owner) | self or admin-kick, never the owner |
| `group_cycles` | members | none | none | none |
| `invite_links` | admins | none, RPC only | `enabled` | none |
| `group_cycle_stats` / `group_daily_completion` | cycle members | none | none | none |
| `group_member_category_stats` / `digest_snapshots` | circle members | none | none | none |
| `digest_pushes` | **nobody** | none | none | none |
| `notifications` | self | none | `read_at` | own |
| `push_subscriptions` | self | own | `device_label` | own |
| `user_blocks` | blocker only | own | none | own |
| `content_reports` | own submissions | own, circle-mate target | none | none |
| `audit_log`, `username_history` | none | none | none | none |

**`digest_pushes` is one of the three rows above nobody holds a grant on**, and it is the strictest: RLS is on with no policies *and* every grant revoked, so `authenticated` cannot reach it even to be refused. Only `send-digest-push` touches it, holding the service key, which bypasses both. Migration 112 — a client that could insert here could suppress its own digests, and nobody has a reason to read their own delivery receipts.

### Policy mechanics

- `USING` filters existing rows (`SELECT`/`UPDATE`/`DELETE`); `WITH CHECK` validates rows being written (`INSERT`/`UPDATE`). An `UPDATE` needs both, and they differ: `USING` says which rows you may edit, `WITH CHECK` what they may become, which is what stops editing your row into someone else's.
- Multiple policies on the same operation are **OR-ed**. Each grants a reason; they never narrow each other.
- **`(select auth.uid())`, not bare `auth.uid()`**: the wrapped form evaluates once per query rather than once per row.
- **RLS filters silently.** An `UPDATE` on an invisible row affects zero rows without erroring, unlike a missing column grant which raises `insufficient_privilege`. Code that assumes success because nothing threw needs to check the affected row count.

### The `private` schema

Shared policy predicates live in `private`, which resolves a genuine conflict:

- A policy is evaluated with the privileges of whoever runs the query, so these **must** be `EXECUTE`-able by `authenticated`.
- But anything in `public` is published as an RPC endpoint, and these are `SECURITY DEFINER` functions that bypass RLS.

PostgREST doesn't expose `private`, so policies can call them and HTTP clients cannot reach them.

They also solve a recursion problem: the natural policy on `group_members` ("you can see rows for groups you belong to") queries `group_members` to decide, which Postgres rejects as infinite recursion. `SECURITY DEFINER` runs the lookup with RLS bypassed so it never re-enters.

| Function | Purpose |
|---|---|
| `is_group_member(group_id)` | caller belongs to the circle |
| `is_group_admin(group_id)` | caller is owner or admin |
| `is_group_owner(group_id)` | caller is owner |
| `is_cycle_member(cycle_id)` | reaches the circle through `group_cycles` |
| `shares_group_with(user_id)` | the core visibility rule; symmetric |
| `is_blocked_by(user_id)` | has that user blocked the caller: **directional** |
| `is_goal_hidden_in_group(goal_id, group_id)` | encodes the sparse-table coalesce once |
| `owns_goal(goal_id)` | caller owns it |
| `owns_active_goal(goal_id)` | owns it **and** it's neither achieved nor archived. Wired into `checkin_photos_insert` by migration 64, after two months unreferenced. The policy previously checked only that the folder was the uploader's, so any fabricated or archived goal id was a valid upload target |

**These predicates are ceilings, not filters.** `group_members_select_circlemate` is `is_group_member(group_id)`, so a member can read *every* member row of *every* Circle they belong to. That is exactly what the roster on `/circles/[id]` needs and far more than the dashboard wanted: reading it without `.eq("user_id", …)` returned one row per member and listed a Circle of three three times, each showing a different person's role.

Dropping a `WHERE` clause because "the policy covers it" is safe only when the policy's predicate is **identical** to the filter you would have written. `goals_update_own` and `progress_entries_delete_own` are both `user_id = auth.uid()` and do pass that test, which is why `archiveGoal` and `undoCheckIn` legitimately omit the filter.

The failure is invisible until a Circle has two members, so it will not show up in solo testing.
| `current_checkin_date()` | today under the caller's frozen timezone and 2 AM rule |

Not client-granted (jobs and triggers only): `checkin_date_for`, `recompute_daily_completion`, `rollover_user_day`, `rollover_group_day`, `list_expired_photos`, `mark_photos_purged`, `scrub_and_list_user_media`.

**An overload is a new object, and inherits nothing.** `private.current_checkin_date(uuid)` was added in migration 64 beside an existing no-argument version and came out `anon`-executable, because `create or replace` on a *different signature* creates a fresh function with Postgres's default grant to `PUBLIC`. The original's revoke did not apply to it. Revoke in the same migration that creates a function, every time. Found by the standing check, fixed in migration 67.

**`ALTER DEFAULT PRIVILEGES` is a convenience, not a guarantee.** A default revoking `EXECUTE` from `PUBLIC` in `private` was set early, yet five helpers created afterwards still came out `anon`-executable. The linter did not flag it because `anon` lacked schema `USAGE`, so one barrier stood where two were intended. Currently **one anon-executable function and zero with a mutable `search_path`**. The one is `public.circle_preview`, which is deliberate — an invite link has to render before sign-in — and `patterns.md`'s standing check says to expect exactly that row. **This sentence used to claim zero**, which would have read as a regression to the next person who ran the query. The function count was 41 at migration 57 and rises with each migration that adds one, so `patterns.md` carries the query rather than a number worth trusting. Re-run it after any migration that adds a function.

### Notable policy decisions

**Check-ins require an ACTIVE goal.** Without this a user could check in on archived goals: the 10-goal cap bounds only *active* ones, so someone could accumulate unlimited archived goals and check into all of them daily, inflating the raw `total_completions` the leaderboard ranks on while `total_possible` stayed flat, until the `completions <= possible` invariant started rejecting legitimate writes. The cap was meant to bound exactly this; check-ins were routing around it.

**Goals have no `DELETE`.** `archived_at` is the retirement path, keeping check-in history intact where a delete would strand entries with a null `goal_id`.

**`daily_completion` has no client write access at all.** The entire streak system is built on it.

**Hidden goals are masked by `circle_roster`, not by RLS.** Migration 64.

`goals_select_own` and `progress_entries_select_own` are both `user_id = auth.uid()`: a circle-mate cannot read either table directly at all. `public.circle_roster(group_id)` is `SECURITY DEFINER`, checks membership itself, and returns each member's goals with `title` nulled where `goal_group_visibility` says hidden.

**Why not RLS.** Policies are row-level. Returning a row to one viewer with a column blanked and to another intact is not something a `USING` clause can express. The previous design said "the API masks title/note/photo_url", but the client talks to PostgREST directly and that API never existed, so a circle-mate could read every title and note through `/rest/v1/goals`. Nothing leaked in practice only because nothing rendered them.

**`checked` is returned for hidden goals; `title` is not.** Hiding means "do not show what it is", not "do not show whether it was done" — a hidden goal still counts toward the shared streak, so masking its state would opt out of the accountability while keeping the benefit. The denominator includes hidden goals, so the count reveals how many someone has. Unavoidable once the numbers have to add up.

**The cost, stated once:** every future read of a circle-mate's goals goes through the RPC. That is the point. The old design failed precisely because masking lived in a layer that could be bypassed.

`daily_completion` and `users` stay readable by circle-mates. Whether someone finished their day, and their name, are the product, and neither carries free text needing a mask.

**Blocking doesn't hide the `users` row or a circle-mate's goals.** It hides `user_lifetime_stats`. Hiding identity would leave a member in a roster with no name to render, which advertises the block rather than concealing it; hiding goals would break the accountability the Circle exists for.

**`group_members` `DELETE` covers leaving and kicking in one policy**: `role <> 'owner' AND (user_id = auth.uid() OR is_group_admin(group_id))`. The owner is unreachable as a target of either, so an owner can't leave without transferring and no admin can remove them: enforced in the policy, not the app layer.

**Owner-only Circle settings use a trigger, not a grant.** Column grants are per-*role*, so they can't distinguish owner from admin. `guard_group_owner_only_settings` compares old and new rows to see which columns actually changed and who changed them.

**Onboarding can't be a client query.** Since a user only reads rows for people they share a Circle with, the "is this username taken?" check runs server-side under `service_role`, which is also where the profanity filter and rate limiting belong.

### RPCs

Some operations span multiple tables and can't be made safe by a policy:

| Operation | Why not a policy |
|---|---|
| Create a circle | group + owner membership + first cycle must be atomic, or a failure halfway leaves an ownerless circle nobody can clean up |
| Join via invite | RLS can't see the token; also needs capacity, block check, and an audit write |
| Transfer ownership | demote-then-promote must be ordered inside one transaction, since the one-owner index forbids two owners existing even momentarily |
| Cycle continue / reset | closes one cycle, opens another, zeroes stats |

These are `SECURITY DEFINER` functions in `public`. A function body *is* a transaction, so atomicity is free, and the logic sits next to the constraints it depends on.

| Function | Returns | Checks |
|---|---|---|
| `create_circle(name, deadline)` | `group_id` | authenticated |
| `circle_preview(token)` | `status, circle_name, member_count, is_full` | authenticated |
| `join_circle(token)` | `group_id` | token valid, circle active, not blocked, under 10, has an owner. Idempotent. |
| `transfer_ownership(group_id, new_owner)` | void | caller is owner; target is a member |
| `cycle_continue(group_id, new_deadline)` | void | owner or admin; deadline may only extend or clear |
| `cycle_reset(group_id, new_deadline)` | `cycle_id` | owner or admin |
| `create_invite_link(group_id, expires_at, use_default_expiry)` | token | owner or admin; circle active and under 10 |
| `complete_onboarding(username, timezone)` | void | validates timezone against `pg_timezone_names`; enforces the 14-day rename limit |
| `sync_checkin_timezone(timezone)` | void | **no-op unless the check-in day has elapsed** |
| `resolve_streak_decision(group_id, continue)` | void | owner only; requires a pending decision |
| `set_circle_deadline(group_id, deadline)` | void | owner or admin; Circle active; deadline ≥ next day or NULL |
| `archive_circle(group_id)` | void | Owner only. Closes the open cycle, sets status `archived`, audits. Links are disabled by trigger, members are kept, nothing is notified. **Not reversible.** |
| `export_user_data()` | jsonb | **`SECURITY INVOKER`**: RLS applies, so it can't return another user's rows |
| `current_checkin_date()` | date | **`SECURITY INVOKER`**: a thin wrapper over the `private` function of the same name, which PostgREST cannot address. Grants nothing new: `authenticated` already executes the private one, because policies call it with the caller's privileges. Exists so the app can supply `progress_entries.check_in_date`, which the INSERT policy requires to match it exactly. |

**Unlike the `private` helpers, these are intentional API surface.** Each validates its caller in its own body: `SECURITY DEFINER` gets no RLS for free. All pin `search_path` and are granted only to `authenticated`.

**Invoked from Next.js server actions, not the browser.** A browser calling `supabase.rpc()` goes straight to Supabase and never touches the app, so Upstash rate limiting, Turnstile, and the profanity filter would have nowhere to run: circle creation and joins would be entirely unthrottled.

**Deliberate errors carry a machine code in the HINT.** The rule: if a message is written to be read by a person, the raise sets a hint. `lib/errors.ts` checks the hint before the SQLSTATE and falls through to a generic message for anything it does not recognise.

This exists because a SQLSTATE is a category, not an intent. `check_violation` covers both "you already have 10 goals", which belongs on screen, and "value too long for type character varying(50)", which does not. Without a hint the app could only tell them apart by matching message text, which means renaming a constraint silently changes what people read.

**Enforced by lint, not by the database.** A stray `supabase.rpc()` in a component works fine and silently skips all three protections. The database cannot enforce the boundary: revoking `EXECUTE` from `authenticated` would force calls through the server, but the RPCs check `auth.uid()` internally and `service_role` has none, so every call would raise "Not authenticated". An ESLint rule therefore bans `.rpc(` outside `app/actions/`.

**Two exemptions, both read-only and both justified in the file itself.**

| File | Why |
|---|---|
| `lib/supabase/checkin-date.ts` | Argument-free, needed by both the read and the write path, nothing to meter. Confining it would mean duplicating it into the page. |
| `lib/supabase/circle-preview.ts` | Read during render on a public route, so a server action would publish a POST endpoint for a value never submitted. **This one does need metering**, per IP, and the exemption is conditional on its single call site applying it. |

The second is the weaker of the two and worth watching. `circle_preview` is granted to `anon` (migration 63), which makes it the app's only unauthenticated endpoint; step 7f adds the per-IP limit at `/join/[token]`.

Trade-off accepted: PL/pgSQL is harder to unit-test under Vitest. These are tested with `DO` blocks in SQL instead.

### Expected, permanent linter output

Anything beyond this list is a real finding.

- `rls_enabled_no_policy` on `audit_log` and `username_history`: deliberately client-inaccessible.
- `authenticated_security_definer_function_executable` on the 12 client-callable `public` RPCs: deliberately callable; `anon` is excluded.
- `unused_index` on everything, until there's real traffic.

**A replay into a shadow database is its own category of test.** `supabase db diff` builds a fresh Postgres and runs every migration in order, which is the only way to catch a history that depends on state it never creates. The recurring bug patterns this schema has produced, and the checks that find them, are catalogued in `patterns.md`.

---

---

## 9. Photo check-ins

**Built in step 13.** Everything below was designed in migrations 40–72 and unexercised until then; where the built thing differs from the design, the difference is marked.

### The pipeline

Pick a file → `inspect` → `preparePhoto` → upload straight to Storage → `attachCheckinPhoto`. Only the last step is a server action; the bytes never cross our runtime.

| | |
|---|---|
| Accepts | HEIC, JPG, PNG, GIF, WebP *as input*, judged by **magic bytes** rather than the name or the declared type. All of it is re-encoded to JPEG before upload |
| Normalised to | **JPEG**, longest edge ~1600px, quality 0.8, in the browser. Not WebP: **Safari cannot encode it**, and `toBlob` falls back to PNG silently. Migration 82 |
| Cap | 10MB before compression, checked client-side so a 12MB file fails instantly rather than after the upload |
| Metered | `photoUpload`, 20/hour, spent by `attachCheckinPhoto` — the step that makes an object visible to other people, not the byte transfer |

**HEIC decoding belongs to the browser.** Safari decodes it to a canvas; Chrome on Android does not. "Converted client-side" therefore means "converted by a browser that can", and a failure says so rather than claiming support that depends on the reader.

**EXIF orientation and EXIF stripping are two concerns that look like one.** The canvas re-encode drops metadata for free, which is the privacy requirement — a check-in photo must not carry the poster's GPS to their Circle. It also drops the *orientation flag*, so `exifOrientation: -1` bakes the rotation into the pixels first. Without it every portrait photo arrives sideways, which looks like a working feature.

**The magic-byte check stops mistakes, not attackers**, and the docs should not imply otherwise. Nothing of ours sees the bytes, and the bucket's `image/jpeg` restriction checks the type of the multipart part, which comes from `blob.type`. The real containment is that the object is private, reached only through a signed URL, and rendered in an `<img>`.

### Storage buckets

**Path convention: fixed. Changing it later means migrating objects.**

```
checkin-photos : {user_id}/{goal_id}/{entry_id}.jpg
avatars        : {user_id}/{filename}
```

The check-in path encodes owner **and** goal so the policy evaluates both the shared-Circle rule and the not-hidden rule from the path alone, without joining `progress_entries` on every object read.

**It also forces the order of operations**, which is the single fact most of step 13's design follows from: the entry must exist before a photo can be addressed. Hence the button appears only once a goal is checked off, and hence `attachCheckinPhoto` is a second step rather than part of the check-in.

Both buckets are private and capped (`checkin-photos` 10MB, `avatars` 2MB). `checkin-photos` is restricted to **`image/jpeg`**.

**The bucket's MIME check reads `blob.type`, not the `contentType` you pass.** `supabase-js` appends the blob to a `FormData` bare, so the option sets a request header the check never looks at. `preparePhoto` therefore asserts the type it produced rather than trusting the encoder.

### Who sees a photo: two rules, deliberately not identical

| | Question it answers | Rule |
|---|---|---|
| `checkin_photos_select` | May this person fetch this object? | **At least one** shared Circle where the goal is not hidden |
| `circle_roster` (migration 79) | Should this Circle be *offered* the photo? | Not hidden **in this Circle** |

Storage cannot answer "which Circle is this request about", so it cannot mask per Circle; a Circle where you hid a goal should not show its photo, so the roster must. **The same photo can therefore be withheld by the roster and served by a direct signed URL.** Both are right for their own job. Do not re-implement either inside the other: migration 71 had to undo exactly that.

**`photo_url` is the object key, not a URL.** A boolean would not have worked, because the key contains `entry_id` and migration 72 returns that for your own rows only, so a viewer told `has_photo: true` could not name the object. A key is a name and not a door: the bucket is private and signing still has to pass the policy.

**Migration 80 stops the key being forged.** `authenticated` holds `update (photo_url)` and the only WITH CHECK is `user_id = auth.uid()`, so the column was free text on a row you own — a client could point it at someone else's object and the roster would present that as their proof. `attachCheckinPhoto` derives the key and never accepts one; the constraint says the same where PostgREST cannot route around it. Its null escapes matter: both foreign keys are `ON DELETE SET NULL`, a `SET NULL` is an UPDATE, and a CHECK is evaluated on it, so a stricter constraint would make deleting a goal fail.

### Signed URLs

**One hour, minted during the server render, signed as the caller** — never with the service key. `createSignedUrl` evaluates `checkin_photos_select` for whoever asked, so Storage stays the only place the access rule lives and a key the roster offers but Storage refuses simply arrives as null. The alternative, a route handler that checks access itself, would re-implement `can_view_checkin_photo`.

**Batched, and matched by key rather than position.** `createSignedUrls` reports a per-path error rather than failing the batch, so matching by index would put one person's photo on another person's row the moment one key was refused.

The object key never leaves `lib/supabase/`. A component holding one would be a component that could build a URL.

### Retention, and two kinds of garbage

**Retention: fixed 90 days**, via `purge-expired-photos`. The row and all derived statistics survive; only the image goes.

*Not cycle-based, as originally specified*: a check-in belongs to a user-owned goal visible in every Circle that user is in, so "the cycle this photo belongs to" is not a question the schema can answer.

*Ordering matters*: objects are removed from Storage **before** `photo_url` is nulled. Reversed, a crash between the steps leaves rows claiming no photo while the objects linger unreferenced. `undoCheckIn` and `removeCheckinPhoto` follow the same order.

**Step 13 made two more states reachable, and migration 81 sweeps both**, in the same job:

| | Why it happens | What the sweep does |
|---|---|---|
| **An object no row names** | Upload and attach are separate on purpose, and `undoCheckIn` deletes the object first and continues if the row delete fails | Removes it, **after a 24-hour grace window** |
| **A row naming a missing object** | The mirror image, same path | Nulls the column. Deletes nothing |

Retention alone could never have found the first: it finds objects **through** `photo_url`, so a file nothing points at is invisible to the only job meant to clean it up.

**The grace window is the safety-critical parameter**, not a tuning knob. An object is only an orphan if nothing *will* reference it either, and there is a real gap between upload and attach on a slow connection. The two mistakes are not symmetrical: an unreferenced object is invisible and costs only storage, while deleting a live photo is silent and permanent.

**Both helpers are SQL, not a Storage listing.** `storage.objects` is an ordinary table, so "which files does no row reference" is a join. They live in `public` with EXECUTE for `service_role` alone, for the reason migration 50 records.

**`storage.protect_delete()` refuses direct deletes from `storage.objects`**, which is worth knowing before writing a test: objects can be inserted from SQL but only removed through the Storage API. The proof for migration 81 works around it by omission rather than deletion.

---

## 11. Account lifecycle

Self-serve in-app deletion, not a support ticket: Apple requires it for apps offering account creation.

### Edge Functions

| Function | `verify_jwt` | Auth | Notes |
|---|---|---|---|
| `delete-account` | yes | caller's JWT | user id comes from the token, **never** the body |
| `export-data` | yes | caller's JWT | runs as the user; RLS enforces isolation |
| `purge-expired-photos` | no | `x-cron-secret` | scheduler-invoked; **fails closed** if the secret is unset |
| `send-digest-push` | no | `x-cron-secret` | scheduler-invoked; **fails closed** if the secret or either VAPID key is unset. Reads two sources since migration 112 — `notifications` for events, `digest_snapshots` for digests |

**`delete-account` ordering is load-bearing:**

1. Identify the caller from their own JWT.
2. Scrub note text and collect Storage paths: **before** the user row is gone, since afterwards the rows can't be located.
3. Delete Storage objects (check-in photos, avatar).
4. Delete the auth user, cascading into `public.users` → `group_members`, firing owner succession and audit.

`progress_entries` survive, anonymized: the FKs null attribution automatically, and the function additionally scrubs the free-text `note`, which a foreign key can't reach. Hard-deleting them would retroactively corrupt other members' stats for cycles they shared.

**Export returns JSON directly** rather than a signed Storage URL: at v1 volumes a user's history is small, and an export artifact would need its own retention and access rules, which is attack surface for no benefit.

**Removal is classified three ways**, decided by whether the *target user row still exists* rather than by comparing `auth.uid()`:

| Situation | Recorded as | Leaderboard |
|---|---|---|
| Account deleted | `member_left`, `via: account_deletion`, actor and target nulled | untouched |
| Left voluntarily | `member_left`, `via: left` | **kept** |
| Removed by someone else | `member_kicked`, `via: kicked` | **zeroed** |

An earlier version compared `auth.uid()`, which recorded account deletion as a *kick*: wrongly implying moderation and applying the stat penalty to someone who just closed their account.

---
