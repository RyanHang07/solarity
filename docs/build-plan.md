# Solarity: Build Plan

**Open work only.** Finished steps and their reasoning live in `history.md`; this file is read daily and should stay short.

| You want | Read |
|---|---|
| How it works now | `architecture/` |
| What keeps going wrong | `patterns.md` |
| How to run or verify it | `testing.md` |
| Designed but not built | `deferred.md` |
| Why a past decision went that way | `history.md` |

---

## The core loop

Finish this before the public surface. The backend for every step is built and tested, so it is UI over a known-good foundation — and it is the only work that tests the product's premise.

Ordered so the app works **alone** before it works **together**: streaks can be proven with one account, invites need two.

| # | Step | State |
|---|---|---|
| 1–7 | Auth, Circles, goals, check-ins, the Circle page, invites | ✅ 12–14 Aug |
| 8 | Seeing each other | ✅ 17 Aug, migrations 68–75 |
| 9 | The daily check-in flow | ✅ 18 Aug, migration 76 |
| 10 | Install nudge, then push permission | ✅ built, audited, **manual pass done**. Migrations 77–78 |
| 11 | Digest boxes on Overview | ✅ done, no migration |
| 12 | Security headers | ✅ done, audited, no migration |
| **13** | **Check-in photos** | **next**. Split out of 9; schema exists since migration 64 |

**Step 8 shipped** the `Today` roster, note sharing, goal hiding, the dashboard tabs, notifications, settings, and refresh-on-return. Eight migrations and six product bugs, all in `history.md`.

---

### 9. The daily check-in flow ✅ **done** — migration 76

`/today` greets an unfinished day with your streak, the goals still open, and nothing else. Detail and reasoning in `history.md`.

| Piece | |
|---|---|
| 9a | `users.today_screen_mode`, and the settings control |
| 9b | The route, the gate on `/dashboard`, and the two cookies |
| 9c | Streak header, including a broken run |
| 9d | Check off goals, reusing `TodayPanel` |
| 9e | Hand-off, and the skip link |

**Audited against every pattern as the list stood then, twenty of them.** Every symbol the step added has both a reader and a writer; `anon` still reaches only `circle_preview`; no orphaned notifications, stray Circles or stray goals. Two things it changed about the suite are recorded in `testing.md`.

### 10. Install nudge, then push permission ✅ **done** — migrations 77, 78

Onboarding gained two screens after the username, settings gained two controls, the worker repairs a rotated subscription, and push bodies now name their Circle. Detail, and the eight bugs found on the way, in `history.md`.

| Piece | |
|---|---|
| 10a | `subscribe_push`, the writer `push_subscriptions` never had |
| 10b–10c | Install nudge, then the one permission ask |
| 10d–10f | Device toggle, `RESUBSCRIBE_PUSH`, the dismissible nudge |
| 10g | Circle names in push, behind a per-account setting |

**Manual pass done on an iPhone.** It found the identical-notifications problem that became 10g; everything else held. **The eight flows are kept in `history.md`** rather than deleted: a permission dialog is one-shot per browser, so the next device and the next iOS version will need the same procedure.

### 11. Digest boxes on Overview ✅ **done** — no migration

Overview shows one box per day, five days, each naming the Circles that reported and — folded away — who finished and who did not. Digests left the Notifications tab entirely.

| Piece | |
|---|---|
| 11a–11b | The five-day read, the boxes, and the roll call in a `<details>` |
| 11c | Digests out of the tab, its badge, and mark-read |
| ~~11d~~ | Dropped: both ways of writing `read_at` for a digest record something untrue |

**No migration.** `digest_snapshots.summary` had carried the roll call since it was first written, so the step was a read and a render.

**Two rules it established**, both in `history.md`: `notifications` is an outbox for four event types and a **delivery queue** for digests, and the test runner is pinned to a non-UTC timezone because a UTC runner cannot fail a date test.

### 12. Security headers ✅ **done** — no migration

A CSP with a per-request nonce, HSTS, `nosniff`, `Referrer-Policy`, `X-Frame-Options` and a `Permissions-Policy` that grants nothing. Full reasoning in `architecture/security.md` section 3b.

