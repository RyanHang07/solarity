# Solarity: Bug Patterns & Standing Checks

Every real bug found so far fell into one of **twenty-six shapes**. Probe for these after any change. The list earns its keep: three of the last five bugs were found by walking it deliberately rather than by a test failing.

---

## The twenty-six shapes

### Schema-shaped — all found in SQL

| Pattern | Example |
|---|---|
| **Setter with no resolver** | `streak_grace` set on join, never cleared, so the group streak ignored that member forever |
| **Declared with no writer** | `admin_promoted`, `invite_link_toggled`, `kicked`, `group_locked_renewal` all existed and nothing produced them |
| **Raised with no reader** | the inverse. `set_circle_deadline` raises `CIRCLE_NOT_ACTIVE`, `NO_ACTIVE_CYCLE`, `DEADLINE_TOO_SOON`; `lib/errors.ts` knew none, so all three printed the raw Postgres message |
| **Two names for one condition** | migration 60 named a refusal `CIRCLE_INACTIVE` that 53 had already called `CIRCLE_NOT_ACTIVE`, same message text. Grep existing hints before inventing one |
| **Guarded on one path, not its inverse** | owner succession guarded departures; joining an empty archived Circle recreated the ownerless state |
| **Unreachable code** | `service_role` had no grants; `private` is not addressable by PostgREST |
| **Locked column, no writer** | `username` and `checkin_timezone` blocked with nothing able to set them, making onboarding impossible |

### Grants and policies

| Pattern | Example |
|---|---|
| **Relying on the environment, not the migrations** | no migration enabled RLS; the dashboard's event trigger did. A rebuild produced an open database. **Second instance:** `private.current_checkin_date(uuid)` came out `anon`-executable, because an *overload* is a new object inheriting none of the original's grants. Revoke in the migration that creates the function |
| **RLS mistaken for a WHERE clause** | the dashboard read `group_members` with no `.eq("user_id", …)`, reasoning RLS had scoped it. It had — to the caller's *Circles*, not their *memberships*. A Circle of three rendered three times |
| **A table-level grant hiding behind a column-shaped question** | `information_schema.column_privileges` lists every column a role can read, whether granted individually or via one table grant. `users` looked column-scoped for a whole audit and was not: a column `revoke` removed nothing, and every future column would have been circle-readable by default. Ask `has_column_privilege` |

**The rule, stated once:** RLS bounds what you *may* read. It never expresses what you *meant* to read. Grants are checked **before** RLS, so no policy rescues a missing grant.

### Application-shaped — appeared once the UI existed

