# Solarity: Build Plan

**What the work is.** Next steps, open decisions, bug patterns, and the checks that catch them.

This doc does not describe the system. What exists and why it is shaped that way lives in `architecture.md`; build phases, naming and the deferred visual design live in `product-and-design.md`.

**Three bands, in reading order.** *Do* is what to work on now. *Reference* is what to consult while working. *History* is the change log, which is at the bottom because it is read once and next steps are read daily.

---

# Do
## The core loop

Finish this before the public surface. The backend for every step is already built and tested, so it is UI over a known-good foundation, and it is the only work that tests the product's premise.

Ordered so the app works **alone** before it works **together**: streaks can be proven with one account, invites need two.

| # | Step | State |
|---|---|---|
| 1 | Browser verification of the auth skeleton | ✅ 12 Aug |
| 2 | Circle creation | ✅ 12 Aug |
| 3 | Goals: create and archive | ✅ 12 Aug |
| 4 | Check-in write and today's panel | ✅ 14 Aug |
| 5 | **Milestone: streak reads 1** | ✅ 14 Aug |
| 6 | `/circles/[id]` | ✅ 14 Aug |
| 7 | Invites and joining | ✅ 14 Aug |
| 8 | Real dashboard | |
| 9 | Install nudge, then push permission | |
| 10 | Security headers | |

Steps 1 to 4 are in the change log. Steps 5 to 7 are kept below despite being done, because the reasoning behind the streak display rule, the Circle page and the invite decisions is still the reference for step 8. **The only open work in this section is 7g.**

### 5. Milestone ✅

Sign in → username → Circle → goal → check off → streak reads 1. **Confirmed in the browser on 14 August**, and the behaviour is correct rather than merely present.

**The display rule.** `TodayPanel` shows `current_streak + (1 if today complete)`, so a day finished today reads immediately rather than waiting for the rollover.

Storing that sum would be wrong: today's completion is reversible until the day ends. Undo a check-in and it flips back; add a goal and the denominator grows; archive one and it re-completes. A stored streak would have to *decrease*, which is how people stop trusting the number. The counter holds settled days only, and today is added at read time.

**The double count was the thing to watch**, and it did not happen: after the rollover the number stayed at 1 rather than jumping to 2. A 2 would have meant the display rule and the rollover disagreed about which day is "today", which is the whole risk of adding today at read time.

### 6. `/circles/[id]` ✅

Header, deadline banner, group streak, and two URL-addressable tabs: Members and Overview.

**An unreachable Circle sends you home with a notice, not a 404.** The usual way to land there is a digest notification for a Circle you have since left or been removed from, and a dead end is a poor answer to a tap the app itself invited. `/dashboard?notice=circle-unavailable` renders a dismissible banner.

The notice text is looked up by key rather than read from the URL: rendering arbitrary query text would let anyone craft a link that puts words in the app's mouth. The cost is that the original URL is not preserved.

**Tabs are links, not client state.** `public/sw.js` deep-links to `?tab=overview`, so the tab has to be reachable by URL or every digest notification lands on the wrong view.

**404 covers both "no such Circle" and "not your Circle".** RLS returns nothing either way, and keeping them indistinguishable stops the page confirming a Circle exists to anyone guessing ids.

**The deadline is stated as the last playable day**, not as a bare date: "Runs through Friday 15 August, that day is fully playable; the Circle locks the morning after." A bare date is exactly the ambiguity architecture section 8 warns about.

**Per-member streaks deliberately do NOT get the dashboard's `+1 if today complete` rule.** That works on the dashboard because we know *your* check-in date. Members can be in different timezones, so this page has no single "today" to add, and guessing would print a number that disagrees with what that person sees on their own dashboard. Stored values only, with a line saying so.

Verified in SQL, rolled back. As the owner: the Circle, roster join, cycle, cycle stats and digests all read. As a **non-member**: all five return zero rows, which is what makes the page 404 rather than leak.

**Expect zeroes on a fresh Circle.** `create_circle` does not seed `group_cycle_stats`, so every member reads 0 days until the first rollover. Correct, but it looks empty at first.

*Done when:* the Circle opens from the dashboard, both tabs work by URL, and a Circle id you are not a member of 404s.

### 7. Invites and joining

Eight pieces. 7a and 7b are migrations and came first, because 7c to 7f depend on them. **7g is the only one left**, and it is cleanup the earlier pieces exposed rather than new product.

| | Piece | Why it is here |
|---|---|---|
| 7a | Error-signalling migration | ✅ done, migration 60 |
| 7b | `archive_circle` RPC | ✅ done, migrations 61 + 62 |
| 7c | `/circles/[id]/settings` | ✅ done, no migration |
| 7d | `/join/[token]` | ✅ done, migration 63 |
| 7e | Pending-streak decision UI | ✅ done, no migration |
| 7f | Invite rate limits | ✅ done, no migration |
| 7g | Hints on the remaining RPCs | ✅ done, migration 65 |
| 7h | Per-entry note visibility | ✅ done, migration 66 |

#### 7a. Error-signalling migration ✅ done

**Migration 60** added HINT codes to the four functions that raised readable messages with no code:

| Function | Codes |
|---|---|
| `enforce_active_goal_cap` | `GOAL_LIMIT` |
| `enforce_group_member_cap` | `CIRCLE_FULL` |
| `create_invite_link` | `NOT_AUTHENTICATED`, `NOT_ADMIN`, `CIRCLE_INACTIVE`, `CIRCLE_FULL` |
| `validate_progress_entry_owner` | `NOT_YOUR_GOAL` |

No logic and no signatures changed, so callers that ignore the hint behave identically.

**`lib/errors.ts` now checks the hint before the SQLSTATE.** A `BY_HINT` table holds the copy for all seventeen codes, including `join_circle`'s nine. An unrecognised hint falls through to the generic message, so adding a `raise ... using hint` in a migration and forgetting the copy degrades to something dull rather than leaking Postgres text.

**`createGoal` no longer matches on message text.**

Verified as `authenticated`, rolled back:

| Case | Result |
|---|---|
| 11th active goal | `23514` + `GOAL_LIMIT` |
| Invite link on a Circle you don't administer | `42501` + `NOT_ADMIN` |
| Check-in against another user's goal | `23514` + `NOT_YOUR_GOAL` |

Note that the first and third share a SQLSTATE and differ only by hint, which is the whole point.

**One string match survives, deliberately.** `toMessage` still compares `pg.message === "Not authenticated"` under `42501`, because seven RPCs raise that with no hint. Removing it means adding `NOT_AUTHENTICATED` to `complete_onboarding`, `create_circle`, `export_user_data`, `cycle_continue`, `cycle_reset`, `set_circle_deadline` and `transfer_ownership`. Same class of change, no new thinking, worth folding into a later migration rather than expanding this one.

`CIRCLE_ORPHANED` was added to `architecture.md` section 10 earlier, alongside `NOT_AUTHENTICATED`, which was also missing.

#### 7b. `archive_circle(group_id)` RPC ✅ done

**Two migrations, not one.** `61` adds the `group_archived` audit action; `62` creates the RPC that writes it. Postgres refuses to use a new enum value in the transaction that added it, so combining them fails at apply time and, worse, fails on a shadow-database replay after appearing to work locally. This is the gotcha from the list, met in the wild.

**Owner only, not admin.** An admin manages members and links; retiring the Circle is the one act with no undo, so it stays with the owner.

**Not reversible.** Un-archiving would have to decide whether to reopen the old cycle or start a new one, and `cycle_reset` already covers wanting to run again.

**Three things it deliberately does not do:**

| Not done | Why |
|---|---|
| Disable invite links | `trg_disable_links_on_status_change` already fires on any move away from `active`. Duplicating it means two places to keep correct. |
| Remove members | They stay in `group_members`, so the Circle keeps appearing in their Archived list with its history. Archiving retires a Circle; it does not evict people. |
| Notify members | Needs a new `notification_type` value, a writer and a digest teaser, in separate migrations. Members see it move to Archived on their next visit. Worth revisiting. |

**Closing the open cycle is load-bearing.** `run_daily_rollover` selects cycles on `ended_at is null`, not on `group_status`, so an archived Circle with an open cycle would go on advancing a group streak nobody can contribute to.

Verified as `authenticated`, rolled back:

| Check | Result |
|---|---|
| Non-member archives | rejected, `NOT_OWNER` |
| Unknown Circle id | rejected, `NOT_OWNER`, **identical** so existence is not confirmed |
| Owner archives | status `archived`, 0 open cycles, 0 live links, 1 member kept, 1 audit row |
| Archive twice | rejected, `ALREADY_ARCHIVED` |
| Join via the pre-archive link | rejected, `INVITE_REVOKED` |

**One wrinkle worth knowing.** That last row returns `INVITE_REVOKED` rather than `CIRCLE_ARCHIVED`, because the trigger kills the link before `join_circle` reaches its status check. Accurate, since the link genuinely was revoked, but less informative than it could be. Leave it unless someone finds it confusing.

Called from the settings page as of 7c.

#### 7c. `/circles/[id]/settings` ✅ done

Owner and admin. Current invite link, **Copy**, **Revoke**, **Generate a new link**, and **Archive** for the owner. Reached from a Settings link in the Circle header, shown to admins only.

**No migration.** Everything it calls already existed: the `invite_links_*_admin` RLS policies, `grant update (enabled)`, the `invite_link_toggled` audit trigger from migration 51, `create_invite_link`, and `archive_circle` from 7b. The only database-adjacent change was adding `NOT_OWNER` and `ALREADY_ARCHIVED` to `lib/errors.ts`, which 7b raised and nothing translated.

**Decision: one active link, plus an explicit revoke. Not multiple links.**

The schema permits several enabled rows per Circle; only one line in `create_invite_link` prevents it. The real gap was not the count, it was that **revoking and replacing were the same action**: to kill a leaked link you had to mint a successor you then had to avoid sharing.

So a separate revoke (`enabled = false`, no new token) rather than multiple links. Per-context links matter at scale, not at ten members, and every live link is a bearer credential. Reversible later by deleting one line.

**Revoke is deliberately the one unmetered write in the app.** It is the kill switch for a leaked bearer token, and a cap on it means a link can outlive the owner's ability to revoke it. It is also cheap, idempotent and admin-only, so there is nothing worth bounding. Generating is metered at `inviteLink` 10/hour.

**Regenerating is two-step.** `create_invite_link` disables every enabled link before inserting, so a bare button silently kills everything already shared. The confirmation says what breaks rather than asking "are you sure". Archiving is two-step for the same reason and names the Circle.

**Archive redirects to `/dashboard?notice=circle-archived`.** The settings page stops being somewhere useful to stand once invites are dead and the only remaining control is the one just pressed.

| Detail | Why |
|---|---|
| `.limit(1)`, not `.maybeSingle()`, on the live link | Only `create_invite_link` keeps it to one row. A second enabled row would turn the page into an error rather than showing the newest link. |
| Expiry computed in the page | An enabled row past `expires_at` is still `enabled`. Nothing sweeps them, and `join_circle` is what refuses. |
| Full URL built with `useSyncExternalStore` | `location.origin` is browser-only. Server renders the path, the client swaps in the origin, no hydration mismatch. Same pattern as the onboarding timezone read. |
| Non-admin hitting the URL directly | Redirected to `/circles/[id]`. Defensive only; nothing links a member here. |
| Archived Circle | Invite panel replaced with an explanation. `create_invite_link` would raise `CIRCLE_INACTIVE` anyway. |

**The link 404s until 7d.** `/join/[token]` does not exist yet, so a generated link is real and usable only once 7d ships.

#### 7d. `/join/[token]` ✅ done

**Migration 63** grants `circle_preview` to `anon`, and that is the only schema change. `join_circle` stays `authenticated`-only.

**Decision: preview works signed out.** Grant `circle_preview` to `anon`.

The plumbing already exists: the proxy treats `/join` as public, `safeRedirect` permits `/join/...` as a `next` target, and `next` survives the OAuth round trip. So:

```
/join/abc  →  name + member count, "Sign in to join"
           →  /auth/sign-in?next=/join/abc
           →  back to /join/abc, button now "Join"
```

What granting to `anon` exposes, for a token someone already holds: whether it is still live, and the Circle's name. Not a guessing risk at 32 CSPRNG bytes. The realistic case is a link screenshotted into a group chat, and a stranger checking whether it still works. That is a smaller cost than asking people to sign in before they know what they are joining.

Branch on the nine HINT codes, never on message text.

**Decision: a dead link redirects with a notice. It never renders a 404 or an error page.**