| Piece | |
|---|---|
| 12a | The fixed headers, in `next.config.ts`, because the proxy's matcher skips `sw.js` and the static assets |
| 12b | Nonce CSP in `proxy.ts`, dev and prod branched; the layout reads `x-nonce` |
| 12c | `/api/csp-report`, logging only; `Reporting-Endpoints` **and** `report-uri`, since Safari supports only the latter |
| 12d | Header assertions on real responses, plus loading every route and asserting **zero CSP violations** |
| 12e | The headers section in `architecture/security.md` |

**Four bugs, and the shape of all four was the same.** Not one raised an error, and not one failure message named a header.

| | |
|---|---|
| A nonce beside `'unsafe-inline'` | The nonce wins and `'unsafe-inline'` is discarded, so the permissive-looking dev policy was the strict one. Chromium tolerated it; **WebKit ran no client JavaScript at all** |
| `upgrade-insecure-requests` over http | Rewrote the bundle and stylesheet to `https://localhost:3000`, which nothing answers. No block, no violation — every element in the DOM and none of them fetched. Chromium exempts localhost and hid it entirely. It now keys on the **connection**, not the build |
| `form-action 'self'` | **Found by audit, never by a test.** `form-action` is enforced at every redirect hop, and sign-in is a form that redirects twice before reaching Google. Hydrated it never applies; a **click before hydration**, on the first page a signed-out visitor sees, would have been refused |
| The report route swallowed a broken limiter | `Redis.fromEnv()` throws with no Upstash config, and the catch treated it as a refusal. An environment without those variables would have discarded every report while answering 204 and looking healthy — this endpoint's own failure mode, reproduced inside it |

**What that cost, and the lesson worth keeping:** three rounds went into `script-src`, because a page that runs no JavaScript *looks* blocked. It is now `patterns.md`'s twenty-sixth shape — **a protection that fails as absence rather than as refusal**. When something is missing and nothing was refused, stop reading the allowlist and ask what rewrote the URL.

**Two stale tests fell out of it**, both left over from 11c and both worth more than the bugs they hid: one planted a `digest` and asserted an unread badge, which had been passing on the owner account's real unread rows; the other polled *all* unread notifications to zero, which since 11c can never happen on an account with any digest history.

**`E2E_PROD=1` on the WebKit project is the run that matters.** Both browser bugs were production-only and WebKit-only, and Chromium was green through all of it.

**One thing still owed to a real device.** A dev server on plain http never sends HSTS, and no headless browser can show whether an installed PWA still receives push under the policy. Both want a look on the phone once this is deployed.

### 13. Check-in photos

**Split out of step 9**, because it is a subsystem rather than a field and bundling it would mean `/today` shipping only when the hardest part did.

**What already exists:** the storage buckets, their policies, and `private.can_view_checkin_photo` — which since migration 72 also exempts you from your own masking, and since 71 reads `goals.hidden_everywhere`.

**What does not:** any upload UI. `browser-image-compression` has been a dependency since the start and has never been imported. Migration 64 tightened `checkin_photos_insert` to require `owns_active_goal`, so the insert path has narrowed since the policy was written and has never been exercised by a real client.

**Open questions when it starts:** capture versus file picker on mobile, where compression runs, the storage path convention, and what happens to a photo when its goal is archived.

**And one that is not a question, only a thing to remember:** step 12 ships `Permissions-Policy: camera=()`. Whichever way the capture question goes, that header has to be opened in the same commit, or `getUserMedia` fails for a reason that is in a config file rather than in the code being written.

---

## Running in parallel

Independent of everything above, cheap, and it unblocks the Google consent screen.

- `/privacy` and `/terms` as static pages
- `app/robots.ts` and `app/sitemap.ts`

`sitemap.ts` **must exclude `/join/*`**: invite tokens are bearer credentials and have no business in a crawler log.

Copy gets drafted from the architecture, so it describes what the system actually does: 90-day photo retention, check-ins anonymized rather than deleted, what `export_user_data` returns. Not legal advice; review before real users.

---

## Deferred inside the loop

Two things left out of steps 3 and 4 on purpose.

### Achieving a goal → after step 5