| Pattern | Example |
|---|---|
| **Stale `useActionState` outliving what produced it** | found twice in one session. A returned invite token kept displaying after the link was revoked; a failed check-in's error stayed after a successful undo. **An action result is a fact about one past submission, not the current state.** Render from the server prop |
| **State in two places, one unreachable** | `@upstash/ratelimit` caches refusals in-process by default, so clearing Redis left the server still refusing. When a library offers a cache "for free", ask what clears it |
| **A client's clock is not the database's** | **Predicted here, then met in the wild.** `goals` has `CHECK (archived_at <= now())`, evaluated in Postgres, and `archiveGoal` sent `new Date()` from Node. A skewed dev host made every archive fail with a bare `23514`, which `toMessage` renders as "That value isn't allowed." about a button that takes no value from anyone. Both writers now send the literal `"now"`, which Postgres reads as the current transaction time, so the clock that judges the value is the clock that mints it. **Not the trigger this row used to prescribe:** a trigger that rewrites a caller's timestamp removes the error and keeps the lie. `read_at` on `notifications` had the same shape with no CHECK to catch it, which is the worse half: no error, just a row claiming you read something in the future |
| **An exemption applied to one field of a rule, not its siblings** | `circle_roster` exempted your own row from *note* masking and not from *title* masking, so your own goal read "Hidden goal" to you. `can_view_checkin_photo` was worse: hiding a goal hid your own photo from yourself |
| **A platform that renders your control differently** | iOS draws a `<select>` as a wheel and **skips disabled options**, so a disabled placeholder made the picker display the first real category while the value stayed empty. Tapping Done moved nothing, fired no `change`, and submitted nothing: the control and the form disagreed, and it read as the selection not working. Ask what a native control does with the markup, not what a desktop browser does |
| **Asking to draw under the hardware and never paying it back** | the root layout sets `viewport-fit=cover` and a translucent status bar — a deliberate request to extend under the camera housing — and no CSS ever consumed `env(safe-area-inset-*)`. On every notched iPhone the header lost its top. The request and the compensation live in different files, which is why it survived so long |
| **A permissive setting cancelled by the stricter one beside it** | `script-src` listed a nonce *and* `'unsafe-inline'`, on the theory that the dev policy kept both doors open. It does the opposite: a nonce anywhere in the directive discards `'unsafe-inline'` entirely, so the permissive-looking policy was the strict one and every un-nonced Turbopack script was blocked. Chromium tolerated it, **WebKit ran no client JavaScript at all**, and the failures named four missing pieces of text and a missing padding value. Nothing said "CSP". When two values in one setting pull opposite ways, one of them is being ignored: find out which before assuming it is additive. `'strict-dynamic'` has the same shape and is worth knowing for the same reason: it does not *add* trust for dynamically loaded scripts, it **discards `'self'`** |
| **A protection that fails as absence rather than as refusal** | `upgrade-insecure-requests` over http rewrites the page's own bundle to `https://localhost`, which nothing answers. No error, no violation, no console message: the elements are all in the DOM, correctly nonced, and simply never fetched. The first two diagnoses were about `script-src`, because a page that runs no JavaScript *looks* blocked. Chromium exempts localhost and hid it entirely; WebKit did not. **When something is missing and nothing was refused, stop reading the allowlist and ask what rewrote the URL** |
| **A writer that exists but does not mean what the caller means** | `sync_checkin_timezone` is a deliberate no-op mid-day, because it exists for automatic travel sync. Wired to a settings form it reported "Timezone updated." and wrote nothing. "Only build controls whose backend exists" is not enough — the writer's *semantics* must match the control's promise |

### Test-shaped — the e2e suite is a different lens, and its own failures find product bugs

| Pattern | Example |
|---|---|
| **A trigger that covers two of the three verbs** | `goals_maintain_completion` fires on INSERT and UPDATE, not DELETE, which is correct for production — there is no DELETE grant on `goals` — and wrong for the suite, which is the only thing that deletes them. A deleted goal left `daily_completion` describing it, and the stale row outlived the run. Ask which verbs a trigger *omits*, and who can still reach them |
| **A test that borrows state it did not create** | three consecutive failures from one habit: assuming an account had a spare goal slot, then any goals at all, then a matching clock. Real accounts get used by hand; their contents are not a fixture |
| **A test that asserts on state it does not own** | `roster.spec` asserted a row reads "1 of 2" — a claim about the *account*, not the fixture. The day the joiner had two goals of their own it read "2 of 4" and four tests failed at once. `parkActiveGoals` archives everything else for the duration. **Second instance:** a seeded three-day streak read as four, because a real completed day sat immediately before it and the walk kept going. `parkCompletionHistory` is the same fix for `daily_completion` | **Third instance, and the sharpest:** six gate tests assumed the owner had something left to do today. That was never a fixture, just a fact that happened to hold, and it stopped holding the day every goal was checked off by hand. The trigger was another test's *cleanup*: `a finished day` parks and restores every goal, which recounts `daily_completion` and so corrected a stale row mid-file, and every test after it inherited a correctly finished day. `ensureUnfinishedDay` seeds one unchecked goal in a `beforeEach`. **Fourth instance, hours later:** two streak tests assumed the owner's `user_lifetime_stats.current_streak` was zero, which `parkCompletionHistory` never touched because the streak is not in `daily_completion`. They failed the morning the rollover cron settled a completed day and made it 1 — the first time the trigger was a **cron** rather than another test. The helper now parks the stat too |
| **Cleanup that only runs on the happy path** | the seed helper threw between two inserts, before `return`, so no `finally` ran. Eight strays later every roster test failed on the goal cap, naming the cap and never the leak. **A Playwright timeout kills a test without running `finally` at all**, so anything touching real data needs a journal too |
| **A locator that describes what the click changes** | filtering a row by `has: button "Check in"` stops matching the instant the button becomes "Undo", so the follow-up assertion resolves to nothing and reports as a missing Undo rather than as a successful check-in. Find it by the state you are changing, then re-find it by something that does not change — its title. Third instance, after `expanded: false` in `roster.spec`. |
| **An assertion that cannot fail** | **Three instances, all caught by reading the test rather than running it.** A check that day six was absent looked for its *ISO date*, which the panel never renders — it would have passed however many boxes appeared. Five install tests planted `beforeinstallprompt` themselves, so every one would have passed with the root layout's listener deleted. And date tests in a **UTC runner** cannot fail, because the correct code and the offset-shifting code agree there. Ask of any new test: what edit would make this red? |
| **A wait that can pass before the work starts** | the timezone test waited for text that was also static helper copy. It matched instantly, the database read ran mid-action, and the failure looked like a broken RPC. Wait on text that exists *because* the server did something |