A 404 is the wrong answer to a link the app itself asked someone to share. The four dead-link cases collapse into **one** notice and one destination:

| Hint | Reached by |
|---|---|
| `INVITE_INVALID` | no such token, including a typo or a truncated paste |
| `INVITE_REVOKED` | an admin killed it, **or the Circle was archived** and `trg_disable_links_on_status_change` killed it |
| `INVITE_EXPIRED` | past `expires_at`, which is 7 days by default |
| `CIRCLE_ORPHANED` | the Circle exists with no owner |

**The copy is "This invite link is no longer valid", not "expired".** Only one of those four cases is literally an expiry. Archiving is the common one and it produces `INVITE_REVOKED`, because the trigger disables the link before `join_circle` reaches its status check. Saying "expired" would be wrong most of the time, and it invites the reply "but you only sent it yesterday".

**Collapsing them is also a security improvement**, which is the reason to prefer it over four tailored messages. Distinguishing `INVITE_INVALID` from `INVITE_REVOKED` confirms to anyone guessing that a given token was once real. One message for every dead link removes that signal, and matches how `/circles/[id]` already refuses to distinguish "no such Circle" from "not your Circle".

**These three keep their own messages and do NOT redirect:**

| Hint | Why it stays on the page |
|---|---|
| `CIRCLE_FULL` | a true statement about a Circle that exists. Someone may leave; telling them the link is broken is a lie that stops them asking. |
| `CIRCLE_LOCKED` | the cycle finished. The Circle may reset and reopen. |
| `CIRCLE_ARCHIVED` | reachable only if a link somehow outlives the trigger. Kept for the same reason: it is a fact about the Circle, not about the link. |

**Two destinations, because a signed-out visitor has no dashboard.**

```
signed in   →  /dashboard?notice=invite-invalid
signed out  →  /?notice=invite-invalid
```

**This forced `Notice` out of `app/(app)/dashboard/`** and into `components/notice.tsx`, because the landing page cannot import from a route group it does not belong to. The lookup-by-key rule came with it: rendering arbitrary query text would let anyone craft a link that puts words in the app's mouth.

**`circle_preview` is the second exemption from the "RPCs only in `app/actions/`" lint rule**, in `lib/supabase/circle-preview.ts`. Narrower than the first: `checkin-date.ts` has nothing worth metering, whereas this is now the app's only unauthenticated endpoint and needs the per-IP limit from 7f. The exemption is conditional on the single call site metering it. A server action was the alternative and is worse, publishing a POST endpoint for a value only ever read during render.

**Signed in with no username is its own case.** Joining would write a null into the `invite_accepted` notification every existing member receives, so the button becomes "Finish setting up" and links to `/onboarding`. The link still works afterwards.

Verified as `anon`, then as a second real user, rolled back:

| Check | Result |
|---|---|
| `anon` previews a live token | `ok`, with the Circle's name and member count |
| `anon` previews a bogus token | `not_found`, **name and count both null** |
| `anon` calls `join_circle` | refused, no `EXECUTE` |
| Second user joins | returns the group id, 2 members |
| Joins again | idempotent, same group id, still 2 members |
| Joins with a bogus token | `INVITE_INVALID` |
| Joining a Circle on a 5-day streak | `streak_grace = true`, `streak_decision_pending = true`, joiner recorded in `pending_streak_joiners` |
| Owner notified | 1 `invite_accepted` row |
| Preview after revoke | `revoked` |
| **Preview after archive** | **`revoked`**, not `circle_archived` |

**That last row is the one that matters for the copy.** `circle_preview` checks `enabled` before `group_status`, and `trg_disable_links_on_status_change` has already turned the link off by the time anyone opens it, so an archived Circle is indistinguishable from a revoked link. It takes the dead-link redirect, which is what was wanted, and it is why the notice does not say "expired".

**7e shipped alongside this**, and had to. The test above left a real `streak_decision_pending` with no way to resolve it from the UI, which is the setter-with-no-resolver pattern live in the product rather than in a migration.

#### 7e. Pending-streak decision UI ✅ done

**Not optional, and not polish.** `join_circle` sets `streak_grace` on the joiner and flips `streak_decision_pending` on the Circle. Only `resolve_streak_decision` clears it, and only the owner may call it. Shipping 7d without 7e recreates the exact bug an audit already found once in SQL: a setter with no resolver, where the Circle silently stops counting a member and nothing errors.

**Decision: grace stays the default. The bug is visibility, not the default.**

Both alternatives are worse. Defaulting to "counts" means a new member with no goals breaks everyone's streak on day one, so joining becomes a punishment. Defaulting to "resets" destroys a streak nobody agreed to destroy.

| Who | What they see |
|---|---|
| Owner | Banner: "2 people joined during a 14-day streak. Keep it going, or reset for everyone?" with both buttons |
| Everyone else | On the roster: "Alex is settling in and isn't counted yet" |

**No auto-resolve.** Grace persisting is harmless; a timer that silently resets a streak is a nasty surprise.

Out of scope for v1: a `streak_decision_pending` notification type. That needs a new enum value, a writer, and a digest teaser in separate migrations. The banner is enough while the owner visits the Circle.

**No migration.** `resolve_streak_decision` has existed since migration 51 with no caller; 7e is the caller.

**The copy states consequences, not verbs.** "Keep the 14 day streak" and "Start everyone over at 0", rather than "Keep" and "Reset". The bare verbs do not say *whose* streak, and the answer is everyone's, including members who earned it before the newcomer arrived.

**Two-step on reset only.** Keeping is the reversible answer: the newcomer simply starts counting today. Resetting destroys a number for every member with no undo, so it gets the confirmation archiving gets. A missing `choice` field is rejected rather than defaulting, so no path exists where a streak dies without being chosen.

**Names come from the roster's `streak_grace` flag, not from `pending_streak_joiners`.** The latter holds raw ids and would need a second query to render. `join_circle` writes both in one statement, so they cannot disagree.

Verified as `authenticated`, rolled back:

| Check | Result |
|---|---|
| Plain member reads `streak_decision_pending` | yes, so the roster indicator works for non-owners |
| Plain member reads `streak_grace` | yes |
| Non-owner resolves | refused, `insufficient_privilege` |
| Owner keeps | streak stays 14, pending false, 0 members in grace, 1 `group_streak_continued` |
| Resolve a second time | refused, "There is no pending streak decision for this circle" |
| Owner resets | streak 0, 0 in grace, 1 `group_streak_reset` |

**One rough edge, left alone.** `resolve_streak_decision` raises without HINT codes, so a non-owner reads "You don't have access to that" from the `42501` fallback. Unreachable from the UI, which only renders the buttons for the owner, and fixing it belongs with the same migration that gives the other seven hintless RPCs their `NOT_AUTHENTICATED`.

#### 7f. Invite rate limits ✅ done

Two different attacks, two different keys. `/join/[token]` is the only endpoint a stranger can reach without an account, and `circle_preview` answers "is this token real" for free, so it is the one place enumeration is worth bounding.

| Limit | Key | Applied to | Stops |
|---|---|---|---|
| `inviteAttempt` 20/hour | client IP | preview **and** join | one machine trying many tokens |
| `inviteToken` 60/hour | **hash of the token** | preview only | many machines hammering one token |

**Hash the token before using it as a Redis key.** A raw token is a live bearer credential, and a key name reaches the keyspace, `SCAN` output, slow-query logs and any dashboard someone opens. SHA-256 truncated to 32 hex characters, which is 128 bits: past the point a collision matters for a counter.

**Rejected: a `failed_attempts` counter on `invite_links` that auto-disables after N.** It reads as tidy and is a self-inflicted denial of service: anyone who learns your token can kill your link by failing against it. A limiter should slow an attacker, never disable the victim's resource.

**Two deviations from the original plan, both from that same principle.**

*The token limit is 60/hour, not 10.* An invite gets pasted into a group chat and opened by everyone at once. At 10 the ninth and tenth people see a refusal caused by their own friends, which is the `failed_attempts` failure wearing a different hat: a limiter that disables the resource it protects. 60 still stops a script and cannot be reached by nine people opening a link.

*The token limit is on the preview, not on joining.* A cap on joins per token is worse than useless: a Circle holds 10 people, so a legitimate link is only ever joined 9 times, and anyone holding it could lock out the people it was shared with. Joins stay bounded by the per-user `joinCircle` 10/hour and the per-IP limit.

**`x-forwarded-for` is only trustworthy behind a proxy that overwrites it.** Vercel does. Served without one, a client can set the header itself and mint a fresh bucket per request, so this bounds enumeration rather than stopping a determined attacker. `lib/request-identity.ts` falls back to a single shared bucket rather than to something unique, because a per-request fallback would disable the limit precisely when the header is missing.

**A refusal renders as itself, never as a dead link.** Telling someone their invite is invalid when it is fine, and would work again in ten minutes, sends them back to the inviter for a replacement they do not need. The page says how long to wait and that the link has not expired.

Covered by `e2e/rate-limit.spec.ts`, signed out, which also asserts the first attempt behaves normally and that clearing the budget restores access. Without those two, a preview page broken in any way would look identical to a working limiter.

**The second assertion earned its keep immediately.** It failed on the first run and took the three streak specs with it, because `@upstash/ratelimit` caches refusals in the server process by default. See `ephemeralCache` in architecture section 2b. The limiter was correct; clearing it was impossible.

#### 7g. Hints on the remaining RPCs ✅ done

**Migration 64.** The last of step 7, and the debt 7a knowingly took on: it fixed the four functions about to get UI callers and left the rest. Two things have since gone wrong for exactly that reason, so this closes it.

**Why now rather than later.** `/circles/[id]/settings` is the natural home for deadline editing, and that is the moment `set_circle_deadline` gets its first UI caller. Every one of its refusals would then need to explain itself, and two of them currently cannot.

##### Scope: 9 functions, 20 raises

Verified closed: exactly these nine raise a bare `Not authenticated`. `join_circle`, `create_invite_link` and `archive_circle` already carry the hint.

| Function | Raise | Hint |
|---|---|---|
| `complete_onboarding` | not authenticated | `NOT_AUTHENTICATED` |
| | username changed < 14 days ago | `USERNAME_RENAME_TOO_SOON` **new** |
| | unrecognised timezone | `TIMEZONE_INVALID` **new** |
| `create_circle` | not authenticated | `NOT_AUTHENTICATED` |
| `export_user_data` | not authenticated | `NOT_AUTHENTICATED` |
| `sync_checkin_timezone` | not authenticated | `NOT_AUTHENTICATED` |
| | unrecognised timezone | `TIMEZONE_INVALID` |
| `cycle_continue` | not authenticated | `NOT_AUTHENTICATED` |
| | not owner or admin | `NOT_ADMIN` reused |
| | deadline moved backwards | `DEADLINE_BACKWARDS` **new** |
| `cycle_reset` | not authenticated | `NOT_AUTHENTICATED` |
| | not owner or admin | `NOT_ADMIN` reused |
| | no active cycle | `NO_ACTIVE_CYCLE` reused |
| `resolve_streak_decision` | not authenticated | `NOT_AUTHENTICATED` |
| | not owner | `NOT_OWNER` reused |
| | no decision pending | `NO_PENDING_DECISION` **new** |
| `transfer_ownership` | not authenticated | `NOT_AUTHENTICATED` |
| | not owner | `NOT_OWNER` reused |
| | target not a member | `NOT_A_MEMBER` **new** |
| | already the owner | `ALREADY_OWNER` **new** |
| `set_circle_deadline` | not authenticated | `NOT_AUTHENTICATED` |
| | circle not active | `CIRCLE_NOT_ACTIVE` → **`CIRCLE_INACTIVE`** |

Six new codes, one retired. `BY_HINT` goes 17 → 22.

##### Decision: shared hints get caller-neutral copy

The easy mistake, and the one worth writing down. `NO_ACTIVE_CYCLE` currently reads *"…so there's no deadline to set"*, false the moment `cycle_reset` raises it. `CIRCLE_INACTIVE` reads *"…so it can't take new invites"*, false when `set_circle_deadline` raises it.

**Copy that mentions the caller's intent cannot be shared between callers.** Both get reworded to state the fact and stop: "That Circle has no cycle running right now", "That Circle isn't active".

##### Decision: the rename goes `CIRCLE_NOT_ACTIVE` → `CIRCLE_INACTIVE`

Migration 53 named the condition; migration 60 named it again, differently, with byte-identical message text. The newer name wins because `create_invite_link` already raises it and has a live caller, so renaming that one would be a behaviour change to shipped code. Renaming the older one is not: `set_circle_deadline` has no caller at all.

##### Decision: the timezone raise stops echoing user input