Achieving moves the check-in denominator exactly as archiving does. Adding it before the first streak exists means debugging two denominator-movers at once, against a baseline that has never produced a correct number.

It is also unverifiable before then: `goals_count_achievement` feeds `total_goals_achieved`, which nothing reads until `/profile/[username]` exists.

The follow-up prompt (archive, edit into a new goal, or keep it active) lands with the same work.

### Goal deadlines → after a type change

Buildable now. `<input type="date">` is native everywhere and needs no library, so the earlier "that's design work" objection was wrong.

**The column is the obstacle.** `goals.deadline` is `timestamptz` and a date input submits `YYYY-MM-DD`, which stores as midnight **UTC**. Someone in `America/Los_Angeles` picks 1 September and sees 31 August when it renders back, and it looks like a bug in the picker rather than in the schema.

A goal deadline is a **calendar date, not an instant**. Postgres `date` has no timezone semantics, so the error class stops existing rather than being handled.

Cheap: zero rows today, and `export_user_data` is the only reader. Should land before anything writes to the column.

**Two design notes when it is built:**

- **Do not default to today.** The column is nullable on purpose; most daily goals have no end date. Defaulting turns an opt-in field into an opt-out one and produces goals that look overdue tomorrow.
- **No `min` attribute.** Architecture section 3 keeps this deliberately unconstrained, since recording a missed or historical deadline is legitimate.

---

## Route map

Every route the app will have, and where each stands. **Orphaned** means the backend implements it and nothing in the app links to it.

### Public

| Route | Status | Notes |
|---|---|---|
| `/` | built, placeholder | Landing. Redirects signed-in visitors to `/dashboard`. Also renders `Notice`, since a signed-out visitor with a dead invite link lands here. Needs real content; see Deferred. |
| `/auth/sign-in` | built | Google only so far. Gains a password form. |
| `/auth/callback` | built | OAuth code exchange. |
| `/auth/error` | built | Gains cases for expired and reused confirmation links. |
| `/auth/sign-up` | deferred | Email, password, username, name, terms, Turnstile. |
| `/auth/check-email` | deferred | Post-signup holding screen. Resend, spam-folder line, and a route back to sign-in. |
| `/auth/confirm` | deferred | Route handler calling `verifyOtp`. |
| `/auth/forgot-password` | deferred | Always reports success. |
| `/auth/reset-password` | deferred | Reached only with a recovery session. |
| `/privacy` | in parallel | **Required** for the Google OAuth consent screen. |
| `/terms` | in parallel | Versioned. |
| `/support` | deferred | FAQ plus contact form. |
| `/join/[token]` | built | Preview works **signed out**; join requires sign-in. A dead link redirects to `/dashboard` or `/` with a notice rather than 404ing. `robots: noindex`. Still to exclude from `sitemap.xml`. |
| `robots.txt`, `sitemap.xml` | in parallel | `app/robots.ts`, `app/sitemap.ts`. |

### Signed in

| Route | Status | Backed by |
|---|---|---|
| `/onboarding` | built | `complete_onboarding`. Gains the terms checkbox, then the install nudge and push prompt. |
| `/dashboard` | built | Check-in panel, goals, Circles with archived beneath. Still to gain: Overview and notifications subtabs (step 8). |
| `/circles/[id]` | built | Header, deadline, group streak, Members and Overview tabs, owner streak-decision banner. Closes the `sw.js` deep link. |
| `/circles/[id]/settings` | built | Invite link, revoke, regenerate, archive. Still to gain: deadline, roles, and the kick flow's "also block?" step. |
| `/notifications` | orphaned | `notifications`. The durable channel; push is best-effort. |
| `/profile/[username]` | orphaned | `user_lifetime_stats.visible_on_profile`. Where blocking lives. |
| `/settings/profile` | orphaned | Rename path. Must surface *when* the next rename is allowed, not just refuse. |
| `/settings/notifications` | orphaned | `push_subscriptions`. Per-device list; natural home for the push opt-in. |
| `/settings/account` | orphaned | `export-data` and `delete-account` Edge Functions. Both deployed and verified, neither has UI. Self-serve deletion is an Apple requirement for any future store submission. |

### Protection