**Three related traps, all hit while fixing the above:**

- Clearing state in a form's `onSubmit` unmounts a form mid-submission and can abort the action. Close panels on the *result*.
- Doing that in a `useEffect` trips `react-hooks/set-state-in-effect`; adjust during render with the previous-value pattern.
- `page.content()` includes the RSC stream, so every prop is in the document whatever renders. It is the right tool for "this must never reach the browser" and the wrong one for "this must not be shown".

---

## Standing checks

Run after any migration, and before any step is called done.

### Grants and reachability

```sql
-- Anything anon can reach. Expect exactly one row: public.circle_preview.
select p.oid::regprocedure::text
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private')
  and has_function_privilege('anon', p.oid, 'EXECUTE');
```

```sql
-- Column reachability, asked the way that cannot be fooled by a table grant.
select has_column_privilege('authenticated','public.users','<column>','SELECT');
```

- A new column on a table with **column-level** grants is invisible and unwritable until named. Grant it deliberately.
- A `CREATE OR REPLACE` at an **unchanged signature** keeps its grants. A changed signature is a new object with none.
- Assert both directions in the migration itself, so it refuses to land rather than failing later from a screen that used to work.

### The error contract

```sql
-- Every HINT any function raises. Compare with BY_HINT in lib/errors.ts.
select distinct m[1]
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
cross join lateral regexp_matches(pg_get_functiondef(p.oid), $re$hint\s*=\s*'([A-Z_]+)'$re$, 'g') m
where n.nspname in ('public','private') order by 1;
```

Both directions matter: raised-but-unhandled prints a raw Postgres message at someone; handled-but-unraised is dead code that hides a renamed hint.

### Writers and readers

```sql
-- Every enum value, and whether any function body mentions it.
-- Read the callers, not the enum: three times this session I claimed a value
-- had no writer because I had only read the type.
```

- Every enum value should have a writer, or a note saying why not.
- Every column should have both a reader and a writer.
- An RLS refusal carries **no HINT** — a bare `42501` that `lib/errors.ts` cannot resolve. Check ownership in the action too, and let the policy be the backstop.

### Data hygiene

```sql
select
  (select count(*) from public.notifications n
     left join public.groups g on g.id = (n.payload->>'group_id')::uuid
   where n.payload ? 'group_id' and g.id is null) as orphaned_notifications,
  (select count(*) from public.goals where title like 'E2E %') as stray_goals,
  (select count(*) from public.groups where name like 'E2E %') as stray_circles;
```

Run `get_advisors` for `security` after any DDL. Known and deliberate: `rls_enabled_no_policy` on `audit_log` and `username_history`; the `SECURITY DEFINER` warnings are the RPC design itself.

---

## Schema change routine

1. Write the migration with its **assertions at the bottom**. Grants, and anything the change is supposed to guarantee.
2. Apply it.
3. **Prove it in a rolled-back transaction**, both directions. A constraint tested only in the refusing direction can be a typo that refuses everything.
4. Regenerate `lib/database.types.ts`. On Windows use `| Out-File -Encoding utf8`, never `>`, which writes UTF-16LE — `tsc` accepts it and ESLint calls it binary.
5. `tsc` and `eslint`, then the e2e suite.
6. Record the reasoning in `history.md` and any new shape here.

**Postgres rule:** adding an enum value and *using* it must be separate migrations.

**A freeze test has to mutate afterwards**, or it is only testing a label.

**A test that plants its own fixture can still be passing on someone else's data.** `dashboard.spec.ts` inserted a `digest` and asserted an unread badge; 11c stopped the badge counting digests, and the test kept passing on the owner account's *real* unread rows. It failed the day that account was tidy. When a test asserts a count or a presence, plant the thing **and** assert on wording only its own fixture produces.