`'Unrecognised timezone: %', p_timezone` under `22023` currently reaches the user verbatim, so the app repeats arbitrary submitted text back at them. React escapes it, so this is not XSS, but it is the app speaking words it did not write. The hint makes the displayed copy fixed; the interpolated value stays in the Postgres log, where it is actually useful.

##### Decision: `22023` stops trusting the database's wording

**This is a deliberate behaviour change, and the only one here.**

`toMessage`'s `22023` branch returns `pg.message` verbatim. That was a sound bet on messages that already existed and were written to be read. After this migration every `22023` raise carries a hint, so the branch only ever fires for a raise written *later* by someone who forgot one, and trusting the wording of someone who already forgot to label it is a different bet entirely.

It becomes the generic message. A forgotten hint then degrades to dull rather than leaking table and column names, which is how the hint table already behaves; this makes `22023` consistent with it instead of being the one branch that trusts Postgres. The full error still reaches the server log, so nothing gets harder to debug.

##### One migration, not nine

All `create or replace`, no signature changes, no new objects, no enum values. They have to land together or `lib/errors.ts` is half-right.

##### Proving the bodies did not change

The only edits are inside `using` clauses. So after applying: strip every `, hint = '…'` fragment from the new `prosrc` and assert it is byte-identical to the old. That turns "I did not fat-finger a body while editing nine functions" from a hope into a check.

##### What shipped, and the one gap

`note_shared boolean not null default false` on `progress_entries`, granted for INSERT and UPDATE. `circle_roster` now returns note text only when the entry is shared **and** the goal is visible in that Circle; your own notes always come back to you. `checkIn` accepts the flag, and `setNoteSharing` changes it afterwards.

**The controls have nowhere to live yet, because the check-in UI has no note field at all.** `checkIn` has always read `note` from the form and nothing has ever rendered an input for it. So the write path is complete and the two form controls, the note box and the share tick beside it, land with the note UI in step 8. Recorded here rather than left as a surprise.

**Absent means private.** An unticked checkbox sends no field, so `formData.get("noteShared") === "on"` reads false, and a note with no text is forced to `note_shared = false` regardless. Both defaults point the same way on purpose.

Verified as `authenticated`, rolled back: a circle-mate sees a shared note, does not see a private one, does **not** see a shared note on a goal hidden in that Circle, and does not see the hidden goal's title. The author sees all of their own. Un-sharing takes effect immediately.

##### Tests, three layers

**SQL, rolled back.** Trigger the raises that are cheap to reach as `authenticated` and assert the hint, roughly fourteen of the twenty. The rest — `export_user_data` unauthenticated, the 14-day rename — are asserted statically by checking the hint appears in the right branch.

**Vitest, no database.** Scan `supabase/migrations/*.sql` for every `hint = '…'` and assert each is a key in `BY_HINT` or in an explicit `RETIRED_HINTS` list. Then the reverse: every `BY_HINT` key appears in some migration. Bidirectional, so a typo on either side fails, and it would have caught both problems this step exists to fix.

`RETIRED_HINTS` exists because migration 53's file will contain `CIRCLE_NOT_ACTIVE` forever. Retiring a code becomes a visible act rather than a silent one.

**No new e2e.** Nothing user-visible changes. The only two of the nine with UI callers are `create_circle` and `complete_onboarding`, whose happy paths are already covered.

**Applied as migration 65, and written in an unusual way on purpose.** Rather than retyping nine function bodies, the migration reads each definition, splices the hint in by pattern and re-executes it, so "only the `using` clauses changed" is structural rather than something to verify afterwards. Every substitution asserts it matched something, and that guard caught a bad pattern on the first attempt instead of silently leaving nine raises unlabelled.

**Verified:** 25 raises across the nine functions, 25 hints, no `CIRCLE_NOT_ACTIVE` remaining. `npm test` and `npm run test:e2e` both green on 14 August, which is also the first run where `npm test` asserted anything: it had `passWithNoTests: true` and no test files until now.

**`lib/errors.ts`:** `BY_HINT` is 22 codes, the `Not authenticated` string match is gone, and `22023` no longer returns `pg.message`. Shared codes were reworded to be caller-neutral, since `NO_ACTIVE_CYCLE` and `CIRCLE_INACTIVE` now answer for more than one function.

**`lib/errors.test.ts`** scans the migrations both ways: every hint raised has copy, every code with copy is raised. Two escape hatches, both requiring a visible edit: `RETIRED_HINTS` for codes that live on in old files, and `HINTS_APPLIED_DYNAMICALLY` for the six migration 65 attaches at apply time, which no file-scanner can see.

#### 7h. Per-entry note visibility ✅ done, migration 66

Its own migration, after 7g.

##### Migration 64 inverted this problem

**Notes are already private.** `progress_entries_select_own` is `user_id = auth.uid()`, so no circle-mate can read a note at all, and `circle_roster` never returns note text.

So 7h is not "add privacy to public notes". It is **"add the ability to share one"**. That reframing decides the default on its own: sharing is opt-in, every note ever written stays private, and nobody's existing words become visible because a migration ran. Grandfathering is not a question when the safe answer is also the no-op.

##### Shape

A boolean on `progress_entries`, defaulting to private. Not per-Circle: a per-note-per-Circle table mirrors `goal_group_visibility` for a distinction almost nobody wants, and notes are daily so it would grow fast.

**A shared note still inherits its goal's per-Circle hiding.** If the goal is hidden in this Circle, its note is not visible here no matter what the flag says. Sharing widens what a viewer may see; it never overrides the goal's own rule. `circle_roster` already masks on `goal_group_visibility`, so this falls out of the existing join rather than needing a second check.

##### Decided

| Question | Decision |
|---|---|
| Default | **Private. Sharing is opt-in**, per note |
| Scope of 7h | **Schema and the write path.** The roster renders shared notes in step 8 |
| When it can be set | **At check-in, and changeable afterwards** |

**Opt-in, because migration 64 already made every note private.** Nothing needs grandfathering: no existing note changes state, and forgetting the toggle fails toward silence rather than exposure. The opposite default would flip every note already written to visible the moment the migration ran.

**Changeable afterwards, because it is a flag read at query time.** Un-sharing works retroactively with no extra machinery, and text about someone's own life should be retractable. A write-once toggle would be a worse property for no saving.

**7h builds up to the point of display.** `circle_roster` starts returning the note text when it is shared *and* the goal is visible in that Circle; the check-in form gets the control; step 8 draws it. The alternative was shipping a control with no observable effect, which is the speculative UI this plan keeps rejecting.

##### Tests##### Tests, three layers

**SQL, rolled back.** Trigger the raises that are cheap to reach as `authenticated` and assert the hint, roughly fourteen of the twenty. The rest — `export_user_data` unauthenticated, the 14-day rename — are asserted statically by checking the hint appears in the right branch.

**Vitest, no database.** Scan `supabase/migrations/*.sql` for every `hint = '…'` and assert each is a key in `BY_HINT` or in an explicit `RETIRED_HINTS` list. Then the reverse: every `BY_HINT` key appears in some migration. Bidirectional, so a typo on either side fails, and it would have caught both problems this step exists to fix.

`RETIRED_HINTS` exists because migration 53's file will contain `CIRCLE_NOT_ACTIVE` forever. Retiring a code becomes a visible act rather than a silent one.

**No new e2e.** Nothing user-visible changes. The only two of the nine with UI callers are `create_circle` and `complete_onboarding`, whose happy paths are already covered.

**Applied as migration 65, and written in an unusual way on purpose.** Rather than retyping nine function bodies, the migration reads each definition, splices the hint in by pattern and re-executes it, so "only the `using` clauses changed" is structural rather than something to verify afterwards. Every substitution asserts it matched something, and that guard caught a bad pattern on the first attempt instead of silently leaving nine raises unlabelled.

**Verified:** 25 raises across the nine functions, 25 hints, no `CIRCLE_NOT_ACTIVE` remaining. `npm test` and `npm run test:e2e` both green on 14 August, which is also the first run where `npm test` asserted anything: it had `passWithNoTests: true` and no test files until now.

**`lib/errors.ts`:** `BY_HINT` is 22 codes, the `Not authenticated` string match is gone, and `22023` no longer returns `pg.message`. Shared codes were reworded to be caller-neutral, since `NO_ACTIVE_CYCLE` and `CIRCLE_INACTIVE` now answer for more than one function.

**`lib/errors.test.ts`** scans the migrations both ways: every hint raised has copy, every code with copy is raised. Two escape hatches, both requiring a visible edit: `RETIRED_HINTS` for codes that live on in old files, and `HINTS_APPLIED_DYNAMICALLY` for the six migration 65 attaches at apply time, which no file-scanner can see.

#### 7h. Per-entry note visibility ✅ done, migration 66

Its own migration, after 7g.

##### Migration 64 inverted this problem

**Notes are already private.** `progress_entries_select_own` is `user_id = auth.uid()`, so no circle-mate can read a note at all, and `circle_roster` never returns note text.

So 7h is not "add privacy to public notes". It is **"add the ability to share one"**. That reframing decides the default on its own: sharing is opt-in, every note ever written stays private, and nobody's existing words become visible because a migration ran. Grandfathering is not a question when the safe answer is also the no-op.

##### Shape

A boolean on `progress_entries`, defaulting to private. Not per-Circle: a per-note-per-Circle table mirrors `goal_group_visibility` for a distinction almost nobody wants, and notes are daily so it would grow fast.

**A shared note still inherits its goal's per-Circle hiding.** If the goal is hidden in this Circle, its note is not visible here no matter what the flag says. Sharing widens what a viewer may see; it never overrides the goal's own rule. `circle_roster` already masks on `goal_group_visibility`, so this falls out of the existing join rather than needing a second check.

##### The thing to decide before building

**Nothing renders a note.** Step 8's expanded row is titles and tick state only, by an earlier decision. A share toggle whose effect is invisible is speculative UI, and speculative UI is what this plan keeps rejecting.

So either 7h carries the rendering with it, or it waits for the roster to want notes. Recorded as a question rather than assumed.

##### Tests

Whatever the answers: a rolled-back SQL block proving a private note is absent from `circle_roster` for a circle-mate and present for its author, and that a shared note on a goal hidden in this Circle stays absent. That last one is the case a naive implementation gets wrong.

### 8. Real dashboard, and seeing each other

Check-in panel and Circles list are built. What remains is the half the product is actually for: **seeing whether your friends did their goals today.**

#### The feature, as asked for

> See which friends completed their goals. Per friend: a count, `# checked / # total`. Clicking a friend expands to their goals, with placeholder text where a goal is hidden.

Straightforward as a screen. It runs into four things the schema decides for us, and **two of them have no answer yet.**

#### Blocker 1: hidden goal titles are not actually hidden

`goals_select_own_or_groupmate` returns the whole row to any circle-mate and consults `goal_group_visibility` nowhere. `is_goal_hidden_in_group()` has one caller in the database and it gates **photos**.

Nothing leaks today only because nothing renders a circle-mate's titles. This feature is precisely the thing that starts rendering them.

RLS cannot fix it: masking a column for one viewer and not another is not row-level. See architecture section 4, "Hidden goals stay readable", for the options. **The shape is a `SECURITY DEFINER` RPC that returns the roster already masked**, with `SELECT` on `goals` narrowed to the owner.

**Closed before 7g, as migration 64**, verified as a real circle-mate in a rolled-back transaction and again by the Playwright suite afterwards. It is a live exposure rather than a design gap. The practical risk is nil, since the only accounts that exist are the two test ones, which is exactly why it is cheap to fix now rather than under pressure later. 7g is specced and will keep.

#### Blocker 2: "today" is per-person, and we can only compute our own

Every member has a frozen timezone and a 2 AM boundary, so `3 of 5` for a friend means *their* day, not yours. `/circles/[id]` already refuses to guess this for streaks and says so on the page.

`public.current_checkin_date()` takes no arguments and answers only for the caller. `private.current_checkin_date(user_id)` exists underneath. So the options are:

| Option | Consequence |
|---|---|
| Expose a per-user variant, or fold the date into the roster RPC | Correct. The RPC already has to exist for blocker 1, so this is close to free |
| Compute in TypeScript from `users.checkin_timezone` | Forbidden by the rule in `checkin-date.ts`, and it drifts across DST |
| Show yesterday's settled digest instead of today | Sidesteps the problem and answers a different question. Nobody opens the app to see whether their friend checked in yesterday |

#### Decided: per-Circle, on the Circle page

**Goal hiding is scoped to a Circle**, and a friend can share several Circles with you. The same goal can be hidden in one and visible in another.