`lib/supabase/proxy.ts` currently treats `/auth`, `/_next`, `/`, and `/join` as public. Three more public prefixes are coming, so extract a `PUBLIC_PREFIXES` constant rather than growing the inline boolean.

Keep the posture deny-by-default: enumerate what is *public*, so a forgotten route fails closed as a redirect to sign-in. Enumerating what is protected means a forgotten route fails open, silently.

---

---

## Open items

### Blocking

- **Migration workflow, undecided.** Schema changes currently go straight to the project, which drifts from the repo. Either continue and re-run `npx supabase migration fetch` afterwards, or write files into `supabase/migrations/` and `npx supabase db push`. The second gives review over schema changes, and the deferred signup work adds two migrations, so this wants deciding before then.

### Before launch

- Security headers.
- Wire rate limits into each new action as it is written.
- `pushsubscriptionchange` handler, a TODO in `components/service-worker-registrar.tsx`. Without it a device silently stops receiving push.
- A custom domain, if email deliverability from a personal sender proves to be a problem.

### Deferred to v2

- Replace the placeholder icons.
- All visual design. See `product-and-design.md`.

### Undecided copy

- Digest wording per Circle size.
- "Digest" versus "Daily Recap", the Group Streak label, the leaderboard label. Better decided against real screens.

### Carry into the UI

- Show the current deadline on the Circle page. `deadline_changed` covers the moment of change; a persistent display is what stops "when is this due again?" being a question.
- Invite failures return machine codes (`INVITE_EXPIRED`, `CIRCLE_FULL`, and so on). Branch on those, not message text. `architecture/app.md` section 10.
- Streaks lag a day by design. Display `current_streak + (1 if today complete)`.

---

---

## Gotchas

**A client-generated timestamp can be in the future as far as Postgres is concerned.** `goals` carries `CHECK (archived_at <= now())` and `CHECK (achieved_at <= now())`, evaluated against the **database** clock. `archiveGoal` sends `new Date().toISOString()` from the Next.js server, so any clock skew larger than the network latency is refused with a bare `23514` and no hint, which `toMessage` renders as "That value isn't allowed."

Found by the e2e suite, whose helper hit it with roughly 200ms of skew. The production risk is small, because the write travels *after* the timestamp is taken and latency pushes `now()` forward, so the client has to be ahead by more than the round trip. Small is not zero, and the failure would be baffling in a support conversation.

**The real fix is for the database to set it**, via a trigger on the transition to non-null, so no caller can get it wrong. Deliberately not patched by subtracting a second in the app: that hides the class of bug rather than removing it, and the same mistake is available to every future column with a `<= now()` check.

`archive_circle` is unaffected: it uses `now()` in SQL.


- `.rpc()` is lint-banned outside `app/actions/`. A direct call skips rate limiting and the profanity filter.
- Never hand-trim `lib/database.types.ts`. Dropping the `Relationships` arrays makes every embedded join a type error.
- **Regenerate the types with `Out-File -Encoding utf8`, not `>`.** PowerShell's redirect writes UTF-16LE. `tsc` accepts it silently; ESLint stops dead on `Parsing error: File appears to be binary`, and the header comment at the top of the file disappears without trace. Encoding is the first thing to check when a generated file lints as binary.
- Rollover runs hourly and takes **no argument**. An explicit date bypasses the idempotency guards and double-counts streaks.
- A new notification type needs three things: the enum value in its own migration, a writer, and a teaser case in `send-digest-push`.
- A new table needs an explicit `enable row level security` in the same migration. The dashboard setting does it live; no migration does.
- A new enum value and its first use must be separate migrations.
- Adding a parameter to a Postgres function creates an overload rather than replacing it. Drop first.
- Never order by or compare an enum. Postgres uses declaration order, an accident of how the type was written.
- Reference `goal_categories` by `slug`, never by hardcoded id. The UUIDs are per-environment.
- Regenerate types after any schema change.
- The root file is `proxy.ts` exporting `proxy`. Next.js 16 deprecated the `middleware` name; do not recreate it.
- Never request notification permission on page load. Browsers allow one ask and a denial is permanent.
- Brevo's SMTP login is `xxxxxx@smtp-brevo.com`, not your account email, and the SMTP key is not an API key.

---