So a flat "your friends" list on the dashboard has **no Circle context, and therefore no defined answer** to what should be masked. The photo policy solves its version of this with "visible if there is at least one shared Circle where it isn't hidden", which is right for a single object reached by URL and **wrong for a list**: it would surface a goal in the very Circle it was hidden in.

**Decided: the roster lives on `/circles/[id]`.** The Circle is unambiguous there, the members are already on that page, and the dashboard links to it.

Rejected: the dashboard grouping by Circle, which is the same data and the same masking rule but more screen for a view people reach one Circle at a time anyway. Also rejected, and not a real option: a flat friend list with no Circle attached, because there is no correct masking rule for one.

#### Decided: what the roster shows

| Question | Decision |
|---|---|
| Hidden goals | **A row each, name masked, tick shown.** "Hidden goal ✓" |
| Member with no active goals | **"No goals yet"**, not "0 of 0" |
| Expanded row, v1 | **Goal titles and tick state only.** No notes, no photos |
| Masking enforcement | **`SECURITY DEFINER` RPC**, with circle-mate `SELECT` on `goals` revoked |
| Roster order | **You first, then joined order** |
| Blocking | **Unchanged.** A block hides the profile, not goals |
| Whose "today" | **Each member's own**, returned by the roster RPC |

**Hiding a goal means "don't show what it is", not "don't show anything about it".** The tick stays, so the rows reconcile with the `3 of 5` in the header and nothing looks broken. The cost, stated plainly: a circle-mate learns that a private goal was or wasn't done. That is the accountability the Circle exists for, and a hidden goal that also hid its state would quietly opt out of it while still counting toward the streak everyone shares.

**"No goals yet" rather than "0 of 0".** The system still counts that day as incomplete, and `daily_completion` records it that way; the roster just declines to render a meaningless fraction. Worth remembering that the two are saying different things.

**Check-in notes have the same hole as titles, and it closes at the same time.** `progress_entries.note` is readable by any circle-mate today. The masking migration narrows `SELECT` on that table to the owner as well; the roster RPC reads it as `SECURITY DEFINER` and supplies tick state without ever returning note text.

That is a tightening only, so it forecloses nothing. See **7h** for the toggle that follows.

**Notes and photos stay out of v1.** `progress_entries.note` is readable and would sit naturally beside the tick, but photo check-ins have their own visibility function and no UI anywhere, and pulling them in drags an unbuilt feature into step 8.

**The RPC is the enforcement, not the app.** It returns the roster already masked, so a hidden title never leaves the database. `SELECT` on `goals` narrows to the owner, which means any *future* read of a circle-mate's goals has to go through the RPC as well. That is the point rather than a side effect: the current design failed precisely because it left masking to a layer that could be bypassed.

**You first, then joined order.** Deliberately not "incomplete first": a roster that reshuffles as the day progresses cannot be looked at twice, and section 13 already reserves ranking for the leaderboard. Your own row leads because it is the one you act on, which does mean no two members see the same list.

**Blocking stays as it is.** A block hides `user_lifetime_stats` and nothing else, so two people who share a Circle still see each other's goals after one blocks the other. The reasoning is in architecture section 4 and survives this feature: hiding goals would break the accountability the Circle exists for, and hiding identity leaves a nameless row that advertises the block louder than the block does. Worth revisiting if a Circle ever turns hostile in practice, because this feature makes the situation far more visible than it is today.

**Each member's "today" comes from the RPC.** Computing it in TypeScript is forbidden by the rule in `checkin-date.ts` and drifts across DST; showing yesterday's settled digest answers a different question. Since the RPC has to exist anyway, it returns each member's check-in date with their counts.

`private.owns_active_goal()` is resolved separately: **investigate first**, since "owns it and it is neither achieved nor archived" reads like an intended guard on the photo-upload path. Wire it or drop it once that is known. It does not belong in 7g, whose whole safety property is that only `using` clauses change.

#### Smaller things, already decided by the schema

**The denominator counts hidden goals.** `daily_completion` is "all active goals, visible and hidden", so a friend showing `3 of 5` with two hidden is the honest rendering, and the count only adds up if hidden goals are in it.

This tells you *how many* hidden goals someone has. It stopped being a separate decision the moment hidden goals became rows: the count is visible either way. Stated here so it is a known consequence rather than a discovery.

**Blocking does not hide goals**, confirmed rather than assumed. See the decision above.

**This is a live read, not a digest read.** `digest_snapshots.summary` carries `{user_id, username, completed, streak}` per member: no goal counts, no titles. It answers "how did yesterday end", which is the Overview tab. Today's roster has to come from `goals` and `progress_entries`.

**Read it in one query, not per member.** Expanding a row should reveal data already fetched, not fire a request. The roster RPC returns every member's goals and today's check-ins in one call; the expansion is presentation.

#### Inherited from 7h: three things with no home yet

7h built the whole note-sharing path and stopped at the glass, because there is nowhere to put a control. Step 8 owns all three.

| Gap | Detail |
|---|---|
| **No note input, and there never was one** | `checkIn` has read `note` from the form since it was written; nothing has ever rendered a field for it. So `progress_entries.note` is writable only by hand |
| **No share tick** | `checkIn` accepts `noteShared`, defaulting to private when the field is absent. The checkbox belongs beside the note box |
| **`setNoteSharing` has no caller** | Changing your mind after posting. Wants an affordance on the note wherever it is displayed, not on the check-in form |

That last one is the pattern this project keeps catching, a writer with nothing invoking it. It is written down with a named consumer one step away, which is the difference between a plan and a hole, but it is only that until step 8 ships.

**The roster reads notes already.** `circle_roster` returns note text when the entry is shared and the goal is visible, so the expansion has the data the moment it wants to draw it. This is what reopens the earlier "titles and tick only" scope: the note is there, and showing it costs one line.

#### Still to place

Overview subtab, notifications subtab, and where `/profile/[username]` fits. All orphaned routes today.

*Done when:* opening a Circle shows every member, their `# checked / # total` computed in their own timezone, expandable to their goals with hidden ones shown as placeholders, and a Playwright test proves a hidden goal's title is absent from the response body rather than merely absent from the screen.

### 9. Install nudge, then push permission

Appended to onboarding, in that order.

Last of the loop work, deliberately: it reshapes the end of onboarding, which is the reason signup was deferred at all.

### 10. Security headers

CSP with a nonce-based `script-src`, HSTS, `nosniff`, `Referrer-Policy`.

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

### Resolved, kept for the reasoning

- ~~**A Circle cannot be archived, and a solo owner cannot escape one.**~~ **Closed by 7b**, migrations 61 and 62. Found while testing step 6.

  | Route out | Blocked by |
  |---|---|
  | Archive it | `authenticated` has UPDATE on `name`, `default_stats_view`, `leaderboard_persists_across_cycles` only. **Not `group_status`.** |
  | Leave it | The `group_members` DELETE policy is `role <> 'owner'`, so an owner can never remove their own membership. |
  | Transfer, then leave | `transfer_ownership` needs a target member. A solo Circle has none. |
  | Delete it | `authenticated` holds no DELETE on `groups` at all. |

  The only thing that writes `'archived'` is `handle_membership_removal`, on the succession path when the last member leaves. Since the owner can never be the one to leave, that path is unreachable for a Circle of one.

  So every Circle a person creates and does not fill is permanent, and the dashboard's Archived section can only ever be populated by abandonment. That is a product hole, not just a missing button: the first thing anyone does is make a test Circle.

  **The fix is an `archive_circle(group_id)` RPC**, owner-only, matching the existing RPC pattern because it spans tables: set `group_status = 'archived'`, close the open cycle, disable outstanding invite links, and write an audit row. Belongs with `/circles/[id]/settings`, so **step 7**, alongside the error-signalling migration.

  Note that **archive and delete are different things**, and the product wants archive. Deleting erases the Circle and every trace it existed; archiving retires it while keeping the history members earned in it. Deleting is a development convenience only, and it lives in Reference under "Clearing test data".

- ~~**Error signalling is inconsistent.**~~ **Closed by 7a**, migration 60. Three patterns existed for the same job:

  | Pattern | Used by |
  |---|---|
  | HINT carrying a machine code | `join_circle`, 9 codes. **This is the right one.** |
  | `invalid_parameter_value` (22023), message shown verbatim | `complete_onboarding`, `cycle_continue`, `cycle_reset`, `set_circle_deadline`, `transfer_ownership`, `sync_checkin_timezone`, `resolve_streak_decision` |
  | `check_violation` (23514), readable message, no hint | `enforce_active_goal_cap`, `enforce_group_member_cap`, `create_invite_link`, `validate_progress_entry_owner` |

  The third pattern is the problem: 23514 cannot be shown in general because most of them are Postgres-generated and leak column names, so `createGoal` matches on message text. That is precisely what `toMessage` exists to avoid.

  **Fix at the start of step 7**, not before and not later.

  Step 7 builds invites and joining, which is where `enforce_group_member_cap` and `create_invite_link` both fire. The message-text hack would go from one instance to three inside a single step, and that is the point where a contained ugliness becomes the house style.

  The fix was small: one migration adding HINT codes to those four functions, copying what `join_circle` already does, `toMessage` learning to prefer `error.hint` over the SQLSTATE, and `createGoal` dropping its string match.

  **It left two loose ends, both found in the audit after 7c.** Migration 60 named a condition `CIRCLE_INACTIVE` that migration 53 had already named `CIRCLE_NOT_ACTIVE`, with identical message text, so the codebase now has two hints for one condition. And `set_circle_deadline`'s three hints had no reader at all, because it has no UI caller yet. Both are handled in `lib/errors.ts` rather than by a migration: renaming a hint is a behaviour change for anything already branching on it. Converge the names the next time `set_circle_deadline` is rewritten.

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
- Invite failures return machine codes (`INVITE_EXPIRED`, `CIRCLE_FULL`, and so on). Branch on those, not message text. `architecture.md` section 10.
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

# Deferred

## Public surface and email signup

Deferred until the core loop works end to end. All of the design thinking is settled; what follows is the sequence and the traps.

### Sequence

1. **Terms columns migration**, then the `complete_onboarding` migration. Regenerate types.
2. **`/support`** with the contact form, once you know what the FAQ needs to answer.
3. **Landing page** sections.
4. **Signup flow**: `/auth/sign-up`, `/auth/check-email`, `/auth/confirm`. Supabase email settings and templates first, since the flow cannot be tested without them.
5. **Password reset**: `/auth/forgot-password`, `/auth/reset-password`.
6. **IP-keyed rate limits**, and correct the `lib/ratelimit.ts` doc comment.
7. **Turnstile wiring**, then enable it in the dashboard.
8. **Gate update** and `PUBLIC_PREFIXES` extraction.

### Decisions already taken

| Decision | Rationale |
|---|---|
| Signup collects email, password, **username** | Username is the only field the product cannot run without: it appears in every roster and digest. Google users still set theirs in `/onboarding`, so both paths need the same validation. Factor it once. |
| Plus an optional **display name** | `signUp({ options: { data: { display_name } } })` writes to `raw_user_meta_data`, which `handle_new_user` already reads first. No migration, no trigger change. Optional, because `coalesce(display_name, username)` always renders something. Needs the same profanity screening as username. |
| Plus **terms acceptance**, versioned | Two new columns. "They agreed" is worth little once terms change; storing *which version* lets a future change target only who needs to re-accept. |
| **Email confirmation required** | Blocks throwaway addresses and guarantees password reset works. Costs three screens. |
| **Enumeration protection stays on** | Signup never reveals whether an address is already registered. See below. |
| Public pages: **privacy, terms, support** | No separate "How it works" page, so the landing page carries that job. |
| Contact via **form that emails you** | Needs Turnstile and its own IP rate limit. No new schema: the message goes to email and nowhere else, so it cannot become a queue nobody reads. |
| Declined: **date of birth** | Photos plus free text plus private groups normally wants an age floor, and Google will never supply one. Not a v1 blocker, but it gets more expensive with every signup. |

### How the two paths converge

Google and email signup do not run in parallel. Both create the same `auth.users` row, both fire `handle_new_user`, and both hit the same gate in `app/(app)/layout.tsx`, which checks four things in order:

```
!user                      → /auth/sign-in
!user.email_confirmed_at   → /auth/check-email
!profile.username          → /onboarding
!profile.terms_accepted_at → /onboarding
```

Google users pass the confirmation check on arrival and fail the last two. Email users do the reverse.

**Why a gate rather than the flow.** Any signup can be abandoned midway: close the tab after `signUp` succeeds and you have a real account, a real profile row, a username, and an unconfirmed address. Only something evaluated on every protected navigation catches that. `email_confirmed_at` comes off the object `getUser()` already returns, so it costs no extra query.

### Schema changes

```sql
alter table public.users
  add column terms_accepted_at timestamptz,
  add column terms_version     text;
```

Both nullable: existing rows predate the requirement. Pin the current version as a constant in `lib/legal.ts` so the value written and the document rendered cannot disagree.

**The trap.** Terms acceptance has to be recorded for Google users too, and their only touchpoint is `complete_onboarding`. That means a new parameter, and **adding a parameter to a Postgres function does not modify it, it creates an overload**. `create or replace` only matches an identical signature, so the two-argument version would survive and PostgREST would see two candidates for `/rpc/complete_onboarding` and fail with an ambiguity error. The migration must `drop function public.complete_onboarding(text, text)` first, in the same migration as the create.

Inside the function, record acceptance idempotently:

```sql
terms_accepted_at = coalesce(terms_accepted_at, now()),
terms_version     = coalesce(terms_version, p_terms_version)
```

`complete_onboarding` doubles as the username rename path. Without the `coalesce`, renaming your username two months from now silently restamps your acceptance date to today, destroying the only record of when you actually agreed.

Land it as two migrations: columns, then function. A failure in the function body then does not roll back the columns.

### Turnstile stops being decorative

`architecture.md` records Turnstile as configured but inert, because Supabase's CAPTCHA guards only endpoints that take a `captchaToken`: signup, password sign-in, OTP, password reset. A Google-only app calls none of them.

Password auth adds all four. The keys are already in the environment, so this is wiring:

1. Render the widget on sign-up, sign-in and forgot-password using `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
2. Pass `options: { captchaToken }` to `signUp`, `signInWithPassword`, `resetPasswordForEmail`.
3. **Then** enable CAPTCHA in Supabase. Enabling before the forms send tokens breaks every password endpoint at once.

### Rate limiting has an assumption that breaks

`lib/ratelimit.ts` documents its limits as keyed by user id, which is coherent because every current action requires a session. **Signup and password reset have no session**, so both key on client IP from the forwarded header. That is a weaker key, since it groups a household together, so the limits should be generous:

| Action | Limit | Key |
|---|---|---|
| `signUp` | 10/hour | IP |
| `signInWithPassword` | 20/hour | IP |
| `resetPasswordForEmail` | 5/hour | IP, **and** 3/hour per email address |
| Contact form | 3/hour | IP |

The per-email limit on password reset is not abuse control. Without it, anyone can use your product to repeatedly email a stranger, which is how a sending domain gets flagged.

### Enumeration, and the copy that covers for it

If signup said "that email is already registered", anyone could type addresses in and learn who uses Solarity. For a private goal app used with friends, that is real information about real people.

So it never says it. Whatever you type, you get "check your email".

The cost: someone who already signed up with Google, then tries a password account with the same address, gets that message and no email ever arrives. Two things carry the weight:

- **The check-email page must show "Already have an account? Sign in", with the Google button.** It is the only thing that rescues them, because the form is not allowed to explain.
- **`/auth/forgot-password` must behave identically for real and unknown addresses**, including roughly the same response time. A timing difference reintroduces the leak the setting exists to prevent.

### Landing page contents

Declining a "How it works" page moves the burden here. A visitor needs to understand Circles, check-ins, the streak rule and the digest before "sign up" means anything.

1. **Hero.** The one sentence, plus Create an account / Sign in.
2. **The premise.** Why a small private group beats a solo habit tracker.
3. **How it works, in three steps.** Start a Circle and invite up to nine people, everyone sets their own daily goals, check in once a day.
4. **What a day looks like.** A rendered example digest. The daily-batched model is the least obvious thing about the product and much weaker in prose than shown.
5. **Streaks, honestly.** The group streak holds only if everyone completes everything. Better stated up front than discovered on day three.
6. **Install prompt.** It is a PWA, and on iOS that is the only route to notifications.
7. **Footer.** Privacy, Terms, Support, contact.

### Support page contents

Not decoration. The backend implements all of this and nothing links to any of it:

- How to delete your account, and what survives (check-ins anonymized and retained; `architecture.md` section 11).
- How to export your data. `export_user_data` exists and nothing calls it.
- What happens to check-in photos (90-day retention).
- How to report content, and what follows.
- How blocking differs from kicking.
- Why an iPhone needs the app installed to receive notifications.

### Supabase dashboard steps

None of these live in `config.toml`, which configures the local stack only.

| Setting | Value | Why |
|---|---|---|
| Email provider | enabled | Off by default on a Google-only project. |
| Confirm email | on | The decision above. |
| Minimum password length | 8 or more | Supabase defaults to 6, below current guidance. |
| Password requirements | letters and digits minimum | |
| Leaked password protection | on **if available** | HaveIBeenPwned check. **Pro plan and above**, so a launch-time item, not a prerequisite. |
| CAPTCHA | Turnstile, enabled **last** | See above. |
| Email templates | point at `/auth/confirm?token_hash={{ .TokenHash }}&type=email` | The default template uses an implicit-flow link that does not work with the SSR client. Confirmation appears broken until changed, and the failure looks like a code bug. **Most likely to cost an afternoon.** |

### Tests that actually catch things

- Abandon signup after submitting. The account must be stuck at `/auth/check-email` and unable to reach `/dashboard` by typing the URL.
- Click a confirmation link twice. The second reaches `/auth/error` with a comprehensible message.
- Let a link expire, then use resend.
- Sign up with an address that already has a Google account. Verify the copy makes sense given enumeration protection is on.
- Rename a username two months after signup, then check `terms_accepted_at` has not moved. This is the `coalesce`, and it fails silently.
- Password reset for an address that does not exist. Identical response and timing.
- Force `email_confirmed_at` to null in SQL and try to reach `/dashboard`.
- `db diff` after the migrations. A drop-and-recreate replays differently than it applied.

The invite, join, archive and streak-decision flows are now covered by Playwright rather than by hand. See "End-to-end tests" in Reference.

---

---

# Reference

Consulted while working, not read start to finish.

## End-to-end tests

Playwright, in `e2e/`, run with `npm run test:e2e`. Vitest keeps `npm test` and is told to ignore `e2e/`, because both runners default to collecting `*.spec.ts` and the split is by directory rather than by name.

**First run, on your machine and not in the sandbox:**

```
npm install
npx playwright install chromium
```

Then set `E2E_OWNER_EMAIL` and `E2E_JOINER_EMAIL` in `.env.local`. Both must be real accounts that already exist and have finished onboarding.

**`e2e/env.ts` loads `.env.local` itself.** Next.js does that for the app, which makes it easy to assume everything does; Playwright's runner is a plain Node process and loads nothing, so without this every spec fails with `NEXT_PUBLIC_SUPABASE_URL is not set` while the dev server three terminals over reads it fine.

It is called from `playwright.config.ts`, which workers re-import, and again from `e2e/db.ts`, because `npm run test:e2e:clean` runs under tsx and never loads the Playwright config. Existing environment variables win over the file, so `E2E_BASE_URL=… npm run test:e2e` still overrides, and a missing file is not an error, because CI has none.

It deliberately does not support multi-line values, `export` prefixes, or `${VAR}` interpolation. If `.env.local` grows one of those, swap in `dotenv` rather than extending the parser.

### Authenticating without Google

Solarity is Google OAuth only. Playwright cannot drive Google's consent screen, and automating it would be testing Google.

So `e2e/auth.setup.ts` asks the admin API for a magic-link token, redeems it with an ordinary anon client, and writes the resulting cookies as a Playwright storage state. No user is modified, no password is set, and nothing in the flow exists in production.

**The cookies are built by `createServerClient`, not by hand.** The session cookie is base64-prefixed, URI-encoded and chunked at 3180 characters, all three of which are `@supabase/ssr` internals that have changed before. Handing the library a cookie adapter that records instead of writing means it produces exactly what the app will later read, and an upgrade changes both sides at once.

### What the specs cover

| Spec | Flow |
|---|---|
| `invite.spec.ts` | generate, regenerate behind its warning, revoke, and that a superseded link reads as dead rather than 404ing |
| | archive a Circle, then confirm its pre-archive link takes the dead-link path |
| | signed-out preview, and that `next=` survives to the sign-in page |
| | a made-up token lands on `/`, not `/dashboard`, and reveals nothing |
| | a second account joins, and joining twice is harmless |
| `streak-decision.spec.ts` | the "settling in" marker is visible to the joiner as well as the owner |
| | owner keeps the streak; banner clears, grace ends |
| | reset asks first, cancelling leaves the decision pending, confirming resolves it |
| `rate-limit.spec.ts` | the per-IP invite limit trips, says why, and clearing it restores access |
| `masking.spec.ts` | **no browser.** A circle-mate reads nothing of another member's goals or notes through the API; the roster returns them masked |
| `boundaries.spec.ts` | **no browser.** Rules the database enforces that no screen exposes |

**`boundaries.spec.ts` was written by walking the bug list rather than the feature list**, and every test in it is an instance of pattern five, *guarded on one path, not its inverse*:

| Covered | The inverse nobody had checked |
|---|---|
| Check-ins are dated by the database | Backdating **and** postdating are both refused, and nothing is written |
| A goal belongs to its owner | You cannot check in against someone else's goal, nor impersonate them writing it. Migration 64 changed what the trigger sees here, so it needed re-proving |
| Joining grants visibility | **Leaving revokes it.** The roster refuses a former member |
| Members can leave | **The owner cannot**, which is what made the solo-owner trap real and why `archive_circle` exists |
| A revoked link is refused | An **expired** one is a different branch, reached only by time passing, and had never run |
| The goal cap holds on INSERT | It also holds on **UPDATE**: un-archiving cannot take you to eleven |

That last one guards the test suite as much as the product, since `restoreGoalSlot` depends on it.

### Rules these tests follow

**Seed with the service key, assert through the UI.** `e2e/db.ts` fabricates exactly one thing, a 14-day group streak, because there is no way to earn one inside a test. Everything else goes through the browser. A test that seeds *and* asserts via the admin client proves the database works, which SQL already proved, rather than proving a person could get there.

**They run against the real project.** There is no local Supabase stack, so every spec cleans up after itself and names its Circles `E2E …`. A crashed run leaves rows: `npm run test:e2e:clean` removes them, matching on that prefix only.

**Cleanup deletes in a specific order, and the order is load-bearing.** Memberships first, then the notifications that deleting them produces, then the Circles.

Deleting `groups` first cascades into `group_members`, which fires `handle_membership_removal`, which inserts an `audit_log` row referencing `old.group_id`. Postgres removes the parent before cascading to children, so that row no longer exists and the insert fails on `audit_log_group_id_fkey` with `23503`. The whole delete rolls back, and every subsequent run inherits the mess: one failed run left 7 Circles and 11 memberships behind.

`audit_log.group_id` is `ON DELETE SET NULL` rather than `CASCADE`, which is why the FK cannot absorb this. It tolerates a group disappearing *later*, not a row written for a group that has already gone.

The notification step is not optional either. Because the service role has no `auth.uid()`, the trigger classifies the removal as a **kick** and writes a `kicked` notification per member. Those hang off `users`, not `groups`, so deleting the Circle leaves them in a real account's feed permanently. Three per Circle, measured.

**Dev-server flakiness has its own escape hatch.** `E2E_PROD=1 npm run test:e2e` runs against `next build && next start` instead of `next dev`. Worth reaching for when a failure looks like infrastructure: `dev` streams responses and compiles routes on first visit, so a server action can be interrupted and show up as "The destination stream closed early" in the log with a button stuck on its pending label. A test that fails under `dev` and passes under `E2E_PROD=1` found a dev-server artefact; one that fails under both found a bug.

**`e2e/diagnose.ts` exists because server actions fail invisibly.** When one does, the button keeps its pending label, the URL never changes, and Playwright reports only the timed-out assertion. Attaching it before an interaction records console errors, uncaught exceptions, failed requests and any non-200 on the action's POST, and folds them into the failure message.

**Serial, one worker.** The specs share two real accounts and Circle creation is capped at 5 a day per user, so parallel workers would race into a rate limit rather than into a bug.

**Each spec file clears its own rate-limit budget first.** `invite.spec.ts` needs 4 Circles and `streak-decision.spec.ts` needs 3, against a cap of 5 a day for the owner account. Back to back that is 7, so a full run would fail on abuse control rather than on a bug, and it would fail *differently* depending on how much manual testing happened that day. `clearRateLimits()` in a `beforeAll` scopes the reset to the two test accounts by user id, unlike `scripts/reset-ratelimit.mjs`, which clears everyone and is a development convenience.

**Raising the limit was the wrong fix.** 5 a day is a product decision in `lib/ratelimit.ts`. A suite that quietly widens a production control to suit itself stops testing the product; clearing a budget is visible and scoped, changing the number is neither.

**The two accounts are interchangeable.** Nothing hardcodes a user id, email or username, and no spec asserts on a display name. Swapping `E2E_OWNER_EMAIL` and `E2E_JOINER_EMAIL` only moves which account bears the Circle-creation load, which the reset above already handles.

### Playwright MCP

`.mcp.json` configures `@playwright/mcp` for driving a browser interactively, which is a different job from the suite above: one-off "what does this actually look like" checks rather than anything repeatable. It needs no install of its own; `npx` fetches it.

## Daily workflow

```bash
npm run dev
```

The app talks to the **hosted** Supabase project through `.env.local`. `npx supabase start` is not needed; that runs a full local Postgres, Auth and Storage stack in Docker, worth doing once real users exist. Docker is required only for `db diff`, `db reset` and `supabase start`.

| Command | When |
|---|---|
| `npm run dev` | always |
| `npx supabase db diff` | after schema changes, to prove migrations rebuild |
| `npx supabase gen types typescript --project-id wyuadcnrxisqmzygzhzd > lib/database.types.ts` | after schema changes |
| `npx supabase functions deploy <name>` | after editing an Edge Function |

---

---

## Clearing test data

**Development only.** Nothing in the app does this, and nothing should: it is `postgres` bypassing RLS to erase rows the product deliberately gives no way to erase.

Deleting a Circle is **not** archiving. Archiving retires a Circle and keeps its history; deleting removes every trace it existed. Real users get archive, once it is built. Deleting exists here purely so a pile of Circles named "test" does not follow you around.

```sql
-- Look first.
select id, name, group_status, created_at from public.groups order by created_at;

-- Then remove by name, or by id if the names collide.
delete from public.groups where name in ('test', 'Morning crew');
```

What goes with it, all automatically:

| Table | What happens |
|---|---|
| `group_members` | deleted |
| `group_cycles` | deleted |
| `group_member_category_stats` | deleted |
| `digest_snapshots` | deleted |
| `invite_links` | deleted |
| `goal_group_visibility` | deleted |
| `audit_log` | **kept**, with `group_id` set to null |

`group_cycle_stats` and `group_daily_completion` hang off `group_cycles`, so they go when the cycle does.

`audit_log` is the deliberate exception. An audit trail that erases itself when the thing it describes is deleted is not an audit trail, so the rows survive with the reference cleared. Architecture section 3.

**Your own goals, check-ins and streaks are untouched.** They belong to you, not to any Circle.

---

## Forcing a rollover in development

**The hourly job finalizes *yesterday*, not today.** It selects users where

```
last_rollover_date < private.checkin_date_for(user) - 1
```

so a check-in made today only becomes eligible once the user's 2 AM boundary passes and today becomes yesterday. Waiting for the next `:05` after checking in does nothing, which is a slow and confusing way to learn that. Check first:

```sql
select left(u.username,8) as who,
       private.checkin_date_for(u.id)      as their_today,
       u.last_rollover_date,
       (u.last_rollover_date < private.checkin_date_for(u.id) - 1) as would_process_now
from public.users u;
```

`would_process_now = false` on every row means the scheduler has nothing to do and waiting is pointless.

### Forcing it

`run_daily_rollover(p_date)` bypasses the guard, which is the documented testing path. **It also advances `last_rollover_date` to the date passed**, so the later automatic run correctly skips that day. The scheduler will not double-count behind you.

What *will* double-count is running it twice by hand. The block below refuses to do that:

```sql
do $$
declare
  v_target date := '2026-08-12';   -- the day you checked in, in YOUR timezone
  v_already int;
  r record;
begin
  select count(*) into v_already
  from public.users where last_rollover_date >= v_target;

  if v_already > 0 then
    raise exception 'Refusing: % user(s) already rolled over through %. '
                    'Running again would double-count streaks.', v_already, v_target;
  end if;

  for r in select * from public.run_daily_rollover(v_target) loop
    raise notice 'users=% cycles=% locked=%',
      r.users_processed, r.cycles_processed, r.circles_locked;
  end loop;
end $$;
```

Then read the result:

```sql
select left(u.username,8) as who, s.current_streak,
       s.longest_streak_ever, s.total_days_completed
from public.user_lifetime_stats s
join public.users u on u.id = s.user_id;
```

An account that completed every active goal reads `1`. An account that did not reads `0`, which is the correct answer rather than a failure.

### Why not just wait

Waiting is the honest test and worth doing once, since it exercises the scheduler rather than a manual call. It is only unhelpful as a development loop: the wait is up to 24 hours, and nothing distinguishes "not yet eligible" from "broken".

---

## Regression checklist

Passed in full on 12 August 2026. Retained because these are the checks worth repeating after any change to auth, the proxy, the gate, or the PWA layer. Work through them in order; each fails distinctively, so an early failure tells you where to look.

### 1. Sign-in round trip

`npm run dev`, then visit `/`.

| Check | Expected |
|---|---|
| `/` while signed out | landing page with a Sign in link |
| Sign in with Google | returns to `/onboarding`, not an error page |
| `/dashboard` while signed out | redirects to `/auth/sign-in?next=/dashboard` |
| Sign in from that redirect | lands on `/dashboard`, not `/` |
| `/auth/sign-in` while signed in | redirects straight through |

If the callback fails, read the message on `/auth/error`; it carries the actual reason. A redirect-URL mismatch is by far the most likely cause.

### 2. Open-redirect guard

Visit `/auth/sign-in?next=https://example.com`, then `?next=//example.com`, then `?next=/\example.com`. Each must sign in and land on `/dashboard`, never on an external host. This is the one security-relevant piece of new code, and it is worth confirming by hand rather than by reading.

### 3. Onboarding

| Input | Expected |
|---|---|
| `ab` | rejected, 3 to 30 characters |
| `has space` or `has-dash` | rejected by the pattern |
| A profane word | rejected with a neutral message |
| A name already taken | "That username is taken." |
| A valid name | redirects to `/dashboard` |

Then confirm the row, timezone in particular, since the entire rollover keys off it:

```sql
select username, checkin_timezone, checkin_day_started_at
from public.users where id = '<your-uid>';
```

`checkin_timezone` must be your real IANA zone, not `UTC`. `UTC` means the hidden field submitted empty and client-side detection is not running.

Then visit `/onboarding` again directly. It should redirect to `/dashboard` rather than offering the form.

### 4. Gate behaviour

Every path under `(app)` must redirect to `/onboarding` when the username is null. Force the state:

```sql
update public.users set username = null where id = '<your-uid>';
```

Visit `/dashboard`, then restore the username.

### 5. PWA install

Deploy to Vercel first. Service workers require HTTPS, so this cannot be tested on `localhost` in a way that reflects production.

- Chrome DevTools, Application, Manifest: no icon errors, `display: standalone`.
- Application, Service Workers: `sw.js` activated, not redirected.
- On an iPhone: Share, Add to Home Screen, then open from the home screen. It must open without browser chrome. If Safari chrome appears, `appleWebApp` metadata is not reaching the page, and push will never work on iOS.

### 6. Regressions

```bash
npx tsc --noEmit
npx eslint .
npm run build
npx supabase db diff        # should print nothing
```

### Still unverified after this pass

- **Rate limiting.** Wired but never triggered; it takes 15 onboarding attempts in an hour.
- **Every RPC except `complete_onboarding`.** Circles, goals, check-ins and invites have all been tested in SQL and none of them through the app.
- **Email deliverability to a stranger.** Brevo delivers to the sender's own Gmail, which proves nothing about another provider.
- **Push notifications end to end.** The service worker registers, but nothing has ever sent a push to a real device.
- The profanity filter has false positives on innocent substrings. Intended, but worth knowing before someone reports it as a bug.

---

---

## Bug patterns in this codebase

Every real bug found so far fell into one of thirteen shapes. Probe for these specifically after any change.

The first six are schema-shaped and were all found in SQL. The next five appeared once the UI existed. The last two came out of the e2e suite, which is a different lens again: it exercises paths no screen offers.

| Pattern | Example found |
|---|---|
| **Setter with no resolver** | `streak_grace` set on join, never cleared, so the group streak ignored that member forever |
| **Declared with no writer** | `admin_promoted`, `invite_link_toggled`, `kicked`, `group_locked_renewal` all existed but nothing produced them |
| **Raised with no reader** | the inverse, and it needs its own check. `set_circle_deadline` raises `CIRCLE_NOT_ACTIVE`, `NO_ACTIVE_CYCLE` and `DEADLINE_TOO_SOON`; `lib/errors.ts` knew none of them, so all three fell through to the branch that prints the raw Postgres message |
| **Two names for one condition** | migration 60 named a refusal `CIRCLE_INACTIVE` that migration 53 had already named `CIRCLE_NOT_ACTIVE`, with identical message text. Grep the existing hints before inventing one. |
| **Guarded on one path, not its inverse** | owner succession guarded departures; joining an empty archived Circle recreated the ownerless state |
| **Unreachable code** | `service_role` had no grants; `private` is not addressable by PostgREST |
| **Locked column, no writer** | `username` and `checkin_timezone` blocked with nothing able to set them, making onboarding impossible |
| **Relying on the environment, not the migrations** | no migration enabled RLS, the dashboard's event trigger did. A rebuild produced an open database. **Second instance:** `private.current_checkin_date(uuid)` came out `anon`-executable, because an *overload* is a new object and inherits none of the original's grants. Revoke in the migration that creates the function. |
| **Stale `useActionState` outliving what produced it** | found twice in one session. A returned invite token kept displaying after the link was revoked; a failed check-in's error stayed on screen after a successful undo. **An action result is a fact about one past submission, not the current state.** Render from the server prop, or track which action ran last. |
| **RLS mistaken for a WHERE clause** | the dashboard read `group_members` with no `.eq("user_id", …)`, reasoning that RLS already scoped it. It did, to the caller's *Circles*. The policy is `is_group_member(group_id)`, so a Circle of three returned three rows and rendered three times, each showing a different person's role. |
| **State in two places, one of them unreachable** | `@upstash/ratelimit` caches refusals in-process by default, so clearing Redis left the server still refusing and `reset-ratelimit.mjs` looked broken. Whenever a library offers a cache "for free", ask what clears it. |
| **A client's clock is not the database's** | `goals` has `CHECK (archived_at <= now())`, evaluated in Postgres. `archiveGoal` sends `new Date()` from Node, so enough skew is refused with a bare `23514` reading "That value isn't allowed". The fix is a trigger; the tempting fix is subtracting a second, which hides the class instead of removing it. See Gotchas. |
| **A test that borrows state it did not create** | three consecutive failures from one habit: assuming an account had a spare goal slot, then that it had any goals at all, then that a clock matched. Real accounts get used by hand, so their contents are not a fixture. Create what the test needs, and undo it in `finally`. |

**The last one deserves the extra words**, because it looks like a feature every time. Preferring the value an action just returned feels responsive and skips a round trip. But `revalidatePath` already re-renders the page in the same pass the result arrives, so the optimism buys nothing and the stale copy survives the next action that should have invalidated it.

**Two related React traps, both hit while fixing the above.** Clearing state in a form's `onSubmit` unmounts a form that is mid-submission and can abort the action, so close confirmation panels on the *result* instead. And doing that in a `useEffect` trips `react-hooks/set-state-in-effect`; adjust during render with the previous-value pattern instead.

### The RLS rule, stated once

**RLS bounds what you *may* read. It never expresses what you *meant* to read.**

Dropping a filter because "the policy covers it" is safe only when the policy's predicate is **identical** to the filter you would have written. Two of the three places this codebase relies on RLS pass that test and one did not:

| Query | Policy | Verdict |
|---|---|---|
| `archiveGoal` updating `goals` by id | `goals_update_own`: `user_id = auth.uid()` | safe, predicate matches intent exactly |
| `undoCheckIn` deleting `progress_entries` | `progress_entries_delete_own`: `user_id = auth.uid()` | safe, same reason |
| dashboard reading `group_members` | `group_members_select_circlemate`: `is_group_member(group_id)` | **wrong**, broader than intent |

The third is broader on purpose, because `/circles/[id]` needs every member row to draw the roster. Same policy, two callers, only one of which wanted that breadth.

**It is invisible with one member**, which is why it survived every manual test and eight passing e2e tests. Measured: a solo Circle returns 1 row either way; add a member and the unfiltered query returns one row more. Only a React duplicate-key warning gave it away.

**A replay into a shadow database is its own category of test.** `supabase db diff` builds a fresh Postgres and runs all 67 migrations, which is the only thing that catches a history depending on state it never creates. Run it after any batch of schema work, not only before a rebuild.

---

---

## Standing checks

Re-run both after any migration. Architecture records the expected result; these produce it.

**Function posture.** Exactly one `anon`-executable function, `circle_preview` (migration 63); anything else is a finding. None with a mutable path. The count grows with each migration that adds a function: **the 41 recorded at migration 57 does not reconcile with the 51 counted on 14 August**, and migrations 58–63 added only two functions. Re-derive the number before treating a difference as a regression; the posture columns are what matter.

```sql
select n.nspname, p.proname,
       case when p.prosecdef then 'DEFINER' else 'invoker' end as mode,
       case when p.proconfig:text like '%search_path%' then 'pinned' else 'MUTABLE' end as sp,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private') order by 1, 2;
```

**Every enum value has a producer.** Should return nothing.

```sql
with agg as (
  select string_agg(pg_get_functiondef(p.oid), E'\n') as s
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private')
)
select t.typname, e.enumlabel
from pg_type t join pg_enum e on e.enumtypid=t.oid, agg
where t.typname in ('notification_type','audit_action_type')
  and agg.s not like '%''' || e.enumlabel || '''%';
```

Also run both Supabase advisors until clean. Fixing one finding can create another. Expected permanent output is listed in `architecture.md` section 4; anything beyond it is real.

---

---

## Schema change routine

Six stages, in order. Each catches a class of problem the previous one cannot.

1. **Apply** one logical group of objects, not the whole schema. Small steps mean a failure points at a specific cause.
2. **Verify structurally**: query `information_schema`, `pg_indexes`, `pg_constraint`. A migration succeeding only proves the SQL parsed.
3. **Test behaviourally** in a `DO` block: insert real rows, attempt what should fail, assert each rejection, then `RAISE` a sentinel to roll back. For RLS, `SET LOCAL ROLE authenticated` plus `set_config('request.jwt.claims', …)`; testing as the owner bypasses RLS and proves nothing.
   - **Know which error each defence raises.** An RLS violation and a missing column grant both raise `insufficient_privilege` (42501); a CHECK or trigger raises `check_violation` (23514). BEFORE triggers fire *before* `WITH CHECK`, so where both guard a rule, the trigger's error wins.
4. **Probe for gaps.** Steps 1 to 3 verify what you intended; they cannot tell you what you failed to think of. Write a block that attempts plausible abuses and *reports* which succeeded instead of asserting. This caught check-ins being accepted on archived and achieved goals: every assertion passed, because none asked that question.
5. **Run the standing checks and both advisors** until clean.
6. **Update the docs**, including deviations and why. Record confirmed-correct behaviour too. Behaviour emerging from a language subtlety, such as anonymized rows being invisible because `NULL = auth.uid()` is NULL rather than true, is exactly what a later refactor breaks by accident.

---

---

## config.toml

`supabase/config.toml` exists with `project_id = "wyuadcnrxisqmzygzhzd"`. It is committed for one reason above all: it is the only version-controlled record of which Supabase project this checkout points at. The link state lives in `supabase/.temp/`, which is gitignored.

**What it does and does not govern.** It configures the *local* stack that `supabase start` would run. The hosted project is configured through the dashboard, and nothing in this file has been reconciled against it.

**Do not run `supabase config push`.** It applies the *resolved* configuration, so every value still at a CLI default would overwrite the corresponding dashboard setting rather than being left alone. The generated `[auth]` block is entirely stock, with a `127.0.0.1` site URL and no Google provider section. Pushing it would disable Google sign-in. The file carries this warning at the top and above `[auth]`.

**What `link` actually checks.** It compares the local `[db] major_version` against the remote server. A quiet "Finished supabase link" means it matched. It is not a full config diff, so silence is not evidence that the rest of the file agrees with the dashboard.

---

---

## Brevo & email ✅ configured 12 August

The walkthrough is gone; it was a one-time task. What survives is where things live and what will bite.

| Setting | Value |
|---|---|
| Host, port | `smtp-relay.brevo.com`, 587 |
| Username | the generated `…@smtp-brevo.com` login: a generated login, **not** the account email |
| Password | an SMTP key, **not** an API key |
| Sender | the project address, verified by 6-digit code |
| Configured in | Supabase → Project Settings → Authentication → SMTP Settings |

**Two caps, independent.** Brevo allows 300/day. Supabase separately caps 30 new users/hour under Auth → Rate Limits, and that one binds first.

**Minimum interval per user is 60 seconds.** A resend button pressed twice inside a minute is silently refused, so `/auth/check-email` needs a visible cooldown.

**Inactive SMTP keys expire after 90 days.** `.github/workflows/email-heartbeat.yml` sends monthly to prevent that and fails loudly if the credential dies. Needs four repository secrets: `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY`, `BREVO_SENDER`, `BREVO_ALERT_TO`.

**Deliverability is unproven.** Delivered to the sender's own Gmail, which is the easiest case there is. Without a custom domain, SPF and DKIM cannot align, so mail to a stranger on another provider may be filtered: silently. `/auth/check-email` carries spam-folder copy as required text, not a nicety.

```bash
node --env-file=.env.local scripts/test-email.mjs you@example.com
```

---

# History

## Change log

### 14 August 2026: audit of migrations 60–67

Walked all eleven bug patterns against everything in this batch. One real finding, one regression fixed, one new test.

**Pattern 8 struck again, and I caused it. Migration 67.** `private.current_checkin_date(uuid)` came out `anon`-executable. It is a new *signature*, not a replacement of the no-argument version, so Postgres created it fresh with the default `EXECUTE` to `PUBLIC`; its twin, revoked years of migrations ago, was unaffected. Migration 64 should have revoked in the same breath as creating it.

Impact was nil, and only because two other barriers held: `anon` has no `USAGE` on `private`, and PostgREST does not expose the schema. That is exactly the situation architecture section 4 already describes, one barrier standing where two were intended. **The lesson is narrower than "remember to revoke": adding an overload creates a new object, and `create or replace` on a different signature inherits none of the original's grants.**

**Clean on the other ten.** Notably: every hint the live schema raises (22) now has copy in `BY_HINT` (22), and the sets match exactly. Every `private` helper has a caller. Every enum value has a producer. No table without RLS, no mutable `search_path`, and `circle_preview` is once again the only `anon`-executable function.

**`e2e/masking.spec.ts` is new**, and it tests at the layer the bug lived in. Every other spec drives the UI, which is the wrong tool for a leak that existed whether or not a screen rendered it: masking that happens only in React is not masking. This one holds a real signed-in session and queries PostgREST directly, as anyone with devtools would.

It also asserts the inverse, that a shared note on a *visible* goal does arrive. Without that, a roster returning no notes under any condition would pass everything while the feature was silently dead.

### 14 August 2026: 7f, and step 7 closed

The two invite limits, no migration. `lib/request-identity.ts` supplies the two identities that exist before sign-in: client IP, and SHA-256 of the token truncated to 32 hex.

Two deviations from the plan, both from the rule it already stated. The token limit is **60/hour rather than 10**, because an invite pasted into a group chat gets opened by nine people at once and 10 would refuse the last of them. And it sits on the **preview rather than on joining**, because a Circle holds 10 people, so a real link is only ever joined 9 times and a per-token join cap would let anyone holding it lock out the people it was shared with. Both are the `failed_attempts` failure in a different costume: a limiter must not disable the resource it protects.

A refusal renders as itself rather than as a dead link, with how long to wait and a note that the link has not expired.

`e2e/rate-limit.spec.ts` covers it signed out, and asserts two things beyond the refusal: the first attempt behaves normally, and clearing the budget restores access. Without those, a preview page broken in any way would look identical to a working limiter.

**The second assertion earned its keep immediately.** It failed, and took the three streak specs with it, because `@upstash/ratelimit` caches refusals in the server process by default. See `ephemeralCache` in architecture section 2b. The limiter was correct; clearing it was impossible. `clearRateLimits()` had to grow, since the invite keys carry no user id and the per-user patterns could not reach them.

### 14 August 2026: e2e suite green, and what it caught

Playwright covering 7c, 7d and 7e. **10 passing.** Getting there took five fixes, four of them in the tests and one in the app.

| Fix | Where |
|---|---|
| Cleanup deleted `groups` first, so the membership trigger wrote an `audit_log` row for a group Postgres had already removed. `23503`, rollback, and one failed run left 7 Circles and 11 memberships behind | `e2e/db.ts` |
| Cleanup also left 3 `kicked` notifications per Circle in real accounts' feeds, because a service-role removal reads as a kick | `e2e/db.ts` |
| `next=` asserted with a regex built from `encodeURIComponent(pathname)`; the app writes `next=/join/<token>` with only the token encoded. Now parses `searchParams` | `invite.spec.ts` |
| `getByText(/14 day streak/)` matched the banner *and* the button, tripping strict mode | `streak-decision.spec.ts` |
| Reading the invite `<code>` before hydration returns a relative path, and `new URL()` then throws with an error about nothing relevant. Both specs now wait for an absolute URL | both |

**The one real bug** was the dashboard listing a Circle once per member. See "The RLS rule" above. It had been there since step 2 and needed two members in one Circle to show, which no earlier test produced. A regression check now asserts the Circle appears exactly once on both members' dashboards.

**Two additions that were not fixes.** `e2e/diagnose.ts` records console errors, page errors and non-200 action POSTs, because a failing server action otherwise shows up only as a timed-out assertion with the button stuck on its pending label. And `E2E_PROD=1` runs the suite against a production build, which separates dev-server streaming artefacts from real failures.

### 14 August 2026: 7e, the resolver

`resolve_streak_decision` has existed since migration 51 with nothing calling it. 7e is the caller: an owner-only banner on `/circles/[id]`, and a "settling in, not counted yet" marker on the roster that everyone sees.

Shipped with 7d rather than after it, because 7d is what creates the pending state. Verified in SQL: both branches, the double-resolve refusal, and that a plain member can read the two flags the roster indicator depends on.

### 14 August 2026: 7d, invites that can be opened

`/join/[token]`, public, with a signed-out preview. **Migration 63** grants `circle_preview` to `anon` and is the only schema change; `join_circle` stays `authenticated`-only, verified.

**A dead link redirects with a notice instead of 404ing.** Four causes collapse into one message: unknown token, revoked, expired, orphaned Circle. Collapsing them stops the page confirming that a token was once real, and matches `join_circle` already answering `INVITE_INVALID` when the inviter has blocked you. Full, locked and archived Circles keep their own copy and stay on the page, because those are facts about a Circle that still exists.

`Notice` moved to `components/notice.tsx`; the landing page renders it, since a signed-out visitor has no dashboard to be sent to.

**Found while testing:** an archived Circle's link previews as `revoked`, not `circle_archived`, because `circle_preview` checks `enabled` first and the status trigger has already disabled the link. Good outcome, and the reason the notice says "no longer valid" rather than "expired".

**Also found:** the audit log shows regeneration writing both `invite_link_regenerated` and `invite_link_toggled` at an identical timestamp, which migration 51's comment claims it prevents. The guard was never written. Left as is, because both rows are true and suppressing the toggle would lose the record of a live credential being killed; `architecture.md` section 3 now documents reading the trail by timestamp. The comment was the wrong part.

### 12 August 2026: 7c, and the audit after it

`/circles/[id]/settings` built with **no migration**: the RLS policies, the `enabled` grant, the `invite_link_toggled` trigger and both RPCs already existed. Invite link with copy, an explicit revoke, a two-step regenerate, and a two-step archive for the owner. Reached from a Settings link in the Circle header, admins only.

**Revoke is the one deliberately unmetered write.** It is the kill switch for a leaked bearer token, and a cap on it means a link can outlive the owner's ability to turn it off.

Seven fixes from the audit that followed:

| Fix | Class |
|---|---|
| Invite panel preferred the action's returned token over the server prop, so generate-then-revoke kept showing a dead link | stale `useActionState` |
| `TodayPanel` shared one error line between check-in and undo, so a failed check-in's error survived a successful undo | stale `useActionState` |
| `CIRCLE_NOT_ACTIVE`, `NO_ACTIVE_CYCLE`, `DEADLINE_TOO_SOON` raised by the database, mapped by nothing | raised with no reader |
| `NOT_OWNER` and `ALREADY_ARCHIVED` raised by 7b, mapped by nothing, so archiving failed with "Something went wrong" | raised with no reader |
| A failed `current_checkin_date` returned in place of the **whole** dashboard, hiding goals and Circles, while the copy said only today's progress was missing | copy contradicting behaviour |
| The dashboard's "Archived (n)" section also holds `locked` Circles, which are awaiting a decision rather than retired | label narrower than its contents |
| The proxy sent `next=` without the query string, dropping `?tab=overview` from every signed-out `sw.js` deep link | lossy round trip |

The first two are the same bug in two files, which is why the pattern list gained an entry rather than the changelog gaining two lines.

### 12 August 2026: pre-commit audit

Five findings on the dashboard work. Three were real bugs, none of which had visible symptoms yet.

**`lib/supabase/client.ts` read an environment variable that does not exist.** It used `NEXT_PUBLIC_SUPABASE_ANON_KEY`; every other file, and `.env.local`, use `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The browser client was being constructed with `undefined` as its key.

Latent only because **nothing imports it yet**: every component so far is a server component, or a client component that only calls server actions. It would have detonated the first time anything did a client-side read, which is the realtime notification work in step 8. Renamed.

**`.env.example` had drifted.** Missing the four `BREVO_*` variables. A `tsc`-clean checkout could still fail at runtime for someone cloning fresh. Now verified programmatically: every variable the code reads is documented, and the four unused ones (Turnstile, VAPID) are correctly present for work not yet built.

**Four `user!.id` assertions and two `today!` assertions** in the dashboard. The layout guarantees a session, but TypeScript cannot see that guarantee, so an expiry between layout and render would be a runtime `TypeError` rather than a redirect. `today!` was worse: `getCheckinDate` returns `string | null`, and a null would have filtered on an empty value and silently under-reported the streak. Both now guarded, with an explicit error state rather than a confidently wrong number.

**`getCheckinDate` swallowed its error.** A failure and "no date" were indistinguishable. Now logged before returning null.

**Two identifiers redacted from the docs**: the generated `@smtp-brevo.com` login and a personal sender address. The repo appears private, so this was housekeeping rather than an incident, but neither needed to be there.

**Considered and left alone:** `archiveGoal` and `undoCheckIn` are unmetered. Both are single-row writes against your own data, bounded by the 10-goal cap, and the check-in half of any undo/redo cycle is already limited at 60/hour. Metering them while every page load runs six unmetered queries would be theatre.

### 12 August 2026: goals, check-ins, and migration 59

**Steps 3 and 4 of the core loop.** `app/actions/goals.ts` (create, archive), `app/actions/check-ins.ts` (check in, undo), `GoalsPanel` and `TodayPanel` on the dashboard.

**Migration 59 exposes `public.current_checkin_date()`.** `progress_entries.check_in_date` is NOT NULL with no default, and the INSERT policy requires the submitted value to equal `private.current_checkin_date()`: a function PostgREST cannot reach, because `private` is deliberately unexposed. So the client had to supply a value it had no way to obtain.

Computing it in TypeScript was the wrong answer. The rule is "now in the user's frozen timezone, minus two hours, cast to date". A second implementation drifts across DST and fails as an opaque RLS rejection rather than a visibly wrong date.

The read path needs the same value anyway, to show which goals are already ticked today, so an RPC wrapping the insert would not have removed the need.

The wrapper is **SECURITY INVOKER**, not DEFINER. `authenticated` already holds USAGE on `private` and EXECUTE on the underlying function, since RLS policies call it with the caller's own privileges. The wrapper grants no new capability, it only makes an existing one reachable over HTTP.

**The lint rule earned its keep.** Reading the date from the dashboard tripped the "`.rpc()` only in `app/actions/`" rule, correctly. Rather than weaken the rule or duplicate the call into three places, the fetch moved to `lib/supabase/checkin-date.ts`, which is now the rule's **only** exemption: read-only, argument-free, needed by both the read and write paths, nothing to meter. Both the file and the eslint config say why.

Verified in SQL as `authenticated`, rolled back:

| Check | Result |
|---|---|
| 1 of 2 goals checked in | `all_completed = false` |
| 2 of 2 | `all_completed = true` |
| Duplicate check-in | rejected, 23505 |
| **Backdated check-in** | **rejected by RLS**, so a hand-crafted request cannot fabricate a streak |
| Undo | day re-opens, `all_completed = false` |
| Archive the remaining unchecked goal | day re-completes, `all_completed = true` |

The last two are the denominator moving in both directions, which is the behaviour step 3b was deferred to avoid debugging prematurely.

**Run `npx supabase migration fetch`** to bring migration 59 into the repo.

### 12 August 2026: Circle creation

**Step 2 of the core loop.** `app/actions/circles.ts` wraps `create_circle` with the 5-per-day limit and profanity screening; `CreateCircleForm` on the dashboard, which now splits active Circles from locked and archived ones. Verified in SQL as the `authenticated` role before touching a browser: the RPC returns a uuid, the creator reads the Circle back through RLS, exactly one owner membership and one open-ended cycle are created, the dashboard's embedded join returns the row, and a 51-character name is rejected.

**No deadline at creation, deliberately.** `create_circle` accepts one but does not validate it is in the future, unlike `set_circle_deadline`. A form here could mint a Circle that locks at the next rollover. Circles start open-ended, which never locks, and the deadline is set later through the RPC that enforces the next-day floor. One validation rule, one place.

**Two rate-limiter defects, both found by using the thing.** This was the first time the limiter had ever fired in the product's life, and it was wrong in two ways at once.

1. **It charged for failures.** `enforce()` ran before validation, so a rejected name still spent one of five daily creations. Both `createCircle` and `completeOnboarding` now validate cheaply first and meter immediately before the first call that leaves the process. The rule is recorded in `architecture.md` section 2b and on `enforce()` itself, because putting the check first is the *obvious* reading of "check the limit before doing work" and will get rewritten that way otherwise.
2. **It could not be reset by hand.** Deleting the visible key in the Upstash console left the limit in force, because a sliding window keeps a key per window and weights the previous one into the current count. `scripts/reset-ratelimit.mjs` scans and clears the whole set.

`analytics` also turned off: it wrote extra Redis keys on every request against a free-tier command budget, to populate a dashboard nobody reads.

### 12 August 2026: verification pass, and migration 58

**Browser verification complete. All six tests passed.** The application layer has now run for the first time.

| Test | Result |
|---|---|
| 1. Sign-in round trip | Pass. `next` survives the OAuth round trip; signed-in users never see signed-out screens. |
| 2. Open-redirect guard | Pass, including `%5C`. Valid relative paths still work, so the guard is not simply refusing everything. |
| 3. Onboarding | Pass, including the case-insensitive uniqueness check. Timezone stored as a real IANA zone, not `UTC`. |
| 4. Gate | Pass. A null username bounces from every route under `(app)`, confirming one gate rather than per-page checks. |
| 5. PWA install | Pass on iOS. Opens from the home screen with **no Safari chrome**, so `appleWebApp` metadata is reaching the page and push remains viable. |
| 6. Regressions | `tsc`, `eslint`, `next build` clean; `db diff` silent. |

**Test 1 found a real bug, which is what the pass exists for.** `first_name` and `last_name` had a reader and no writer: `handle_new_user` read `raw_user_meta_data ->> 'given_name'` and `'family_name'`, keys Supabase's Google provider does not supply. Its actual keys are `avatar_url, email, email_verified, full_name, iss, name, phone_verified, picture, provider_id, sub`. Both columns were null on every account and always would have been, and `/onboarding` degraded silently from "Welcome, Ryan" to "Welcome".

**Migration 58 collapsed three name concepts into two.** A legal-shaped first/last pair earns its place in a product with billing or formal correspondence; Solarity has neither, and carrying it alongside an OAuth full name and a username made three overlapping ideas where two would do.

| Concept | Role |
|---|---|
| `username` | unique, ASCII, the identity. Rosters, digests, leaderboards. |
| `display_name` | optional, non-unique, cosmetic. Render `coalesce(display_name, username)`. |

`first_name` and `last_name` dropped, `display_name` added (1 to 50 characters after trimming, whitespace-only rejected). `handle_new_user` now reads `display_name`, then `full_name`, then `name`, truncating to 50 so an over-long value cannot abort signup over a decorative field. `export_user_data` updated, since it is a data-subject obligation and must describe columns that exist. Existing rows backfilled from Google's `full_name`.

Verified: over-length rejected, whitespace-only rejected, null accepted, exactly 50 accepted, `authenticated` holds SELECT and UPDATE on `display_name` but not on `username`, `anon` holds nothing. Types, `app/onboarding/page.tsx`, and both docs updated. `tsc` and `eslint` clean.

Migration 58 fetched into the repo: 58 files, comments intact, local and remote match.

### 12 August 2026: auth, onboarding, icons `committed as "oauth skeleton"`

The app has a running front end for the first time: sign in with Google, choose a username, land on a dashboard.

| Path | Purpose |
|---|---|
| `app/auth/sign-in/page.tsx` | Google sign-in; redirects if already authenticated |
| `app/auth/callback/route.ts` | Exchanges the OAuth code for a session |
| `app/auth/error/page.tsx` | Reports a failed or cancelled sign-in |
| `app/actions/auth.ts` | `signInWithGoogle`, `signOut` |
| `app/actions/onboarding.ts` | `complete_onboarding` with rate limiting and profanity screening |
| `app/onboarding/` | Username and timezone form |
| `app/(app)/layout.tsx` | Onboarding gate and header for every signed-in screen |
| `app/(app)/dashboard/page.tsx` | Placeholder listing your Circles |

Supporting modules: `lib/errors.ts` (SQLSTATE to message), `lib/profanity.ts`, `lib/safe-redirect.ts`.

**Icons.** Six files: `icon-192`, `icon-512`, `icon-512-maskable`, `badge-72` in `public/icons/`, plus `app/apple-icon.png` (180×180) and `app/favicon.ico`. Sizes and platform constraints are in `architecture.md` section 14. Placeholder artwork, correct dimensions.

**Four corrections made along the way**

- `middleware.ts` became `proxy.ts`, exporting `proxy`. Next.js 16 renamed the file convention and warned on every build. `sw.js`, the manifest and `/icons` were also excluded from the matcher: a service worker that receives a redirect instead of JavaScript fails to register, which on iOS means no install and therefore no push.
- `lib/database.types.ts` had every `Relationships: []` array emptied, so any embedded join (`groups(name)`) was a type error. Restored from the live schema.
- The onboarding gate went in `app/(app)/layout.tsx` rather than the proxy. In the proxy it would be a database round trip on every request, including prefetches.
- Timezone detection uses `useSyncExternalStore` rather than `useEffect` plus `setState`. The React lint rule rejects the latter, and this avoids a hydration mismatch.

**Pre-commit audit.** Comments were trimmed to local mechanics and pointers, since the rationale lives in the docs. Three findings, all fixed:

- **`Redis.fromEnv()` ran at module scope**, and `lib/ratelimit.ts` is in the import graph of every server action, so an absent Upstash variable failed `next build` rather than a request. Limiters are now built on first use, and `enforce` takes a limit name rather than an instance. `next build` succeeds with no environment at all.
- **CI ran only Vitest and `npm audit`**, and there are no tests yet. It now typechecks, lints, builds and tests, with the build step deliberately running without environment variables.
- **No `.gitattributes`**, so `.gitignore` showed as an 86-line rewrite for a 4-line change. Added, with `eol=lf` and binary rules for images.

**`supabase/config.toml` created** via `supabase init`, `project_id` set, project re-linked. See "config.toml" below.

**Email delivery.** Brevo SMTP configured in Supabase, replacing the built-in 2-per-hour demonstration sender. Verified end to end with `scripts/test-email.mjs`, which is deliberately independent of Supabase so a failure names whether the credentials or the auth configuration is at fault. Details and tripwires under Brevo & email, in Reference.

**Documentation.** `setup-checklist.md` folded into `architecture.md` section 14. `plan-public-and-auth.md` folded into this doc. Section 2b added to architecture, describing the application structure. The three docs are now split by concern: architecture records the system, this doc records the work, product-and-design owns phasing and appearance.

**Verified at the time:** `tsc --noEmit` clean, `eslint` clean, `next build` succeeds with and without environment variables, `supabase db diff` prints nothing. Browser verification came later, in the entry above.

### Earlier

- Full schema, RLS, RPCs, derived data, digest, Edge Functions and scheduled jobs built and audited. Inventory in `architecture.md`.
- Cloud state pulled into version control: 57 migrations, 4 Edge Functions.
- `next-pwa` reversed in favour of a hand-rolled service worker. Rationale in `architecture.md` section 7b.

---
