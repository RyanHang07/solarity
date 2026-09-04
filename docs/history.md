# Solarity: History

**Append-only.** Nothing here is a plan. It is what was built, what broke, and why the decision went the way it did — kept because this project's bugs have repeatedly been found by re-reading an old reason.

**Where to look instead**

| You want | Read |
|---|---|
| What to build next | `build-plan.md` |
| How something works now | `architecture/` |
| What keeps going wrong | `patterns.md` |
| How to run or verify it | `testing.md` |

---

### 8. Seeing each other

The half the product is for. Everything underneath it is built: `circle_roster` returns each member's counts for their own check-in date, masked, in one call.

**Eight pieces.** 8a to 8d finish the Circle page; 8e closes the last of 7h; 8f is a separate surface and can slip; 8g and 8h were added once the roster existed and showed what it was missing.

| | Piece | Migration |
|---|---|---|
| 8a | Archived Circles stop reporting live counts | ✅ done, 68 + 69 |
| 8b | `Today` tab and the roster | ✅ done |
| 8c | `Members` moves to `?tab=members` | ✅ done |
| 8d | Notes on the roster, and un-sharing | ✅ done, migration 70 |
| 8e | `+ note` and the share tick on check-in | ✅ done |
| 8f | Dashboard tabs, Overview, notifications, settings | ✅ done, 73 + 74 |
| 8g | Live roster updates, phase 1 (refresh when the tab returns) | ✅ done, no migration |
| 8h | Hiding a goal, the feature nothing can turn on | ✅ done, 71 + 72 |

#### The feature, as asked for

> See which friends completed their goals. Per friend: a count, `# checked / # total`. Clicking a friend expands to their goals, with placeholder text where a goal is hidden.

Straightforward as a screen. It ran into four things the schema decides, and **both blockers are now closed**: migration 64 masks hidden titles in the database, and the roster RPC returns each member's own check-in date. The two sections below are kept as the record of why that migration exists.

#### Blocker 1 ✅ closed: hidden goal titles were not actually hidden

`goals_select_own_or_groupmate` returns the whole row to any circle-mate and consults `goal_group_visibility` nowhere. `is_goal_hidden_in_group()` has one caller in the database and it gates **photos**.

Nothing leaks today only because nothing renders a circle-mate's titles. This feature is precisely the thing that starts rendering them.

RLS cannot fix it: masking a column for one viewer and not another is not row-level. See architecture section 4, "Hidden goals stay readable", for the options. **The shape is a `SECURITY DEFINER` RPC that returns the roster already masked**, with `SELECT` on `goals` narrowed to the owner.

**Closed before 7g, as migration 64**, verified as a real circle-mate in a rolled-back transaction and again by the Playwright suite afterwards. It is a live exposure rather than a design gap. The practical risk is nil, since the only accounts that exist are the two test ones, which is exactly why it is cheap to fix now rather than under pressure later. 7g is specced and will keep.

#### Blocker 2 ✅ closed: "today" is per-person

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

#### Decided: shape of the screens

| Question | Decision |
|---|---|
| Roster vs the existing Members tab | **Two tabs.** `Today` and `Members` |
| Notes in the expansion | **Yes**, shared notes render in v1 |
| Note input | **Behind a `+ note` link, before checking in** |
| Un-sharing your own note | **On the roster, beside your own note** |
| Scope | Roster, note input, **and** the dashboard Overview and notifications subtabs |

**Three tabs on `/circles/[id]`, and `Today` becomes the default.** `Members` keeps the stored per-member streaks and roles; `Overview` keeps the digest history. Today's counts are a different number about the same people, and putting both on one row would mean explaining why one says `3 of 5` and the other says `14`.

This moves what a bare `/circles/[id]` shows. `public/sw.js` deep-links to `?tab=overview`, which is unaffected, but the Members view now needs its own `?tab=members` rather than being the no-param default.

**Notes render, because 7h already returns them.** `circle_roster` supplies note text when the entry is shared and the goal is visible here, so this is presentation rather than new plumbing. It also gives `setNoteSharing` its caller, closing the last of 7h's three gaps.

**`+ note` keeps the fast path one tap.** The row stays `● Run 5k [+ note] [Check in]`; tapping `+ note` expands a textarea and a "Share with this Circle" tick, and `Check in` writes all three at once through the insert `checkIn` already performs. Rejected: attaching a note *after* checking in, which needs a second action to write note text to an existing entry and turns one round trip into two.

**Un-sharing lives on the roster, beside your own note.** That is where you see your words the way circle-mates see them, which is the thing you would be second-guessing. Deliberately not in both places: two call sites for one action is two chances at the stale-`useActionState` bug this project has already hit twice.

---

#### 8a. Archived Circles stop reporting live counts ✅ done, migrations 68 + 69

`circle_roster` never looks at `group_status`, so a retired Circle renders today's numbers as though it were still running. Nothing can change them, so they are meaningless at best and read as current at worst.

##### Refuse, or freeze? They are not the same question

**Refusing** means the RPC raises for a non-active Circle, as it already does for `NOT_A_MEMBER`. One line, one rule. But it answers a **state** question with an **access** answer: archived is not a permission problem, the member is still entitled to look, and the page would treat a normal situation as an error. It also makes the tab unreachable rather than empty, so it would have to be hidden on some Circles and not others.

##### Decided: freeze. The roster shows the Circle as it ended

Not today's numbers, and not no numbers. The final standing on the last day the Circle actually ran.

**It is cheaper than it first looked, because the fix is to stop hard-coding "now".** Every part of the roster already computes against an instant; it just assumed that instant was the present. Passing the instant in makes the live case and the frozen case the same code:

| Piece | Live | Frozen |
|---|---|---|
| Each member's check-in date | `now()` in their timezone | the closing instant, in their timezone |
| Which goals count | active today | active *at that instant* |
| Which check-ins count | that member's today | that member's date at that instant |

**The closing instant** is the open cycle's `ended_at`, which `archive_circle` sets. Falling back to `groups.updated_at`, because the succession path in `handle_membership_removal` archives a Circle when its last member leaves **without closing the cycle**, so `ended_at` can legitimately be null.

**Goals are filtered as of that instant too**, which is the difference between "as it ended" and "recomputed against today's goal list". Someone who archived three goals last week should not retroactively change what the Circle looked like when it closed.

The predicate is the same in both cases: `created_at <= as_of AND (archived_at IS NULL OR archived_at > as_of)`. With `as_of = now()` that reduces to the live rule on its own, because a `CHECK` already forbids `archived_at` in the future. One expression, no branch.

**The RPC returns `circle_status` and `as_of`**, so the tab can say *"Final standing, 12 August"* rather than presenting history as the present. `as_of` is null while the Circle is live, which is what the UI branches on.

**Test plan**
- SQL, rolled back: check a goal off, archive the Circle, then assert the roster still reports that day's counts with `circle_status = 'archived'` and `as_of` set to the closing instant.
- **Archive, then check off another goal.** The frozen counts must not move. This is the test that proves the date is really a parameter and not just a label.
- **Archive, then archive a goal.** The frozen `total_count` must not drop, because that goal was active when the Circle closed.
- An active Circle is unchanged: `as_of` null, counts live. Guards against fixing this by freezing everything.
- A Circle archived by its last member leaving, where `ended_at` is null, falls back rather than returning nothing.
- e2e: the `Today` tab of an archived Circle says final standing and names the date.

**Verified as `authenticated`, rolled back.** Live reads `as_of` null with counts; archiving freezes to `1 of 2`; checking off another goal, archiving a goal, and creating a new one all leave the frozen numbers untouched, and the new goal never appears; a null `ended_at` falls back rather than un-freezing.

**Migration 69 exists because 68 froze to the closing *date*, not the closing *instant*.** Goals were filtered as of the instant but check-ins were matched on `check_in_date` alone, so a Circle archived at 09:00 kept counting check-ins made at 17:00 the same day. The frozen number moved after the Circle stopped, which is the one thing it was built to prevent.

Only the awkward version of the test found it: archive, then check off another goal, and see whether the number holds. Asserting the frozen value once would have passed. **A freeze test has to mutate afterwards, or it is only testing a label.**

Two traps worth recording, both hit while testing rather than while writing:

- **`now()` is the transaction timestamp and does not advance.** A test that archives and then does something "later" in the same transaction is comparing a value to itself. Use explicit offsets.
- **`group_cycles` has `ends_after_start`.** Backdating `ended_at` for a test means backdating `started_at` too.

---

#### 8b. `Today` tab and the roster ✅ done

Three tabs on `/circles/[id]`: `Today` (default), `Members`, `Overview`.

Each member row: display name, `# checked / # total` for **their** check-in date, and the 7e "settling in" marker where it applies. Expands to their goals. Hidden goals are a row with the name masked and the tick shown. A member with no active goals reads "No goals yet".

**Watch for:** the roster is one RPC call, so expanding a row must reveal data already fetched rather than firing a request.

**Test plan**
- e2e, two accounts: both members appear, you first, counts match what was checked off.
- Expansion shows goal titles and ticks; a hidden goal shows a placeholder with its real tick and no title.
- A member with no goals reads "No goals yet" and not "0 of 0".
- Extend `masking.spec.ts`: assert the rendered HTML never contains a hidden title. The API test already covers the response; this covers the page.
- Unit: the count formatter, for `0 of 0`, `3 of 5`, and the singular `1 of 1`.

**Built.** `lib/supabase/circle-roster.ts` reads the RPC, `today-roster.tsx` renders it. `e2e/roster.spec.ts` covers the three tabs, the counts, the expansion and the archived case.

**The assertion that matters is `page.content()`, not `toBeVisible`.** A hidden title styled off-screen would pass a visibility check and still be sitting in the delivered HTML. The API test in `masking.spec.ts` proves the response is clean; this proves the page is.

**`circle-roster.ts` is the third and final exemption** from the "RPCs only in `app/actions/`" lint rule. A fourth should be read as evidence the rule is wrong rather than as another exception.

Two TypeScript traps, both cost time:

- **An assertion function narrowing a loop-scoped `const` reports a circularity.** `assertOk` works fine at the top level of a function and fails inside `for`; a plain `if (result.error) throw` narrows the same union without joining the inference.
- **A literal-union value flowing into `.insert()` does the same.** Annotating the loop's array explicitly, rather than `as const`, breaks the cycle.

**Three specs failed on the first run, and one was a real trap worth keeping.**

`admin.rpc("current_checkin_date")` **answers for nobody.** The service role has no `auth.uid()`, so the function falls back to UTC. A test that writes a check-in with that date and then asserts against a roster computed in the member's real timezone passes or fails depending on the hour. `e2e/db.ts` now exports `sessionFor(email)` with that reasoning attached, because three specs were each building the same client inline.

The other two failed because the default tab moved: they looked for the `Members` wording of the "settling in" marker on what is now the `Today` tab. Loosened to match either. **That is twice a tab change has broken a spec that never mentions tabs.** A third should become a shared helper that navigates by tab name rather than by bare URL.

---

#### 8c. `Members` moves to `?tab=members` ✅ done

Keeps stored per-member streaks, roles and the "settling in" marker. Purely a move plus a link change.

**This changes what a bare `/circles/[id]` shows**, from Members to Today. `public/sw.js` deep-links to `?tab=overview` and is unaffected, but anything holding a bare link now lands somewhere new.

**Test plan**
- e2e: `/circles/[id]` renders Today; `?tab=members` renders the streak list; `?tab=overview` still renders digests.
- The existing 7e streak-decision specs still pass, since the banner sits above the tabs.

---

#### 8d. Notes on the roster, and un-sharing ✅ done

`circle_roster` already returns note text when the entry is shared and the goal is visible here, so this is presentation. Your own note carries a control to stop sharing it, which finally gives `setNoteSharing` a caller.

**One call site only.** Two would be two chances at the stale-`useActionState` bug this project has hit twice.

**Test plan**
- e2e: a shared note appears to a circle-mate under its goal; a private one does not.
- Un-sharing from the roster removes it from the other member's next read. Reuses the API assertions in `masking.spec.ts`, now through the UI.
- The control appears **only** on your own rows.

**Migration 70 was needed after all.** `setNoteSharing` takes an entry id and the roster returned goal ids, so there was nothing to wire the control to. The roster now carries `entry_id` and `note_shared` **for your own rows only**: null and false for everyone else, because a viewer who cannot act on a row has no use for its primary key, and knowing that someone's invisible note exists but is private tells you something they chose not to tell you.

**Re-sharing is offered too**, not just un-sharing. The action already took a boolean, and a control that only goes one way makes an accidental tap permanent on the screen you tapped it from.

**Frozen Circles offer no control at all.** Nothing on a closed Circle can change, and a button that silently does nothing is worse than no button. The note itself stays, because the frozen roster is history rather than a blank.

**`setNoteSharing` now revalidates the Circle page**, which it could not do before because it had no way to know which one. The form passes `groupId`, used only for revalidation and never for authorisation: the update is scoped by RLS to your own rows whatever a form claims.

`checkIn` and `undoCheckIn` deliberately do **not** revalidate any Circle. A check-in changes your counts on every Circle you belong to and the action does not know which; the roster picks it up on the next visit, which is 8g phase 1.

---

#### 8e. `+ note` and the share tick on check-in ✅ done

The dashboard goal row becomes `● Run 5k  [+ note]  [Check in]`. Tapping `+ note` expands a textarea and a "Share with this Circle" tick; `Check in` writes all three in the single insert `checkIn` already performs.

The fast path stays one tap. Rejected: attaching a note after checking in, which needs a second action to write note text to an existing entry and turns one round trip into two.

**Test plan**
- e2e: check in with no note, exactly as today, and confirm nothing regressed.
- Check in with a note and the tick set; confirm it reaches a circle-mate's roster.
- Check in with a note and the tick **unset**; confirm it does not.
- An unticked box sends no field at all, so assert the stored `note_shared` is false rather than null.
- A note over 500 characters is refused with the length message.

**The form now wraps the whole row**, so the note and its tick submit with the check-in through the single insert `checkIn` already performed. Previously the form wrapped only the button.

**Copy corrected while building it: "your Circles", not "this Circle".** Sharing is per *note*, so a shared note reaches every Circle where that goal is visible. The dashboard has no single Circle to name, and the roster's control was making the same false promise. Both now say "your Circles".

This is the kind of thing that reads as a typo and is actually a model mismatch: the label described a per-Circle control that 7h deliberately decided not to build.

---

#### Found while proving 8b–8e: the roster named people by a field that is not unique

`display_name` is nullable, cosmetic and explicitly **not unique**; `username` is case-insensitively unique precisely so nobody can impersonate anyone. Both docs said "render `coalesce(display_name, username)` everywhere", and every Circle surface did.

The consequence only appears with two members: two people who both set `display_name` to the same value render as two identical rows, in the one screen whose entire job is telling friends apart. Worse, setting yours to match a friend's is a cheaper impersonation than the unicode lookalikes the username index already blocks. The uniqueness guarantee was on the field nothing displayed.

**Now `coalesce(username, display_name)` wherever one person is named to another**: the `Today` roster, the `Members` list, and the grace names in the streak-decision banner. `display_name` leads only where you are being addressed yourself, which today is the onboarding welcome.

Found because an e2e assertion could not distinguish the two test accounts, both of which belong to the same person. **A test that cannot tell two rows apart is usually reporting that a user cannot either.** Guarded now by an assertion that both usernames appear in the roster's list items, scoped to the list rather than the page, because the header already prints your own.

---

#### 8f. Dashboard tabs, Overview, notifications, and a settings page

The last part of step 8, and larger than the original wording implied: the dashboard gains a tab bar, and the notifications that have been written for weeks gain a reader. **52 rows are sitting unread**, 51 digests and one `invite_accepted`. `read_at` is a column with no writer. Same shape as 8h, one layer up.

##### Decided

| Question | Decision |
|---|---|
| Layout | **Tabs at the top**: `Overview` (default), `Circles`, `Notifications`, plus a settings icon |
| Overview holds | Check-in panel, **your goals**, then yesterday per Circle |
| Circles tab | The Circles list and the create form, moved off Overview |
| Badge | **On the tab label only**, `Notifications (3)` |
| Marking read | **Opening the tab marks everything read** |
| A Circle with no digest yet | **A row saying so**, not an omission and not zeroes |
| Payload convention | **Required keys by category, enforced in SQL** |
| Settings scope | **The shell, plus only the controls that already have a writer** |

**Ordering on Overview needs confirming at review.** "Check-in panel, then yesterday per Circle" and "goals above the digests, the first thing the user sees" are both recorded. They reconcile if the check-in panel counts as seeing your goals, giving: check-in panel → Your goals → digests. If the intent was the management list literally first, that is a two-line change and better made now than after the tests exist.

**Why a Circle with no snapshot gets a row.** It is a legitimate state, not an error: the Circle was made this morning and no day has rolled over. Omitting it makes Overview disagree with the Circles tab, and there is no way to tell a deliberately-absent Circle from one dropped by a bug. Zeroes would be worse still: they state that nobody finished, when the day has not happened.

##### The payload convention

**The rule.** A payload naming a **Circle** carries `group_id` **and** `circle_name`. A payload naming a **person** carries their `username`, frozen at write time. `circle_name` is a *fallback*, not the render source: the name is joined live from `groups` so a rename reads correctly, and the stored copy is what renders when the join finds nothing.

**The fallback is load-bearing.** `payload.group_id` is a jsonb value with **no foreign key**, so deleting a Circle orphans every notification about it and the live join returns nothing. Those rows render `Morning crew (no longer available)`, unlinked. Without a stored name there is nothing to print.

**Where the five types stand today**, checked against the live schema rather than the enum:

| Type | Writer | Carries |
|---|---|---|
| `digest` | `build_daily_digests` | `group_id`, `date`, `group_streak`, `member_count`, `completed_count` — **no `circle_name`** |
| `invite_accepted` | `join_circle` | `group_id`, `circle_name`, `joined_username` ✅ |
| `kicked` | `handle_membership_removal` | `group_id`, `circle_name` ✅ |
| `group_locked_renewal` | `run_daily_rollover` | `group_id`, `circle_name` ✅ |
| `deadline_changed` | `set_circle_deadline` | `group_id`, `circle_name`, deadlines ✅ |

**All five have writers, and four of the five already followed the convention.** I claimed twice that two were unwritten, reading the enum instead of the callers; the audit after 8f settled it by grepping every function body for each value. `digest` was the only outlier, which is what migration 73 fixed — and it means the CHECK could not have broken a live writer, which is worth knowing given it landed on a table with 52 rows in it.

So the convention is not new: two of the three existing writers already follow it, and `handle_membership_removal` says so in a comment citing the immutable-snapshot rule. **`digest` is the single outlier**, and the constraint below is what stops the next writer being another one.

**Why enforce rather than document.** This codebase's own history answers that: `goal_group_visibility` had four policies, grants, and two consumers enforcing a documented rule, and zero rows, for weeks. A rule nothing checks is a rule that has already been broken somewhere you have not looked.

##### Push already answered this, and I had it wrong twice

I wrote in two places that there is no push sender. **There is.** `send-digest-push` is deployed, and `cron.job` 4 invokes it at :25 past every hour, five minutes after digests are built. Its header says:

> Circle names are deliberately kept out of push bodies for the same reason, even though the payload carries them for in-app rendering.

So the question was already decided, in the direction this migration assumes: `teaser()` builds every body from counts alone, across all five types, and never touches `circle_name`. **Adding the key changes nothing about push.** Anything that later wants a name in a body is making a new decision, against a comment that argues the other way.

The general lesson is the more useful one: **check what is deployed before calling something unbuilt.** Three of five notification types were described here as having no writer; `kicked` has had one all along in `handle_membership_removal`, already following the very convention being introduced.

##### Pieces

| | Piece | Migration | Depends on |
|---|---|---|---|
| 8f-1 | The tab shell on `/dashboard`, and the settings icon | ✅ done | — |
| 8f-2 | Overview: check-in, goals, yesterday per Circle | ✅ done | 8f-1 |
| 8f-3 | Circles tab: the list and the create form, moved | ✅ done | 8f-1 |
| 8f-4 | Notifications: the list, all shapes, live name with fallback | ✅ done | 8f-7 |
| 8f-5 | Mark-all-read on view, and the unread count on the tab | ✅ done | 8f-4 |
| 8f-6 | `/settings`: the route, and only what has a writer | ✅ done | 8f-1 |
| 8f-7 | `circle_name` in digest payloads, backfill, and the CHECK | ✅ done, 73 | — |
| 8f-8 | `set_checkin_timezone`, because `sync_checkin_timezone` is a no-op mid-day | ✅ done, 74 | — |

**8f-7 goes first.** 8f-4 renders payloads, and rendering a shape before the shape is guaranteed means writing a fallback path that then becomes permanent. Same ordering argument as 8h-1 before 8h-2.

###### 8f-7. The migration

1. `build_daily_digests` writes `circle_name` into the notification payload. The digest **snapshot** is untouched: `digest_snapshots.summary` is per-member data, and the Circle it belongs to is already its `group_id` column with a real foreign key.
2. **Backfill the 51 existing rows** from `groups`. Cheap, their Circles are alive, and it is what lets the constraint be added validated rather than `NOT VALID`. A `NOT VALID` constraint is a rule that does not apply to the rows you already have, which is the half that is hardest to reason about later.
3. Add the constraint:

```sql
alter table public.notifications
  add constraint notifications_payload_names_its_circle
  check (
    case when type in ('digest','invite_accepted','kicked',
                       'group_locked_renewal','deadline_changed')
         then payload ? 'group_id' and payload ? 'circle_name'
         else true
    end
  );
```

- **A CHECK, not a trigger.** `payload ? 'key'` is immutable, so it needs nothing exotic, and a constraint cannot be skipped by a `SECURITY DEFINER` writer the way a policy can.
- **Keyed on `type`, with an `else true`.** A sixth notification type added later is not silently constrained to a shape nobody designed for it; it is simply unconstrained until someone says otherwise. The failure mode of the alternative is a migration that adds an enum value and cannot insert with it.
- Assert grants afterwards as usual, though nothing here changes them.

###### 8f-1. The tab shell

- `?tab=` in the URL, read on the server, no client state. Same shape as `/circles/[id]`, deep-linkable, survives reload, and `sw.js` can point at `?tab=notifications` when a push sender exists.
- `Overview` is the default and an unknown value falls back to it, matching the Circle page's `tab === "members" || tab === "overview" ? tab : "today"`.
- The settings icon is a `Link`, not a tab: it goes to a different route, and dressing a navigation as a tab makes the back button behave unlike the other three.
- The unread count renders on the `Notifications` label, so it needs one `count` query on **every** dashboard render regardless of tab. Cheap and indexed on `user_id`; the alternative is a badge that only appears once you have already looked.

###### 8f-2. Overview

- The check-in panel and the goals panel move here unchanged. Both already exist; this is placement, not new behaviour, and the 8h visibility expanders come along untouched.
- Yesterday per Circle, from `digest_snapshots`: Circle name, the snapshot's date, `completed_count` of `member_count`, `group_streak`.
- **The latest snapshot per Circle, not literally yesterday.** Members are in different timezones, `build_daily_digests` runs per rollover, and a Circle made this morning has none. A date filter produces empty rows that look like failure; "most recent, and say which date" does not.
- A Circle with no snapshot says why: nothing has rolled over yet.
- **Read `summary` defensively.** It is jsonb written by a job, so a shape change ships silently. Render what is present rather than destructuring and crashing the dashboard for everyone.
- Names come from the FK on `digest_snapshots.group_id`, which is real, so no fallback is needed here. That is only a notifications problem.

###### 8f-3. Circles

- The existing list, the create form, and archived Circles beneath, moved wholesale.
- **`?tab=circles` must not become the place Circles live for people who have none.** The empty state has to carry the create form, or a new account lands on an Overview with nothing and a Circles tab that looks broken.

###### 8f-4. Notifications

- Newest first, `type` switching the rendering, **every shape handled explicitly with a fallback for anything unrecognised**. Five values are declared and three have writers; the other two arrive with no warning when theirs land.
- Circle name: live from `groups`, `payload.circle_name` when the join is empty, and `(no longer available)` with no link in that case.
- `digest` links to `/circles/[id]?tab=overview`, which is what `sw.js` already deep-links to. `invite_accepted` and `kicked` link to the Circle — except `kicked`, which must not, since you are no longer a member and the link would land on a redirect.
- **Never render a raw payload key as text.** These are jsonb from the database and the fallback branch is the one most likely to meet something unexpected.
- Retention: `run_retention_sweep` already deletes old notifications, so there is no pagination to design yet. Note the assumption rather than discovering it at 500 rows.

###### 8f-5. Mark-all-read

- A server action, called once from a client component on mount, after the list has rendered. A server component cannot write, and a route handler would be a second URL surface for one `update`.
- **No migration.** `authenticated` already holds `SELECT` on every column of `notifications` and `UPDATE` on **`read_at` alone** — exactly this and nothing wider. Checked, not assumed: the same check skipped on `goal_group_visibility` cost 8h-2 a debugging session.
- **It must not `revalidatePath("/dashboard")`.** The action changes `read_at`, the page renders the unread count, and revalidating re-runs the page, which re-mounts the component, which calls the action again. The count may be one navigation stale; a render loop may not.
- Scoped by `user_id` **and** `read_at is null`, so a repeat call writes nothing and the timestamp records when you first looked rather than the last re-mount.

###### 8f-6. Settings

- The route, the gear icon, and only controls whose backend exists today:
  - **Timezone**, via `sync_checkin_timezone`. Already an RPC, already validated against `pg_timezone_names`.
  - **Username**, via `complete_onboarding`, which doubles as the rename path and enforces the 14-day limit. `USERNAME_RENAME_TOO_SOON` is already in `lib/errors.ts`.
  - **Export your data**, via `export_user_data`.
- Everything else gets a heading when its writer lands. **No control over a function that does not exist**: push has no sender, deletion has no flow, and a switch that does nothing is the exact shape 8h just spent two migrations removing.
- Changing your timezone moves your check-in boundary, so the page has to say what that means for today rather than silently re-dating your day.

##### Notes from building it

**The digest query is one small read per Circle, not one big one.** Retention keeps 90 days, so a single `.in(...)` over ten Circles pulls up to 900 rows to use ten of them, and PostgREST has no `DISTINCT ON`. Taking the newest N overall would silently drop a Circle whose last finished day is older than the rest. Bounded by how many Circles one person is in; if that stops being small it wants a view or an RPC, not a bigger limit.

**Export is a route handler, not a server action.** The deliverable is a file, and `Content-Disposition` beats building a Blob and a synthetic anchor click. The RPC itself still lives in `app/actions/settings.ts`, because `.rpc(` is lint-banned outside that directory and the rule is worth keeping literal: a route handler is server code, but so is a server component, and the exemption would have to be re-argued every time.

**Renaming has to send the current timezone.** `complete_onboarding(username, timezone)` is deliberately both the onboarding and the rename path, so the settings action reads `checkin_timezone` first and passes it back. Sending a default would move someone's check-in boundary as a side effect of changing their name, which is the kind of bug nobody reports because nobody connects the two.

**Renaming to the name you already have is a no-op, not a write.** Spending a 14-day rename allowance on no change would be a trap.

**The e2e spec is the destructive one, and says so at the top.** Opening the notifications tab marks every unread row read with no undo, and the settings spec moves `checkin_timezone`, which decides what "today" is. Both capture state first and restore it in a `finally`; a run that left the account in `Asia/Tokyo` would break check-in date assertions in files that never mention timezones.

##### Four failures on the first run, and what they were

**Moving the Circles list broke two specs, in another file.** `invite.spec.ts` fills "Start a Circle" on `/dashboard`, which is now the Overview tab. The general form: a tab bar is a **URL change for every consumer of the old page**, and grepping `goto("/dashboard")` should be part of making one, not part of debugging it afterwards.

**`page.content()` is the wrong tool for "this is not shown".** The assertion "no raw payload key reaches the screen" failed on the RSC stream: Next serialises every prop into a `<script>` tag, so the raw `type` and the whole payload are in the document whatever renders. `page.content()` is exactly right for `roster.spec`'s "a hidden title must never reach the browser", and exactly wrong here. Asserted on the rendered text of the region instead.

**A `<form>` with no accessible name is not a `form` landmark.** `getByRole("form")` matched nothing and the settings spec spent its whole timeout on it. Both forms now carry `aria-label`, which fixes the test and the screen reader at once.

**A new global link made an old name ambiguous.** The dashboard's gear was `aria-label="Settings"`, and the Circle page has its own Settings link to a different route. `invite.spec` clicked the Circle, then reached for "Settings" before the navigation had landed, matched the gear, and ended on `/settings`. The guard added earlier reported it honestly as "Circle settings did not load", which was true and pointed nowhere near the cause.

Two fixes, both worth having: the test now `waitForURL`s the Circle before locating anything on it, and the gear is **"Account settings"**. Two links with the same name and different destinations are ambiguous to a screen reader as well as to a locator.

**The general form:** after a click that navigates, wait for the destination before locating on it. Playwright waits for the *element*, not for the page you meant to be on, and a name that is unique on the destination need not be unique on the origin.

**An unscoped `listitem` filter matched six rows.** Overview renders the goals list, and every goal's visibility expander names each of your Circles, so filtering list items by a Circle name matches one row per goal. Scoped to the digest panel. Third instance of the same shape this step: a locator has to say *which* list, and this dashboard now has four.

##### 8f-8. `set_checkin_timezone`, and the bug that made it necessary

**The settings form reports success and writes nothing.** `sync_checkin_timezone` is deliberately a no-op mid-day:

```
-- Only advance if the current check-in day has actually elapsed. Calling this
-- mid-day is a no-op, which is what stops travel from shifting the boundary.
```

That function exists for **automatic** sync: the client notices you have flown somewhere and calls it, and the change waits for the next rollover so your day cannot shift underneath you. It is the wrong function for a **deliberate** change, where someone types a zone and presses Save. The action saw no error and rendered "Timezone updated." while `checkin_timezone` stayed put — a control that claims success and does nothing, which is the exact shape 8h spent two migrations removing.

**"Only controls whose backend exists" was the right rule, applied too shallowly.** A writer existed. It did not do what this screen means. The rule needs the second half: *check that the writer's semantics match the control's promise.*

###### The harder half, found while planning the fix

`private.checkin_date_for` and `checkin_date_at` compute the date from **`checkin_timezone` and the instant alone**:

```sql
select ((now() at time zone coalesce(u.checkin_timezone, 'UTC')) - interval '2 hours')::date;
```

**`checkin_day_started_at` is never read by them.** It exists only so `sync_checkin_timezone` can tell whether a day has elapsed. So changing `checkin_timezone` moves today's date *immediately and retroactively*: at 20:00 in Los Angeles, switching to `Asia/Tokyo` makes "today" tomorrow, and today's check-ins stay filed under a date that is no longer today. Completion and streak for "today" read as nothing done.

**This makes the copy already written in `settings-forms.tsx` false.** "Changing this moves that boundary from tomorrow onwards; today keeps the one it started with" describes behaviour the schema does not have. It must not ship as written.

###### Decided: B, a pending zone adopted at the next rollover

Applying immediately was the cheaper option and was rejected. The whole reason the automatic path defers is that a moving boundary is worse than a late one, and a deliberate change carries the same hazard: it would re-date the day in progress, filing this morning's check-ins under a date that is no longer today and reading as nothing done.

###### Pieces ✅ done, migration 74

| | Piece | Where |
|---|---|---|
| 8f-8a | `users.pending_checkin_timezone`, `SELECT`-only grant, `set_checkin_timezone(text)` | migration 74 |
| 8f-8b | `run_daily_rollover` adopts and clears it, **after** finalising the day | migration 74 |
| 8f-8c | The form saves a queue, and the page names both zones | `settings-forms.tsx` |

**The adoption lives in `run_daily_rollover`, not `rollover_user_day`.** The per-user function finalises a day; the caller is what owns "this user has moved on", and it already writes `last_rollover_date` in the same statement. Order inside that loop is load-bearing: the day closes against the zone it was lived in, and only then does the new one take over.

**`SELECT` but no `UPDATE` on the column.** The RPC is the only writer, so a client cannot queue a zone that skipped `pg_timezone_names` validation. Grants are checked before RLS, so that grant is the real guard rather than any policy.

**Choosing the zone you are already in cancels rather than queues.** Otherwise "put it back" leaves a pending row that changes nothing and reads as a change still coming.

###### One more failure, and the shape it belongs to

The first e2e run of this read the database while the button still said "Saving…". The wait was `getByText(/takes effect at your next daily reset/i)` — which is also in the **static** helper paragraph under the field, present whether or not anything was saved. So it matched instantly, the read raced the action, and `pending` came back null.

**A confirmation that is a substring of permanent copy confirms nothing.** The message is now just "Saved.", and the test waits for the *pending* paragraph, which only renders when the server says something is queued. Waiting on server-derived text rather than on a status string also means the assertion proves the revalidation landed.

This is the third failure in this step from a locator matching more than the thing under test, after the `listitem` filter and the "Settings" link. The dashboard and settings screens now have enough repeated language that **new copy should be checked against what a test would match**, not only against what it reads like.

###### Proven, rolled back

- An unknown zone is refused with `TIMEZONE_INVALID`, which `lib/errors.ts` already resolves.
- Saving writes the queue and **leaves `checkin_timezone` alone**, and `checkin_date_for` returns the same date before and after. That is the assertion the whole design exists for, and the one that fails if anyone later removes the pending column.
- The rollover adopts the queued zone and clears it.
- Re-choosing the live zone leaves nothing queued.

###### Test plan

- SQL, rolled back: `set_checkin_timezone` refuses an unknown zone with `TIMEZONE_INVALID`, writes `pending_checkin_timezone` and leaves `checkin_timezone` alone.
- Rollover adopts the pending zone and clears it, and `checkin_date_for` changes only after that.
- **Today's date does not move at the moment of saving.** This is the whole point of B, and it is the assertion that fails if anyone later "simplifies" the pending column away.
- `authenticated` holds EXECUTE on the new RPC; `anon` does not.
- e2e: saving says the change is queued and names both zones. Restore in a `finally`, as now.

##### Test plan

**SQL, rolled back:**

- The constraint refuses a `digest` insert with no `circle_name`, and accepts one with it. Both directions: a constraint only proven in the refusing direction can be a typo that refuses everything.
- It refuses each of the five types missing the key, and permits an unconstrained hypothetical sixth via the `else true` branch.
- `build_daily_digests` writes `circle_name` on a fresh Circle, asserted from the row rather than from the function body.
- `authenticated` can set `read_at` on **its own** notification rows, cannot set it on anyone else's, and cannot write any other column. The grant is narrow today; this is what notices when it stops being.

**e2e:**

- The badge shows a count, opening `?tab=notifications` clears it, and a reload does not bring it back. The 52 rows already there are the first run of this.
- A notification whose Circle has been deleted renders the stored name marked unavailable, and is not a link. Forced with the service key, since deleting a Circle is not a UI path.
- A notification of an unrecognised `type` renders the fallback rather than throwing. Forced with the service key: every declared type has a writer, but two of them need a passing deadline to fire, and the fallback is really for the *sixth* type someone adds later.
- Overview names a Circle and a date; a Circle with no snapshot says so rather than rendering an empty row or zeroes.
- The three tabs are URL-addressable and an unknown `?tab=` lands on Overview.
- `/settings` saves a timezone and says what it means for today. **Restore the original in a `finally`**: it is a real account, and a test that leaves someone in `UTC` breaks every check-in date assertion in the suite.

**Fixture note.** Anything asserting a goal or Circle count belongs in `roster.spec.ts`, which has `parkActiveGoals`. A count assertion in a file whose fixture does not own the whole list is the mistake this suite has already made twice.

---

#### 8g. Live roster updates

**Not in the first pass, and the reason matters.** The roster is a server render, so if someone checks in on their phone your view is stale until you reload.

**The trap.** The obvious fix is Supabase Realtime on `progress_entries` or `goals`. Both are `user_id = auth.uid()` since migration 64, and Realtime respects RLS, so a circle-mate would receive **nothing**. Loosening those policies to make Realtime work would re-open the exact leak migration 64 closed. Anyone reaching for Realtime here needs to read this paragraph first.

##### Decided

| Question | Decision |
|---|---|
| Trigger | **`visibilitychange` to visible**, not `focus` |
| Throttle | **At most one refresh per 30 seconds** |
| Scope | **The Circle page only** |

**Why not `focus`.** On desktop `focus` fires every time the window regains focus, including alt-tabbing away to copy a link and back. That is a server round trip for a number that changes a few times a day. `visibilitychange` fires on the case that actually matters: the tab was hidden, or the phone was in a pocket, and now it is not.

**Why throttled.** Without it, flicking between two tabs refetches on every flick. The timestamp starts at mount, because the data is fresh at mount and a refresh a second later would be pure cost.

**Why the Circle page only.** It is the one screen showing other people's state, and therefore the only one that can be wrong without you having done anything. The dashboard shows your own state, which you changed yourself. A hook in the `(app)` layout would also fire on settings and onboarding, where a refresh mid-form is someone else's surprise rather than a courtesy.

##### Pieces

| | Piece | Migration |
|---|---|---|
| 8g-1 | `RefreshOnReturn`, and the Circle page mounting it | ✅ done, no migration |

- A client component calling `router.refresh()`, which re-runs the server component and re-reads `circle_roster`. No new endpoint, no new policy, nothing to get wrong.
- **Not mounted on an inactive Circle.** Its roster is frozen at a past instant, so a refresh cannot change anything, and a page that quietly refetches implies live data where there is none.
- Silent. No spinner, no "updated just now". The numbers are the message, and a page that announces its own refetching draws attention to plumbing.

##### Test plan

- e2e: the owner opens a Circle, the joiner checks in **over the API**, the owner's count updates after a visibility event and without a reload.
  - Dispatch it with `page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")))`. A Playwright page is already visible, so the handler's `visibilityState === "visible"` check passes; there is no API for actually hiding a tab.
  - The throttle has to be crossed deliberately: `page.clock.install()` before navigating, then `page.clock.fastForward(31_000)`. A test that dispatches immediately after load is testing the throttle instead, and would pass while the feature was broken.
- e2e: an archived Circle does **not** refetch. Assert the absence of the request rather than the sameness of the numbers, which would pass on a frozen roster either way.

##### Two things building it turned up

**`useRef(Date.now())` is a React Compiler error.** "Cannot call impure function during render": a re-render would quietly move the throttle's starting point. Seeded inside the effect instead, which is also the more honest place, since the thing being timed is "when did this page last have fresh data".

**The clock has no uninstall.** `page.clock.install()` stays for the life of the page, and `roster.spec.ts` shares two pages across the whole file, so a frozen clock would follow every later test that touched them and fail somewhere with no mention of time. Both 8g tests open a throwaway page in the owner's existing context: same session, no extra auth mint, and the clock dies with the page.

##### Phase 2, written down and not scheduled

A broadcast channel per Circle, sent from a trigger with `realtime.broadcast_changes()`, carrying **counts only** and never titles or notes. Broadcast bypasses table RLS, which is precisely why the payload has to be built deliberately rather than derived from the row. Its own migration, its own test plan, and only worth it if focus-revalidation proves too slow in practice.

**Rejected: polling.** A roster is not a chat, and a timer that refetches for everyone in every open tab spends the Supabase free tier on a number that changes a few times a day.

---

#### 8h. Hiding a goal ✅ **done** — migrations 71 and 72

Closed. `goal_group_visibility` has a writer, `goals.hidden_everywhere` exists for the case rows cannot express, and `roster.spec.ts` now hides a goal *through the dashboard* and checks another account's roster, which is the first time that file's oldest assertion has been driven by something a user could do.

**Three bugs came out of building it**, all of them older than the step and none findable from the screens that existed before:

| Found | Where | Shape |
|---|---|---|
| Your own title masked from you on your own row | `circle_roster` | An exemption applied to one field of a rule, not its siblings |
| Hiding a goal hid your own check-in photo from you | `can_view_checkin_photo` | Same, and worse: the self-join matched you on both sides |
| `upsert` refused with a bare `42501` | `goal_group_visibility` grants | Grants are checked before RLS, third instance |

The original write-up follows, kept because the reasoning is what the next visibility decision will be measured against.

#### 8h. Hiding a goal — **the feature nothing could turn on**

`goal_group_visibility` has a table, a primary key on `(goal_id, group_id)`, four RLS policies, insert/update/delete grants, and two consumers: `circle_roster` masks titles on it and `can_view_checkin_photo` gates photos on it. Migration 64's entire masking argument rests on it.

**Nothing in the app writes it. The table has zero rows.** Every hidden goal in the test suite was created with the service key.

This is bug pattern 2 at its largest scale so far: not a column with no writer, but a whole feature that everything else already enforces and no person can invoke.

##### Decided

| Question | Decision |
|---|---|
| Control | **On the goal**, an expander on the dashboard goal row listing your Circles with a toggle each |
| Joining a Circle | **Existing goals stay visible**, and the join step says so |
| Private everywhere | **Yes**, one switch, stored as `goals.hidden_everywhere` |
| A hidden goal still **counts** | **Yes.** Placeholder row, and it lands in "1 of 3" |
| Naming | **`hidden_everywhere`**, not `private` |

**Why a hidden goal still counts.** Hiding conceals the *title*, never the commitment. A goal you can hide out of your own denominator is a goal you can quietly abandon, which is the one thing this product exists to prevent. It also keeps three numbers that must agree agreeing: the roster's `total_count`, `daily_completion`, and the group streak all count every active goal. Excluding hidden goals from the first would let a roster read "2 of 2" on a day the streak says you did not complete — the same figure disagreeing with itself on one screen.

**Why `hidden_everywhere` and not `private`.** `goal_group_visibility.hidden` already names this exact condition; the new column is the same masking applied to every Circle rather than to one. Two names for one condition is pattern 4 on the list below, and it has already cost a migration once (`CIRCLE_INACTIVE` vs `CIRCLE_NOT_ACTIVE`).

##### The consequence the decisions have together

**"Hidden everywhere" cannot be a set of `goal_group_visibility` rows.**

The table is sparse: a missing row means visible. So a goal marked hidden by writing a row per Circle is hidden only in the Circles that existed when you marked it. Join a new one and, by the "existing goals stay visible" decision, it becomes visible there — silently, because no row says otherwise. The shortcut would quietly expire, and the failure is invisible: nothing errors, a title just appears in front of people you never chose.

So it has to live on the **goal**, not on the pairing.

##### The masking rule, stated once

```
hidden(goal, circle) := goals.hidden_everywhere OR coalesce(goal_group_visibility.hidden, false)
```

**And it must exist in exactly one place.** It currently exists in two: `private.is_goal_hidden_in_group(goal_id, group_id)` is the helper `can_view_checkin_photo` calls, while `circle_roster` re-implements the same rule inline as a `left join` on `goal_group_visibility`. Two copies agree today only because both are one line. Adding a second term to a rule that exists twice is how you get a title masked on the roster and served with the photo.

**8h-1 folds `hidden_everywhere` into the helper and makes `circle_roster` call it**, computing it once per goal in the `active_goal` CTE and reusing the result for both the title and the note. Cost: at most 10 members × 10 goals = 100 evaluations of a `stable sql` function over a two-column primary key, on a page that already runs one query. The alternative is the rule living in two places forever.

##### Pieces

| | Piece | Migration | Depends on |
|---|---|---|---|
| 8h-1 | `goals.hidden_everywhere`, the helper, and both consumers | ✅ done, 71 + 72 | — |
| 8h-2 | The visibility expander on the dashboard goal row, per-Circle toggles | ✅ done, no migration | 8h-1 |
| 8h-3 | The hide-everywhere switch, in the same expander | ✅ done, no migration | 8h-1 |
| 8h-4 | The count and the line on the join preview | ✅ done, no migration | 8h-1 |

**8h-2 and 8h-3 ship in one surface** but are listed apart because they write to different places and fail differently: 8h-2 writes `goal_group_visibility` rows through RLS, 8h-3 updates a column on `goals`.

###### 8h-1. The column and the rule

- `alter table public.goals add column hidden_everywhere boolean not null default false`.
- Grant `update(hidden_everywhere)` to `authenticated` explicitly. **Grants are checked before RLS**, and a column-level grant does not follow from the table-level one.
- Replace `private.is_goal_hidden_in_group` so it reads `goals.hidden_everywhere or coalesce(v.hidden, false)`.
- Replace `circle_roster` so `active_goal` computes `hidden` from the helper rather than from its own join.
- Both are `CREATE OR REPLACE` at an unchanged signature, so grants survive. **If either signature changes it is a new object with no grants** — migration 67's lesson, and the check that catches it is `has_function_privilege` on `anon` and `authenticated` at the end of the migration.

###### 8h-2. Per-Circle toggles

- An expander on each row of the dashboard's "Your goals" list, collapsed by default. Ten goals × six Circles is sixty controls if rendered eagerly, and nobody needs any of them most days.
- Writes `goal_group_visibility` directly from a server action under the **user's own session**, not through an RPC. The four policies already say exactly the right thing: insert and update require `owns_goal(goal_id) AND is_group_member(group_id)`, delete requires `owns_goal`. This is the rare case where RLS is the entire guard and a `SECURITY DEFINER` function would only add a second place to get it wrong.
- `upsert` on the `(goal_id, group_id)` primary key. Toggling back to visible **deletes the row** rather than writing `hidden = false`, so the table stays sparse and "no row" keeps meaning one thing.
- **Archived Circles offer no toggle.** Their roster is frozen at a past instant, so a change now would either do nothing or silently rewrite history depending on which side of `v_at` it landed. Same reasoning as the note-sharing controls in 8d.
- **A refused write has no hint.** An RLS refusal is a bare `42501` with no `HINT`, unlike every raise in the RPCs, so `lib/errors.ts` cannot recognise it. The action checks membership and ownership itself and returns a written message; the policy stays as the backstop that makes the check unnecessary rather than as the thing producing the text.

###### 8h-3. Hide everywhere

- One switch at the top of the same expander, above the per-Circle list.
- **Precedence is stated in the UI, not just in SQL.** With it on, the per-Circle toggles are disabled and read "hidden everywhere" rather than showing their own state, because a switch that appears to be off while the goal is hidden is a lie about what other people can see. The rows are left in place, so turning it off restores whatever per-Circle choices were there before.

###### 8h-4. The join preview ✅

- **Both numbers whenever they differ**: "1 of your 2 goals will be visible here. The rest are hidden everywhere." When they agree it reads "Your 2 goals will be visible here." A bare visible-count would conceal that there were ever two, which is the one fact the line exists to surface.
- **A statement, not a link.** Per-Circle switches cannot exist before you are a member, so the only control reachable from here is the hide-everywhere switch you can reach any time. Sending someone out of a two-click flow to find it costs more than it gives.
- Per-Circle rows cannot exist yet at preview time: you are not a member, so `ggv_insert_own_goal` could not have let you write one. M is therefore a count over `goals` alone, and the line is honest by construction.
- Signed out, and signed in without a username, the line does not render at all. There are no goals to count and the preview must not imply an account exists.
- **The test lives in `roster.spec.ts`, not `invite.spec.ts`.** It asserts a goal count, and only `roster.spec` has the `parkActiveGoals` fixture that makes a count deterministic. Putting a count assertion in a file whose fixture does not own the whole list is the mistake this suite has already made once.

##### Test plan

**SQL, rolled back:**

- A `hidden_everywhere` goal is masked in **every** Circle, including one joined *after* it was marked. That last clause is the entire reason the column exists rather than rows, and a test that only checks existing Circles would pass on the broken design.
- Per-Circle hiding still works independently: hidden in Circle A, visible in Circle B.
- The two together: `hidden_everywhere` wins whatever the rows say, in both directions (row says visible, column says hidden → hidden).
- **The count is unchanged by hiding.** `total_count` for a member with three goals, one hidden, reads 3 on the roster and agrees with `daily_completion`. This is the decision above, and it is the one a later refactor is most likely to "fix".
- `can_view_checkin_photo` refuses a photo on a `hidden_everywhere` goal. The photo path and the roster path now share a helper; the test has to exercise both, or the sharing is unproven.
- Grants: `authenticated` holds `update(hidden_everywhere)`, `anon` holds nothing, and both functions are still executable by `authenticated` after replacement.

**e2e:**

- Toggling from the dashboard changes what the other account sees on the roster, and **the hidden title never reaches the HTML**. Reuses `roster.spec.ts`'s existing `page.content()` assertion, now driven through the UI rather than seeded with the service key — which is the point of the whole step, since that assertion has only ever been proven against a flag no user could set.
- Turning it back on restores the title, so the control is not one-way.
- An archived Circle offers no toggle.
- The join preview names the right number, and a `hidden_everywhere` goal is not in it.

**Fixture note.** `roster.spec.ts` now parks the account's other goals, so a count assertion here is safe. Any new spec asserting on "M of N" must do the same; see the e2e rules.

##### Note the ordering

**8h-1 before everything.** The masking has to be right before a control can offer it, and the current masking is provably right only for a flag nobody can set. Building the toggle first would mean shipping a switch whose guarantee has never been exercised by a real user.

##### What 8h-2 and 8h-3 turned out to need

**A landmark on the goals list.** The dashboard prints every goal title twice, once in Today and once in Your goals, so any locator naming a title matched two rows and Playwright refused on strict mode. `<section aria-label="Your goals">` makes it a region and gives the tests a handle. Worth having regardless: an anonymous `section` is not a landmark to a screen reader either.

**`<details>`, not React state.** Each toggle calls `revalidatePath("/dashboard")`, which re-renders the panel. Component state tracking which expander is open would snap shut the moment you used it.

**Two `useActionState` hooks, not one per goal.** They carry the error text and nothing else; every switch renders from the server props. That is the standing rule about action results being facts about one past submission, applied before it could bite.

**`upsert` is refused on `goal_group_visibility`, and it is grants rather than RLS.** `authenticated` holds INSERT on all three columns but UPDATE on `hidden` alone. PostgREST's merge-duplicates upsert compiles to `ON CONFLICT DO UPDATE SET goal_id = …, group_id = …, hidden = …`, names two columns it may not write, and dies with a bare `42501` that `toMessage` renders as "You don't have access to that." True, unhelpful, and pointing at the wrong thing: the ownership and membership checks in the action had already passed.

The action now updates first and inserts only when there was nothing to update, treating `23505` as success. Widening the grant would have been the wrong trade: nothing should ever move a visibility row between goals or Circles, and the narrow grant is what says so. **Grants are checked before RLS, so no policy can rescue a missing one** — the third time that has cost a debugging session, after `service_role` in the early migrations and the `anon` overload in 67.

**The first honest run of the oldest assertion.** `roster.spec` has asserted since migration 64 that a hidden title never reaches the HTML, but every hidden goal in that file was hidden with the service key, so it proved the database masks a flag no user could set. Two new specs now hide a goal *through the dashboard* and check the other account's roster, including the delivered HTML rather than the screen, and that hiding leaves the count at "1 of 2".

##### What proving 8h-1 found: masking applied to the person doing the hiding

Migration 71's rolled-back proof was the first test ever to look at a hidden goal from the side of its owner, and it failed immediately.

`circle_roster` masked the title with `case when ag.hidden then null end`, unconditionally. The note two fields below it has carried a `when m.user_id = v_uid` exemption since migration 66; the title never got one. So your own row handed you your own note, your own `entry_id` and your own `note_shared`, then withheld your own title:

```
{"title": null, "hidden": true, "note": "…", "entry_id": "…"}
```

The screen rendered "Hidden goal" to the one person who already knew what it said.

`private.can_view_checkin_photo` had the same hole and a worse consequence. It joins `group_members` to itself, so asking about your own goal matches you on both sides, the hidden check runs, and it returns false. **Marking a goal hidden took your own check-in photo away from you.** Confirmed directly before fixing, not inferred.

**Migration 72** gives both the exemption the note already had. `hidden` still reports true on your own row, deliberately: it is the only signal the screen has, and the "hidden here" marker beside your own title is the one place you can see, from inside a Circle, what that Circle cannot.

**The shape is new to the list**: one rule, applied per field, exempted in one field only. It is the argument migration 71 already made about `is_goal_hidden_in_group`, one level down — a rule written by hand in several places will have parts of it that never learn.

##### Deferred

- **Rate limiting the toggle.** It is a cheap write behind RLS with no notification and no fan-out, so there is nothing to abuse yet. Revisit if visibility ever produces a notification.
- **Telling a circle-mate a goal was hidden.** It deliberately produces no event. "Ryan hid a goal from you" is worse than silence for everyone involved.

---

## Audit after step 8

Run against all eighteen patterns, plus the Supabase advisors, before starting step 9.

**Clean:** the hint contract (22 raised, 22 handled, no drift either way); `anon` reaches only `circle_preview`; every read of a user-owned table carries an explicit `user_id` filter rather than trusting RLS; every enum value in both `notification_type` and `audit_action_type` has a writer; no orphaned notifications, stray Circles, stray goals or leftover visibility rows.

**Advisors:** two `rls_enabled_no_policy` on `audit_log` and `username_history`, both deliberate and documented. The `SECURITY DEFINER` warnings are the RPC design itself. One real item, `auth_leaked_password_protection`, which is moot while sign-in is Google-only and becomes a decision the day email/password signup lands.

### Fixed during the audit

**`deleteE2ECircles` cleared two notification types out of five.** It filtered `type in ('kicked','invite_accepted')`, true when written and not since. All five types carry `payload.group_id`, that column has no foreign key, and 8f now *renders* orphans as "(no longer available)" — so a `digest` for a deleted E2E Circle would have sat in a real account's feed forever. It matches on the group now, so a sixth type needs no change here.

**Cleanup raced an in-flight server action.** When the timezone test failed, the assertion threw while the save was still running; `finally` restored the row, and the action then wrote its value back *after* the restore. The account was left with `Asia/Tokyo` queued by a test that had reported cleaning up after itself, and I found it by querying rather than by trusting the green run. The `finally` now waits for the Save button to be enabled before restoring, since `finally` runs on the failure path and that is exactly where something is still in flight.

**A claim I made three times and never checked.** I said `group_locked_renewal` and `deadline_changed` had no writers. Both do: `run_daily_rollover` and `set_circle_deadline`. Worse, this mattered — migration 73's CHECK requires `circle_name` on every Circle-naming payload, and if either writer had omitted it, **setting a deadline would have started failing on a check violation**. It did not, because four of five writers already followed the convention. That was luck standing in for verification. Corrected in the code comments, the spec, and the table above.

### 8f-9. Making the queued timezone self-only ✅ — migration 75

**The problem.** `users_select_self_or_groupmate` is row-level; grants are column-level. So a `grant select (pending_checkin_timezone)` needed for you to see your own queued zone also hands it to everyone in a Circle with you. Your *current* zone must be visible — the roster says "counted in their own timezone" — but a queued one announces a trip you have not taken.

**Two shapes considered.**

| | Approach | Cost |
|---|---|---|
| **A** | Revoke the column grant; read it through a `SECURITY DEFINER` RPC scoped to `auth.uid()` | One function, one revoke. Column stays on `users`, so the rollover's adoption remains a single UPDATE |
| **B** | Move it to its own table with a `user_id = auth.uid()` policy | A cleaner boundary and no column-grant games, but a whole table for one nullable text field, and the rollover's single statement becomes an UPDATE plus a DELETE |

**A.** The atomic adoption in `run_daily_rollover` is worth more than the tidier boundary, and B would put the pending value and the live value in two places that must agree — the shape that has bitten this codebase repeatedly.

**The fix would not take, and that was the real finding.** `revoke select (pending_checkin_timezone)` removed nothing, because **`authenticated` held a TABLE-level SELECT on `public.users`**. Migration 74's `grant select (pending_checkin_timezone)` had therefore been redundant since the moment it was written, and its assertion passed for the wrong reason.

That is worse than one leaked column. With a table grant, **every column ever added to `users` is readable by circle-mates the instant it exists.** `goals` has always been explicit, which is why `hidden_everywhere` in 71 needed a deliberate grant and could not have leaked by default. `users` now works the same way.

**What 75 does**

- `revoke select on public.users from authenticated`, then grant exactly `id, username, display_name, avatar_url, checkin_timezone` — everything the app actually selects.
- Dropped along the way: `created_at`, `updated_at`, `last_rollover_date`, `checkin_day_started_at`, `pending_checkin_timezone`. No client query names any of them, and the middle three are rollover bookkeeping no member has a reason to see.
- `public.my_pending_checkin_timezone()`, `SECURITY DEFINER`, scoped to `auth.uid()`. The settings page calls it through `app/actions/settings.ts`, keeping the `.rpc(` rule literal.
- `SECURITY DEFINER` functions are untouched: they run as the owner, so `export_user_data`, `circle_roster` and the rollover keep working.

**Proven, rolled back:** a circle-mate selecting the column is refused by the grant before RLS is consulted; the RPC returns null for someone else's row and the real value for your own; `username`, `display_name` and `checkin_timezone` stay readable so the roster still explains itself.

**The assertion style that caught it.** `has_column_privilege` answers "can this role read this column", which is the question that matters. Reading `information_schema.column_privileges` is what I did during the audit, and it lists columns covered by a *table* grant identically to ones granted individually — which is exactly why the audit called this "small" and it was not.

### Not fixed, deliberately

**~~`pending_checkin_timezone` is readable by circle-mates.~~** Fixed, migration 75. See below.

**The digest panel is one query per Circle.** Bounded by Circles per person, which is small now. Already noted in 8f-2; it wants a view or an RPC before it wants a bigger limit.

## Completed steps, kept for their reasoning

Steps 5 to 7 in full. Moved out of *Do* once they shipped, because next steps are read daily and finished ones are not, but kept verbatim: the streak display rule, the invite decisions and the masking argument are all still binding on step 8.

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

---

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
| `display_name` | optional, non-unique, cosmetic. Render `coalesce(username, display_name)` wherever one person is named to another; see architecture.md. |

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

---

## Open items, resolved

Closed during steps 6 and 7, kept because the reasoning still explains the shape of the code.

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

---

## Step 9, in full

### 9. The daily check-in flow — shipped 18 August, migration 76

**The problem.** The dashboard is a control panel. Someone opening the app in the morning wants one thing: check off yesterday's intentions and see where they stand. Today they land on goals, Circles, a create form, and have to find the check-in panel among it.

**The shape.** With an unfinished day, `/today` greets you with your streak, the goals still open, and nothing else. Finish, and it hands you to the dashboard.

#### Decided

| Question | Decision |
|---|---|
| What triggers it | An **unfinished** day, not an untouched one — but **once per check-in date**, not on every visit |
| Frequency | A user setting: **"Every time I open the app" / "Once a day" (default) / "Never"** |
| "Opens the app" means | **Once per browser session.** A session cookie, so it survives navigation and dies with the browser |
| Where the two facts live | Preference **in the database**; the seen-marker **in a cookie** |
| A broken streak | **Name the day it ended**, read backwards from `daily_completion` |
| Photos | **Not in step 9.** Their own step, after this one |
| Step 10 | **No conflict.** The install nudge and push prompt live inside onboarding, never in the signed-in app |

**Why the preference is server-side and the marker is not.** The setting is an account fact and should follow you between devices. "I have seen it today" is a device fact: a cookie needs no migration, and no write on a page render — which would otherwise be the first read path in this app that writes. The cost is seeing `/today` once per device per day, which is defensible, since you check in from whichever device you have.

**Why not `always`.** The screen never appears on a finished day, whatever the setting. "Every time I open the app" is accurate; "Always" would not be.

#### Pieces

| | Piece | Migration |
|---|---|---|
| 9a | `users.today_screen_mode`, and the settings control for it | ✅ done, 76 |
| 9b | `/today` route, the gate, and the session/day cookie | ✅ done |
| 9c | Streak header, including a broken streak | ✅ done |
| 9d | Check off goals, with note and share tick | ✅ done |
| 9e | Hand-off to the dashboard, and the skip link | ✅ done |

**9a first.** The gate reads the preference, so building the gate first means writing it against a value that does not exist and then changing it. Same ordering argument as 8h-1 and 8f-7.

#### What each piece has to get right

**9a ✅.** A new enum type and a column using it landed in one migration; only *adding a value to an existing* enum must be split. `authenticated` holds `SELECT` and `UPDATE` on the column, so circle-mates can read it — harmless for a display preference, and stated rather than discovered.

The migration also asserts that `pending_checkin_timezone` is **still** unreadable, so if anyone restores a table-level grant on `users`, the next migration to touch that table refuses to land.

Proven rolled back: you can set your own mode, an update against someone else's row affects zero rows, and an unknown value is refused by the enum rather than by the app.

**The gates are already tested.** `e2e/gates.spec.ts` covers the onboarding gate — including nulling a real username to prove every `(app)` route bounces — and holds the `/today` cases as `test.fixme` so their shape is fixed before 9b builds against it.

**9b ✅, the gate.** It lives on `/dashboard` and nowhere else. `/today` is inside `(app)`, so a condition in that layout would fire on `/today` itself; `/onboarding` gets away with being a layout gate's target only because it sits outside the route group.

| Mode | Cookie |
|---|---|
| `once_daily` | `solarity_today_seen`, holding the **check-in date** it was set for |
| `every_open` | `solarity_today_session`, no `maxAge`, so the browser drops it on close |
| `never` | none; the gate short-circuits |

**The day cookie stores a date, not a timestamp.** Suppression is a comparison against `current_checkin_date()`, so a skip at 01:00 still holds at 01:30 and releases at the 2 AM rollover. A timer would release it at midnight, two hours early.

**Marked seen on show, not on dismiss.** Cookies cannot be written during a render, so `/today` paints and a client component fires a server action — the `MarkRead` shape from 8f-5. Writing it from the skip link instead would mean the back button took you to `/dashboard` and straight back to `/today`, a loop from a control most people never touch.

**`hasUnfinishedDay` also requires at least one active goal.** `recompute_daily_completion` records a goal-less day as incomplete, which is right for streaks and would otherwise divert someone with no goals to an empty screen every day.

**The whole suite had to opt out.** Neither test account finishes its goals, so the gate would have diverted every `goto("/dashboard")` in `invite`, `roster` and `dashboard`, failing assertions in files that never mention check-ins. `auth.setup.ts` sets both accounts to `never`; `gates.spec.ts` turns it on per test and puts it back. Same shape as moving the Circles list in 8f-1, one layer wider — and caught by looking for it rather than by a red run.

**9c ✅.** Three states, not two: a live run shows the number, a broken one shows **how long it was and when it ended**, and no history at all says "Day one" rather than zero. Neither the length nor the end date is stored — `current_streak` is already 0 and the rollover recorded nothing about what it zeroed — so both come from walking `daily_completion` backwards, bounded at 400 rows.

**Dates are parsed as UTC on both sides.** A check-in date has already been resolved into the user's timezone by `current_checkin_date()`; letting `new Date("2026-08-17")` be read as local time would re-apply an offset and name the wrong day for anyone west of UTC. The server helper and the header's formatter both pin `Z`.

**9d ✅.** `TodayPanel` is reused unchanged apart from a `hideStreak` prop, since `/today` has its own header above it.

**Both screens now read through `lib/supabase/today.ts`.** The dashboard used to derive today's goals, completion and streak itself; that is now one function feeding both. Two copies of "what is checked off, and what does that make the streak" is the shape that has caused most of the bugs here.

**The settings link points at the control.** `/today` links to `/settings#check-in-screen`, and the form carries that `id` plus `scroll-mt`. A fragment naming nothing fails silently and looks like it worked, so the test asserts the target exists rather than just the URL.

**9e ✅.** Two ways off the screen, and they say different things.

| Leaving because | Lands on | Says |
|---|---|---|
| The day is already finished | `/dashboard?notice=day-done` | "Everything's checked off for today." |
| No check-in date could be computed | `/dashboard?notice=no-checkin-date` | What is unavailable, and that the rest works |
| You pressed Skip | `/dashboard` | nothing |

**A silent redirect reads as a broken link.** Anyone reaching `/today` on a finished day typed the URL, followed a bookmark, or just checked off their last goal; all three deserve a sentence rather than finding themselves somewhere else. **Skipping gets no notice**, because telling someone what they just chose to do is the kind of message people learn to dismiss without reading.

Skip also marks the day seen, so it cannot bounce you back in — the same loop the "mark on show, not on dismiss" decision guards, approached from the other side.

##### Two things the first run of step 9 turned up

**"The destination stream closed early", twice.** `MarkSeen` is fire-and-forget, so a test that asserted and closed its context aborted the request mid-flight. Harmless in production — you navigated away, so the cookie is simply not set — but it is the same "cleanup racing an in-flight action" shape as the timezone test, and it looks like a bug in a log. The tests now wait for the cookie before closing.

**`never` was writing a cookie nothing reads.** `writeSeen` had no branch for it, so it fell through to the day-cookie path. The gate short-circuits on the mode and never consults a cookie in that case, so the value had no reader. `MarkSeen` now does not fire at all, and `writeSeen` refuses as well.

#### Test plan

- **9a**: the RPC or action refuses an unknown mode; the column defaults to `once_daily`; grants are what the migration says.
- **9b**: unfinished + `once_daily` lands on `/today` once, and the second visit that day does not. `every_open` lands once per session. `never` never redirects, and `/today` is still reachable by typing it. **`/today` never redirects to `/today`** — the loop check.
- **9b, the boundary**: a skip recorded at 01:00 local still suppresses at 01:30, and stops suppressing after the 2 AM rollover. Uses `page.clock` to cross it, the way the 8g throttle test does.
- **9c**: a live streak reads N; a broken one names the day. Seeded by writing `daily_completion` history directly, since a real streak cannot be earned inside a test.
- **9d**: checking off from `/today` writes the same rows as the dashboard path. Asserted against the database, not the screen.
- **9e**: finishing leaves you on the dashboard and does not bounce back.

#### Conflicts resolved

- ~~**Step 10 competes for the same moment.**~~ The install nudge and push prompt belong to onboarding. Nothing in the signed-in app asks for either.

---

### 10a. The writer `push_subscriptions` never had

Migration **77**, `public.subscribe_push(endpoint, p256dh, auth, device_label)`.

The delivery half of push shipped long ago: `send-digest-push` is deployed, cron runs it hourly at :25, and `sw.js` handles `push`, `notificationclick` and `pushsubscriptionchange`. The table it reads had four policies, full grants, and **zero rows**, because nothing ever wrote to it.

#### Why an RPC rather than an upsert

`endpoint` is unique **globally**, not per user, and `authenticated` may UPDATE `device_label` and nothing else. Those two facts together put three ordinary situations out of the client's reach:

| Situation | What the client hits |
|---|---|
| Re-subscribing on a device already registered | `23505`; the upsert that would fix it compiles to `DO UPDATE SET user_id = …`, naming columns it may not write, so it dies `42501` instead |
| A second account on a shared browser | `23505`, and it may not delete a row it does not own |
| The browser rotating an endpoint | the same, via `pushsubscriptionchange` |

Third instance of **grants are checked before RLS**, and the first where no client-side workaround exists. The `goal_group_visibility` upsert in 8h-2 had one; this does not.

`subscribe_push` is `SECURITY DEFINER`: it deletes whatever holds the endpoint, then inserts the caller's row. **Deleting a stranger's row is correct rather than rude.** An endpoint identifies a browser, and the browser has just said who is using it now.

**Not** relaxed to `UNIQUE (user_id, endpoint)`. An endpoint genuinely is globally unique in the push world, and two rows for one would make the sender deliver the same digest twice.

#### Proved before it was believed

In a rolled-back transaction, all four directions:

- the caller gets their own row
- subscribing twice on one endpoint leaves exactly one row, the case the upsert could not do at all
- a second account takes the endpoint over, the case the client could not reach
- a direct insert naming another `user_id` is still refused, so the RPC is still the only writer

The migration asserts the last one permanently: if `authenticated` ever gains UPDATE on `user_id`, it fails.

#### Two small deliberate things

**`p_device_label` exists but nothing writes it.** Naming a device from a user agent reads as wrong more often than helpful, so there is no device list yet. The parameter is in the signature now because adding one later would create a *second* function rather than replace this one, and a new function inherits none of the original's grants (migration 67's lesson).

**Unsubscribing stayed a plain delete.** The DELETE policy is self-scoped, which is exactly the rule wanted, so the widened path stays as narrow as it can be. The action filters on `user_id` as well, so the code says whose row it means without a reader having to open a policy file.

`PUSH_ENDPOINT_INVALID` and `PUSH_KEYS_MISSING` were added to `BY_HINT` in the same change, since a hint with no entry degrades to the generic message silently.

---

### 10b. The install nudge, and the event that cannot be caught late

`/onboarding/install`, reached from `completeOnboarding` instead of the dashboard.

#### Its own route, not a phase inside `/onboarding`

`/onboarding` redirects to `/dashboard` the moment a username exists, and by the time anyone reaches this screen one does. Keeping it there would have meant weakening that redirect or holding the flow in client state, where a reload loses your place. It sits outside `(app)` for the same reason `/onboarding` does: neither the onboarding gate nor the `/today` gate should fire during signup, and a screen inside that group cannot opt out.

Gated on being signed in and nothing else. Whether the app is installed is a fact about a device, so there is nothing on the server to check and nothing to remember; arriving later just shows the nudge again, and nothing links to it.

#### The inline script

`beforeinstallprompt` fires once, early, and **the event object is the only route to the install dialog**. No API asks for one later. A listener added from a `useEffect` runs after hydration, which on a slow connection is after the event has gone, and the button would then do nothing on exactly the devices where installing matters most.

So the listener is an inline script in the root layout, the earliest code we control, and `lib/install-prompt.ts` holds both it and the contract it writes to. It also calls `preventDefault()` to suppress Chrome's mini-infobar, which is what makes the stashed event the only route rather than merely the preferred one.

#### Four branches, all of which lead somewhere

| Branch | Shown when | Control |
|---|---|---|
| `installed` | already running standalone | continue |
| `prompt` | the event was captured | a button that opens the browser's dialog |
| `ios` | iPhone or iPad | the Share-sheet steps |
| `manual` | anything else, **and the first render** | one line pointing at the browser's own menu |

`manual` being the first render is what keeps this free of hydration mismatches: the server knows none of these facts, so it renders the branch that assumes nothing.

**Detection is a hint, never a gate.** Every signal here lies somewhere. `display-mode: standalone` is unreliable on iOS before the first home-screen launch, `beforeinstallprompt` never fires in Firefox or Safari even though both can install, and the iOS branch is a user-agent sniff.

**Why the sniff is defensible here and not in 10d.** iOS is the one platform that can install and never announces it, and the platform where skipping the install means push never works at all. A wrong answer costs a paragraph of instructions next to a Skip that still works. In 10d a wrong guess about the *browser* would send someone hunting through a settings menu that does not exist, which is why that case guesses nothing.

Accepting the dialog deliberately does **not** navigate: the browser hands over to the installed app and reloads the page inside it, and moving on ourselves would race that. A dismissal falls back to the instructions, and the spent event is cleared so the button that could only fail is gone.

#### What the tests can reach

Chromium does not fire `beforeinstallprompt` in a headless run, so `e2e/install.spec.ts` plants the same object the inline script would, via `addInitScript`, which runs in the same place: before any page script. That tests the wiring, which is the part that breaks. The iOS branch gets a context with an iPhone user agent.

What no browser test can reach: whether the dialog actually opens, and whether the Share-sheet steps match the sheet iOS currently draws. Both are in the manual pass.

---

### 10c. The one ask, and the four ways it can end

`/onboarding/notifications`, after the install nudge because on iOS push works only inside an installed PWA: asking first would spend the single permission a browser grants on a browser that cannot deliver.

#### The prompt follows a tap, never a render

One ask per origin, and a denial is permanent until the person reverses it themselves. Asking on mount spends that chance before anyone has read why, which mostly buys a permanent no. The screen explains, the button asks, and `e2e/push.spec.ts` counts the calls to prove a render makes none.

#### Every path is named

`enablePush` returns one of `subscribed`, `denied`, `dismissed`, `unsupported` or `failed`, because five separate things can fail: support, permission, the service worker, the push service, and our own write.

**The rule this exists to keep: never report success we did not get.** "Notifications are on" over a subscription that was never written is worse than saying nothing, because the person stops expecting a reminder that will never arrive. A test asserts the success heading and a real row appear together or not at all.

A dismissal is not a failure and does not read as one: nothing was spent, the browser will ask again. Only a genuine breakage is styled as an error, and it says what broke.

#### Two things found while building it

**`navigator.serviceWorker.ready` never rejects.** If registration failed, it simply never settles, and the button would spin forever with nothing in the log. It races a ten-second timeout now.

**A subscription made under a different VAPID key is dead.** The push service keeps accepting it and nothing errors; the messages just never arrive. A rotated key would therefore break delivery silently for everyone who had already subscribed, so a mismatch is unsubscribed and replaced rather than reused.

#### The blocked case names no browser

`components/push-denied.tsx`, shared with the settings toggle so the wording cannot drift. One generic sentence, always true, and four links maintained by the people who own the menus. Naming the wrong browser's settings to someone who is already stuck is the least useful thing this app could do, and browsers move these menus often enough that hand-written steps go stale silently.

The 10b install nudge does sniff for iOS, and the difference is the cost of being wrong: a bad guess there shows an extra paragraph next to a working Skip.

**All four URLs were fetched and read before being written down**, per the note in the plan, rather than recalled. Edge's canonical URL is shorter than the one in circulation, and the short form is what shipped.

**A correction to 10c's test plan, found on the first run.** `permissions: ["notifications"]` is granted happily by Playwright and headless Chromium reports `Notification.permission === "denied"` anyway, so the test that wanted a granted browser rendered the blocked branch and timed out looking for a button the app was right not to draw. The page snapshot said so in one line; guessing would not have.

The fix is a sharper split rather than a stronger stub: the **answer** is stubbed, and everything after it is real, including `pushManager` and the write. What a headless browser cannot have is the dialog, and that was always the manual pass.

---

### 10d. The toggle that asks the server

`components/push-toggle.tsx`, in settings, and `pushEnabledHere` / `disablePush` alongside it.

#### Three states, and the third is why it is not a checkbox

| Permission | Rendered |
|---|---|
| `default` | an off switch that asks when tapped |
| `granted` | on or off, writing and deleting the subscription |
| `denied` | not a switch: the shared explanation and the four help links |

A control that cannot do the thing it depicts is worse than none. It invites a tap, does nothing, and leaves someone believing they turned something on.

#### The part the plan did not anticipate

**"On" is a conjunction of three facts, not one.** The browser must permit it, this browser must hold a subscription, and the row must still name *you*.

The third is not pedantry. A browser keeps its `PushSubscription` across sign-ins, and `subscribe_push` hands an endpoint to whoever subscribed last, by design. So on a shared browser the local subscription outlives the row it used to match, and a local-only check would show "on" to someone whose endpoint now belongs to a flatmate. That is a state this app creates deliberately, which makes it the kind of lie a toggle should not be able to tell.

`pushSubscribed(endpoint)` is the extra read: one indexed lookup, and the difference between a toggle reporting a fact and one reporting a hope.

#### Turning it off has an order

The browser first, then the row. If the row delete then fails, the subscription is already dead and `send-digest-push` prunes it on the next 404 or 410, so the system converges on its own. The reverse order can leave a live subscription with no row, which converges on nothing: the browser keeps a registration nobody will ever use and the person cannot tell.

Idempotent in both directions. Nothing to unsubscribe is a success, because a browser that has already forgotten is in the state the person asked for.

#### Two smaller decisions

**Only a real breakage is an `alert`.** "Nothing changed" and "they're off now" are outcomes someone chose; announcing those as errors is how people learn to ignore the ones that matter.

**The heading says "on this device".** Push goes to browsers, so a page-level switch would imply a promise the sender cannot keep on the phone left at home.

---

### Two things found on the way to the manual pass

**CI could not typecheck a clean checkout.** `app/layout.tsx` uses `LayoutProps<"/">`, and that type is *generated*: Next writes it into `.next/types` during dev or build. Every developer machine has run the app, so the type is always there locally and never there in CI, which checked out, installed, and ran `tsc` before the build step. The error names a file that is perfectly correct.

`npm run typecheck` is now `next typegen && tsc --noEmit`, and CI runs the script rather than the bare command, so the two cannot drift apart again. `typegen` writes the types without paying for a full build.

**The iPhone got its own Playwright project.** `e2e/ios.spec.ts` runs in WebKit at iPhone size under `mobile-safari`; the Chromium project ignores it. Not a second run of the whole suite: everything else behaves the same in both engines, and doubling the run would double the Supabase auth requests the suite already rations.

It is written around an honest limit. **Playwright's WebKit is not iOS Safari**: same engine, different shell, and it never installs a PWA, so no test can show that push reaches an installed app. What it can show is the branch an iPhone in a browser tab gets, which is the case most people meet first and the one most likely to regress silently: the Share-sheet steps rather than a button iOS will never honour, and the "install it first" line at the one moment that advice is actionable. Where the engines legitimately differ, the tests accept either answer and fail only on a screen with no way forward.

---

### The archive button that refused everything

Reported as "clicking Archive says *That value isn't allowed.*", alongside a `share-modal.js` console error. The console error was a red herring: no such file exists in this repo or is served from it, so it came from a browser extension. Worth stating plainly, because it was the only visible symptom and it pointed nowhere.

`That value isn't allowed.` is `toMessage`'s copy for a bare `23514`, so the click was reaching Postgres and a CHECK was rejecting it.

**Reproduced before it was theorised.** Archiving one of the account's real goals in a rolled-back transaction, with `now()`, **succeeded** — so RLS, grants and the trigger chain were all fine. Repeating it with `now() + 2 seconds` failed with exactly `23514 / goals_archived_not_future`. That is the whole bug: `archiveGoal` minted the timestamp with `new Date()` in the Node process, and `CHECK (archived_at <= now())` judges it against a clock in another datacentre. Any forward skew — a laptop back from sleep is enough — refuses every archive, and the message is about a value the person never supplied.

**Already in the pattern list, and not fixed.** *"A client's clock is not the database's"* has been shape thirteen since it was written, naming this exact constraint and this exact action, with "the fix is a trigger" as the remedy. Writing a pattern down is not the same as removing it, which is worth remembering about the other nineteen.

**The fix is that no timestamp is minted here at all.** Both writers now send the literal `"now"`, which Postgres reads as the current transaction time, so the clock that judges the value is the clock that produced it. Same rule as check-in dates.

**Not the trigger the note prescribed.** A trigger that silently rewrites a caller's future timestamp removes the error and keeps the lie, and it would hide a genuinely broken host clock from the one place it shows.

`markNotificationsRead` had the identical shape and is the worse half: `read_at` has no CHECK, so a skewed clock never errored. It would simply have recorded that you read a notification in the future, and every later comparison would be quietly wrong.

**No test had ever clicked Archive.** `e2e/goals.spec.ts` now creates a goal, archives it through the screen, and asserts both halves separately: the row leaves the list *and* `archived_at` is set. They fail for different reasons and look identical from the outside. A second test archives behind the page's back and requires the refusal to be a sentence rather than silence.

---

### Seven failures, two causes, and neither was where it looked

#### A. Six gate tests, one cascade

Every failing test reported the same thing: `/today` handing back to `day-done`, or `/dashboard` refusing to divert. Both mean `hasUnfinishedDay` was false.

The first suspicion was that parking goals marks the day complete. **Disproved by reading the function**: `recompute_daily_completion` records a day with zero active goals as `false`, not vacuously true, and says so in a comment.

The account told the real story. All four active goals were checked off today, so the day genuinely *was* finished — while `daily_completion.all_completed` said `false`. Recomputing in a rolled-back transaction confirmed the row was stale: `stored=f recomputed=t`.

That explains the ordering exactly. The tests that pass run **before** `a finished day`, which parks and restores every goal; the restore recounts, the stale row is corrected to `true`, and every test after it inherits a legitimately finished day. **A test's cleanup fixed the data and broke the file.**

Two fixes, because there were two faults:

- **The tests never owned the state they asserted on.** "There is something left to do today" was a fact about a real account that happened to hold for months. `ensureUnfinishedDay` now seeds one unchecked goal in a `beforeEach` across all three describes; a goal nobody has checked off is exactly what `hasUnfinishedDay` needs.
- **Deleting a goal recounts nothing.** `goals_maintain_completion` covers INSERT and UPDATE, which is right for production, where `goals` has no DELETE grant at all. The suite is the only thing that deletes goals, so it has to recount itself — `recountToday` does it by writing `archived_at` back to itself, since `UPDATE OF` fires on assignment rather than on change. `deleteE2EGoals` now calls it for every affected owner. This is almost certainly how the row went stale in the first place.

#### B. The push test could not tell its own write from a leftover

Failure UI shown, `push_subscriptions` count of 1. The count was **account-wide**, which conflates "this click wrote a row" with "this account has a row from something else". It now reads the endpoint the browser is actually holding and asks about that row alone, and clears the account before the click as well as after.

The hunt also found a real defect in the product code, not just the test. `enablePush` named every outcome it could reach except one: a **server action that rejects** rather than returning. A dropped connection or a dev server recompiling mid-flight throws out of the call, and unwrapped that rejection escaped to the caller, leaving the button on "Waiting for your answer…" forever while the row may or may not exist. Both callers now catch, and the message is deliberately not "we couldn't turn them on": the browser is subscribed and the write may have landed, so it says so and invites a retry, which is idempotent.

---

### 10e. The repair that must not ask

`pushsubscriptionchange` is the quietest failure in the push stack: the service invalidates a device's subscription, issues a new one, and **nothing errors**. Delivery stops and neither side notices. `sw.js` has posted `RESUBSCRIBE_PUSH` to open windows since it was written; the window side logged it and did nothing.

**`resubscribeIfPermitted` shares everything after the permission answer with `enablePush`.** One place decides what a valid subscription is — including tearing down one made under a different VAPID key — and one place writes it. Two copies of that logic would drift, and the half that drifts is the half nobody watches.

**It never prompts.** Permission that is not `granted` returns `denied` rather than asking. A repair is not a request: the person already said yes, and a browser grants exactly one ask, so spending it from a background event on a screen nobody is looking at would be the worst available use of it. The test dispatches the worker's message with permission at `default` and asserts the ask count stays at zero.

Fire and forget, and deliberately silent. Nobody requested this and nobody is watching it, so a failure must not surface as an error over whatever they were actually doing. It stays broken until the next repair or a visit to settings, which is where a visible answer belongs.

**What it still cannot do.** The worker can only post to an *open* window, so a device that never opens the app is repaired at its next visit rather than in the background. `send-digest-push` prunes the dead endpoint on a 404 or 410 in the meantime, which stops the retries without restoring delivery.

---

### 10f. A suggestion, aimed narrowly

One line above the notifications list, for people who never turned push on.

**Four groups must never see it**, and naming them is most of the design: anyone already subscribed, anyone whose browser is blocking it (this line cannot fix that; settings carries the help links), anyone who dismissed it before on this device, and any browser that cannot do push at all — where suggesting it would simply be a lie.

**It renders nothing until it knows.** All three facts are client-side and one needs a round trip, so the first paint is empty rather than optimistic. A line that appears and then vanishes is worse than one that arrives a beat late, and this one would flash at exactly the people who already said yes.

**It links to settings rather than asking.** The real `requestPermission` stays in the two places that explain themselves first. A prompt fired from a notifications list would spend the one ask a browser grants on somebody who came here to read something else.

**Dismissal is a cookie**, like `/today`'s marker and for the same reason: it is a fact about a device. Dismissing on a laptop should not hide it on the phone that would actually deliver the notification. The write is fire and forget — the line hides immediately and is remembered in the background — because an error message about dismissing a suggestion would be worse than the suggestion.

**Step 10 is now built end to end**: the RPC, the install nudge, the permission screen, the settings toggle, the repair path, and this. What remains is the manual pass, which no test in this suite can stand in for.

---

### The two streak tests, and the cron that broke them

Both failures were in the streak header: a broken run that would not name itself, and "day one" that never appeared. The page snapshot said "1 day" instead — so the streak was not zero, and nothing in the test had put it there.

**`getTodayData` reads `user_lifetime_stats.current_streak`**, not `daily_completion`. `parkCompletionHistory` clears history, and the stored streak survives it untouched. Both tests had therefore always depended on the owner's stat being zero, which it was, for months.

`user_lifetime_stats.updated_at` named the culprit precisely: **09:05 today, the daily rollover cron**. The account genuinely earned a one-day streak overnight. Nothing in this session caused it, and re-running would not have cleared it.

Fourth instance of *a test asserting on state it does not own*, and the first where the trigger was **a scheduled job rather than another test** — which makes it the least reproducible of the four and the most likely to look like a flake. The helper now parks the stat alongside the history and puts it back last, unconditionally, because silently zeroing a real account's streak is its own bug.

---

### Two iPhone bugs, found by looking at one

**The category picker disagreed with itself.** iOS renders a `<select>` as a wheel and **skips disabled options entirely**, so the disabled placeholder meant the wheel opened on "Career & Professional" while the element's value was still `""`. Tapping Done moved nothing, fired no `change`, and submitted an empty category — the control said one thing and the form said another, which reads as the selection simply not working.

The fix is one word: the placeholder is selectable now. The wheel opens on "Choose a category", so the displayed row and the real value can never disagree, and `required` still stops an empty submit — except now the browser's complaint matches what the person can see. `createGoal` already answered "Pick a category." for an empty value, so the server half was never the problem.

**The layout asked to draw under the camera and never paid it back.** The root layout sets `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style: black-translucent`, which together are a deliberate request to extend beneath the status bar and the Dynamic Island so the themed background reaches the edges. Nothing in the CSS ever consumed `env(safe-area-inset-*)`, so on a notched iPhone the header lost its top.

Padding on `body`, all four sides, rather than per screen: every route renders inside it, a rule per layout is a rule someone forgets on the next layout, and landscape and the home indicator need the other three sides.

**The request and the compensation lived in different files**, which is why this survived every desktop test and every review. Both shapes are now in `patterns.md`.

**What the new tests can and cannot do.** The category guard is real: the placeholder must not be disabled, and the select's value must match the option it displays. The safe-area test only proves the **rule exists** — `env(safe-area-inset-*)` resolves to 0 in every headless browser, so nothing automated can see a notch. Whether it looks right on hardware is in the manual pass, now with two more lines in it.

---

### The pre-commit audit for step 10

Ran the standing checks in `patterns.md` rather than describing them. Clean: `anon` still reaches only `circle_preview`, hints and `BY_HINT` match in both directions, no orphaned notifications or stray rows, advisors unchanged apart from `subscribe_push` joining the same intentional `SECURITY DEFINER` class, no `console.*` or `TODO` left, and no environment variable read at module scope, so a CI build with no env still compiles.

**Two real findings.**

**Migration 77 was not in the repo.** Applying it through the MCP tool records it in the remote migration table and writes no file, so the tracked history stopped at 76 while production ran 77. Nothing in CI would have caught it: the app builds, the tests pass against the hosted database, and the gap only appears when someone resets a database from the repo and finds `subscribe_push` missing. The file is now committed, and its body hash was compared against `pg_proc.prosrc` rather than trusted — identical, 2231 bytes either way.

**A test that could not fail.** Every install test planted `window.__solarityInstallPrompt` with `addInitScript`, which is the right way to reach the branch, and means all five would have passed with the root layout's inline listener deleted — the one piece of that feature which cannot be added back later, because `beforeinstallprompt` fires once and there is no API to ask for it again. A test now dispatches a synthetic event and asserts something captured it.

Two type-only exports (`PushResult`, `InstallPromptEvent`) had no importer and are no longer exported. Minor, and the same rule as any other symbol with no reader.

---

### Step 10 stops here, on purpose

Everything in step 10 is written, tested, audited and committed, and **not one line of it has met a real phone**. That is the state this entry records, because "built" and "verified" are different claims and the gap between them is where this feature is most likely to fail.

The three things the suite cannot reach are the three things step 10 is actually about:

| Unreachable | Why |
|---|---|
| The permission dialog | headless Chromium reports the permission denied however it is granted, and never draws it |
| A real push delivery | it needs a real push service, and a test that mocks one proves the mock works |
| The safe area | `env(safe-area-inset-*)` resolves to 0 in every headless browser |

**The checkpoint was planned for after 10d and the work carried on to 10f.** Both pieces are small, and the suite can prove their invariants without a device — re-subscription never prompts, the nudge never reaches for the dialog. That was a reasonable call, and it does not move the checkpoint: it means more code now rests on a moment nobody has seen.

**Step 11 waits behind it**, and not because it depends on step 10. It does not. It waits because a permission dialog is the one thing here that shipping a fix cannot undo, and the reliable way to waste that is to start the next feature and never come back.

---

### Signing out did not let you sign in as anyone else

Found while preparing the manual pass, which needs two accounts on one phone.

Google skips its account chooser whenever exactly one account is signed in to the browser, so pressing "Continue with Google" after signing out went straight back into the account just left. **Nothing in the app could fix that from the inside**: the session that decides is Google's, and `supabase.auth.signOut()` only clears ours.

`signInWithOAuth` now passes `queryParams: { prompt: "select_account" }`. One extra tap for someone with a single account, and the difference between usable and not for anyone with two — a test account, a work login, a shared machine.

**Not `prompt=consent`**, which re-asks for permissions already granted and reads as though something has gone wrong.

A small thing, and worth recording for two reasons: it was invisible to every test, because the suite mints sessions through the admin API and never touches Google; and it would have made the manual pass materially harder at exactly the moment two accounts are needed.

---

### Four notifications, one sentence

The first real finding of the manual pass, and exactly the kind no test could produce: with four Circles, the phone showed four notifications that read identically. Every push title is the literal string `Solarity`, no push body names the Circle, and the `tag` is per Circle — so they do not even collapse into one. A notification nobody can attribute is not a prompt, it is noise.

**The omission was deliberate and the reasoning still holds.** `send-digest-push` keeps Circle names off lock screens because a name is readable by anyone holding the phone, outside every access control the app has. Reversing that outright would trade one real problem for another.

So it becomes a **per-user setting**, defaulting to names on: the person who wants a contentless lock screen can have one, and everyone else gets a notification that says which Circle it is about. Relying on the OS "hide previews" control was the alternative and was rejected — it is all-or-nothing across every app, and it hides the count as well as the name.

**Every string is now inventoried in `notification-copy.md`**, both surfaces, with the variables each type can use, so the copy can be rewritten in one place rather than hunted across an edge function and a panel. Two constraints are written down beside it, because they are easy to breach while wordsmithing: a push may never name a goal — titles are masked per Circle and a lock screen is outside all of it — and the push half holds only the **frozen** `circle_name`, so a renamed Circle pushes its old name while the panel shows its new one.

---

### The manual pass, done

Run on an iPhone against the deployed app. **It found exactly one thing, and it was the thing worth finding**: with four Circles, four notifications arrived reading identically. Everything else held — the Share-sheet steps matched what iOS draws, the permission screen earned its yes, the install nudge and the settings toggle behaved, the safe area was clear of the Dynamic Island, and the category wheel committed what it displayed.

The eight flows are **kept here rather than deleted**. A permission dialog is one-shot per browser, so the procedure is worth more than the result: the next device, the next iOS version, and anyone else who tests this will need it, and reconstructing it from memory is how a step gets half-checked.

#### The procedure, for the next device

**Before you start**

| | |
|---|---|
| Deploy | Vercel, on https. Push needs a real origin |
| Accounts | Two Google accounts. The chooser always appears since `prompt=select_account` |
| Reachable directly | `/onboarding/install` and `/onboarding/notifications` are gated on sign-in alone |
| So | You do not need a new account to see them |
| One-shot | Only flow 2 spends the permission. Do it last |

**Flow 1 — fresh signup, iPhone Safari**

| Do | Expect |
|---|---|
| Sign in with the unused Google account | Account chooser appears |
| Pick it | Username screen |
| Type a username, Continue | Install screen, Share-sheet steps |
| Read the three steps against Safari | Wording matches what iOS shows |
| Tap "I'll do this later" | Notification screen |
| Tap "Not now" | Dashboard, fully usable |

**Flow 2 — install, then permission, iPhone.** Last: it spends the one ask, and it uses the real onboarding screen rather than the settings toggle.

| Do | Expect |
|---|---|
| Safari, Share, Add to Home Screen | Icon on home screen |
| Open Solarity from the home screen | No Safari chrome |
| Open `/onboarding/notifications` there | The real ask screen, with a button |
| Read the explanation before tapping | Does the reason earn a yes |
| Tap "Turn on notifications" | iOS permission dialog appears |
| Tap Allow | Heading becomes "Notifications are on" |
| Check `push_subscriptions` in SQL | One row, your `user_id` |
| Run `select build_daily_digests();` | Rows in `notifications` |
| Invoke `send-digest-push` | Notification on the lock screen |
| Tap the notification | Opens that Circle |

**Flow 3 — layout, a notched iPhone**

| Do | Expect |
|---|---|
| Open the installed app | Header clear of the Dynamic Island |
| Scroll the dashboard to the bottom | Nothing under the home indicator |
| Rotate to landscape | Nothing under the left or right inset |
| Repeat in Safari, not installed | Same, allowing for Safari's own bars |
| Visit `/today` and `/settings` | Same at the top of each |

**Flow 4 — the category picker, iPhone**

| Do | Expect |
|---|---|
| Dashboard, Your goals, tap Category | Wheel opens on "Choose a category" |
| Tap Done without spinning | Still empty; Add goal refuses |
| Tap Category, spin to Fitness, Done | Field reads Fitness |
| Type a title, tap Add goal | Goal appears in the list |
| Archive it | Row leaves the list, no error |

**Flow 5 — the device toggle, both directions**

| Do | Expect |
|---|---|
| Settings, tap "Turn off notifications" | "Notifications are off for this device." |
| Reload the page | Still shows the off state |
| Tap "Turn on notifications" | On again, no second dialog |
| Sign in as the other account, same phone | Its settings show off |

**Flow 6 — a blocked browser.** Skip unless you are willing to spend a denial.

| Do | Expect |
|---|---|
| Deny the iOS dialog, or block in Safari | Settings shows a sentence, no switch |
| Read the four help links | Each opens its browser's own page |
| Dashboard, Notifications tab | No nudge line |

**Flow 7 — Android or desktop Chrome**

| Do | Expect |
|---|---|
| Sign in, reach the install screen | A real "Add to home screen" button |
| Tap it | Chrome's install dialog appears |
| Dismiss the dialog | Falls back to instructions, no error |
| Tap "I'll do this later" | Notification screen |

**Flow 8 — the nudge**

| Do | Expect |
|---|---|
| A browser that never enabled push | Notifications tab shows one line |
| Tap "Turn on notifications" | Lands on settings, at the section |
| Go back, tap "No thanks" | Line disappears |
| Reload | Still gone |

**Resetting between runs**

| To undo | How |
|---|---|
| iOS push permission | Delete the home-screen app, add it again |
| Safari site permission | Settings, Safari, Advanced, Website Data, remove |
| Chrome permission | Site settings, Notifications, Reset |
| The nudge dismissal | Clear cookies, or a private window |
| A subscription row | `delete from push_subscriptions where user_id = …` |

**What a failure means.** Wording that does not match iOS is a copy fix. A dialog that never appears is a bug in the gesture chain. A notification that never arrives is `send-digest-push` or the subscription row, and both are inspectable in SQL before touching any code.

**Add a flow for 10g when this is next run**: turn the Circle-name setting off, send a digest, and confirm the lock screen says nothing specific.

Two smaller things surfaced on the way and were fixed as they appeared: signing out of Google walked straight back into the same account, and the iPhone 17's Dynamic Island cut off the header.

---

### 10g. Naming the Circle, and letting people decline it

**The fix for the one thing the pass found.** Every push title is the literal `Solarity` and no body named its Circle, so a phone with four Circles showed the same sentence four times, and the `tag` is per Circle so they did not even collapse.

**The omission was deliberate**, and reversing it outright would have traded one real problem for another: a Circle name on a lock screen is readable by anyone holding the phone, outside every access control the app has, and for some Circles the name is the sensitive part. So migration 78 adds `users.push_shows_circle_name`, defaulting to **on**, with a settings control beside — but separate from — the per-device toggle. They answer different questions: that one is "does this browser get notifications", this one is "what may a notification say", and the second is an account fact rather than a device one.

**The copy moved into `teaser.ts`.** It was inline in the edge function, where nothing could test it: the e2e suite cannot deliver a push and the sender runs on Deno. Split out, it imports nothing, so `lib/teaser.test.ts` reaches it directly and covers all four states — named, withheld, missing, unknown — including that a `goal_title` planted in a payload can never reach a body. Copy is exactly the kind of thing that breaks quietly: a lock screen reading "undefined" looks fine in every log.

`kicked` stays vague whether names are on or off. It is the one notification whose subject might be read by the person who removed you, which is what the vagueness is for.

**A deployment trap worth remembering.** The MCP deploy tool defaults `verify_jwt` to **true**, and this function needs it **false**: it is cron-invoked with a shared secret and no JWT. Omitting the flag flipped it, which would have silently broken every scheduled send while the function still looked healthy. Redeployed with it explicit. **Pass it every time**, and check the response rather than assuming.

---

### 11a and 11b. Day boxes, and the roll call that was already there

Shipped together: the roll call is markup inside the Circle line rather than a second render path, so splitting them would have meant writing the `<details>` twice.

**No migration.** `digest_snapshots.summary` has carried `members[]` — user id, username, completed, streak — since `build_daily_digests` was written. The step turned out to be a read and a render.

| File | |
|---|---|
| `lib/digest-days.ts` | grouping, ordering, UTC-pinned formatting, streak delta. Pure |
| `lib/supabase/digests.ts` | the single query, and defensive `summary` parsing |
| `digest-panel.tsx` | the boxes |

**The runner is now pinned to a non-UTC timezone.** `vitest.config.mts` sets `TZ` to Los Angeles, because in a UTC runner the date-shifting bug and the correct code agree and every date test becomes decoration. `digest-days.test.ts` asserts the runner is not UTC before trusting itself, and pins the trap directly: `new Date("2026-08-18").getDate()` is 17 there.

**Five days, never five rows.** Taking the newest N rows would drop a Circle whose day sorted last and would show fewer days the more Circles someone is in — the panel would mean something different per account. One query, `limit(circles × 5)`, grouped in TypeScript; at most one row exists per Circle per date, so that limit cannot cut into the fifth day while a fifth day exists.

**Ordering is a fact about now, not about the day.** A pending streak decision or an unread notification lifts a Circle to the top of *every* box, including last week's. Written down because it reads as a sorting bug to anyone who has not seen the reasoning.

#### Two test failures, both mine, and one of them a real inversion

**A strict-mode violation of my own making.** The expanded half carries an "Open {name}" link, so `getByText(name)` inside a box matched twice. The name is deliberately in both places — a link needs a meaningful accessible name — so the locator is scoped to `summary`.

**A dashboard test asserted the opposite of the new design.** It required a brand-new Circle to show "no day has finished yet", so that Overview could not disagree with the Circles tab. Boxes are per *day* now: a Circle with no snapshot has nothing to put in any box, and giving it a row would mean inventing a day.

The test was rewritten to assert the new truth **and** keep the old guarantee somewhere real: the Circle is absent from the boxes, *and* the Circles tab still lists it. "Absent" on its own would also pass if the Circle had vanished entirely, which is the failure that guarantee existed to catch.

**The trade to know about:** a Circle you have just made shows nothing under "How it went" until its first day ends.

#### A test I caught before it shipped

The first version asserted that day six and seven were absent by looking for their **ISO dates** in the panel — which renders "Fri 14 Aug" and never "2026-08-14". It would have passed however many boxes rendered. Replaced with a heading count plus a database check that seven days really sit behind five boxes.

---

### 11c. Digests leave the tab, and 11d dies on the way

Digests were 69 of the 70 rows on the Notifications tab, burying the handful that might need a response. They now live only in the day boxes, sourced from `digest_snapshots`.

**11d was planned and then dropped, after a question that took it apart.** The plan was for Overview to mark the digests it rendered as read, keeping "read means shown" true for every type. Two observations killed it:

- Visiting the tab already cleared the badge, so nothing visible would change either way.
- The badge is `read_at`'s only reader. With digests out of the badge, marking them read is a write nobody reads: a new component, a new action, and a write per dashboard load for nothing.

The fallback idea — have `build_daily_digests` write `read_at` at insert time so digests are "born read" — was worse, and rejected for the reason the original plan existed: a row pushed to a phone nobody picks up would carry a timestamp saying it had been read. Recording a falsehood in the database is worse than recording it in a render.

**So `read_at` stays `null` for digests, permanently.** That is not a gap: the column exists to drive a badge for a list you can open, and digests are not on that list. `null` is the one value that asserts nothing, and the comment says so.

#### What the row is for now

`notifications` became an **outbox** for the four event types and a **delivery queue** for digests: written by the job, read once by the sender, never rendered, deleted at 90 days. With push off, a digest now does nothing at all for that person — they see the boxes next time they open the app, which is the durable copy.

#### A third reader nobody had counted

The tab and the badge were the two known readers. Wiring the filter turned up a third: the "needs attention" ordering added in 11a counts **unread notifications** per Circle. Since digests are never marked read, without the same filter every Circle with a digest would have ranked as needing you forever — the ordering would have been noise, and it would have looked like a sorting bug rather than a missing predicate.

That is the argument for the shared constant in one line: three readers, and the third was found by accident.

#### The residual risk, and what guards it

Someone counts unread rows without naming types and sees roughly `circles × 90` digests. `lib/notification-types.ts` is the guard, which is proportionate rather than absolute. The structural fix — the sender reading `digest_snapshots` so digests stop being rows here at all — is written up under Deferred in `build-plan.md`, along with why it was not done now: `pushed_at` lives on the notification row, and moving it means tracking delivery per member on the snapshot instead.

---

### Step 11 closed

Overview shows five day boxes; the Notifications tab shows four event types; no migration was needed, because `digest_snapshots.summary` had carried the roll call since it was written.

**What step 11 changed about the documents**, beyond its own entries:

- `architecture/app.md` gained a dashboard section, because the boxes have rules a reader needs — five *days* rather than five rows, ordering by a fact about now, UTC-pinned dates — and none of them are guessable from the component.
- `architecture/schema.md`'s digest section now says what the table is: the record of a day, with the notification row as the envelope. Its line claiming push bodies never name a Circle was **stale from 10g** and is corrected.
- `patterns.md` gained a twenty-fourth shape, **an assertion that cannot fail**, with all three instances from steps 10 and 11. It is the one this pair of steps produced that generalises.

**Both steps also left a habit worth keeping**: after writing a test, name the edit that ought to turn it red, and check that it would. Every one of those three inert assertions was caught by reading rather than running, which is the only way they *can* be caught.

---

## Step 12: security headers

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


---

## Steps 9 to 12, as the build plan carried them

Moved here when step 13 began. `build-plan.md` is read daily and holds open work only; these are the summaries it carried while each step was current, kept because each names the pieces in the order they were built and that ordering is the part hardest to reconstruct later.

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

A CSP with a per-request nonce, HSTS, `nosniff`, `Referrer-Policy`, `X-Frame-Options`, and a `Permissions-Policy` that grants nothing. How it works: `architecture/security.md` section 3b. What went wrong on the way: `history.md`.

| Piece | |
|---|---|
| 12a | The fixed headers, in `next.config.ts`, because the proxy's matcher skips `sw.js` and the static assets |
| 12b | Nonce CSP in `proxy.ts`, dev and prod branched; the layout reads `x-nonce` |
| 12c | `/api/csp-report`, logging only, reading both report body shapes |
| 12d–12e | Header tests, and the `security.md` section |

**Four bugs, and not one of them raised an error.** A nonce cancelling the `'unsafe-inline'` beside it; `upgrade-insecure-requests` rewriting subresources to a dead port; `form-action 'self'` refusing a pre-hydration sign-in click; and the report route treating a missing Upstash config as a rate-limit refusal. Two were WebKit-only *and* production-only, so **`E2E_PROD=1 npm run test:e2e:ios` is the run that matters here**.

**It left `patterns.md` a twenty-sixth shape**, which is the part worth carrying forward: **a protection that fails as absence rather than as refusal**. Three rounds went into `script-src` because a page running no JavaScript *looks* blocked.


---

## Step 13: check-in photos

Moved here when the core loop closed. Migrations 79, 80 and 81; the build plan keeps only the manual pass, which is the part still owed to a device.

Attach a photo to a check-in, and let the people in your Circles see it.

**Split out of step 9** because it is a subsystem rather than a field, and bundling it would have meant `/today` shipping only when the hardest part did.

#### What is already built, and it is most of the hard part

From migrations 40, 45, 48, 64, 71 and 72, all deployed and none of it ever exercised by a real client:

| | |
|---|---|
| Both buckets | Private, `checkin-photos` capped at 10MB, `image/webp` only |
| `checkin_photos_select` | Via `private.can_view_checkin_photo`, which since **72** stops hiding your own photo from you and since **71** reads `goals.hidden_everywhere` |
| `checkin_photos_insert` | **64** tightened it to `private.owns_active_goal`, so a fabricated or archived goal id is no longer an acceptable upload target |
| `purge-expired-photos` | Deployed and scheduled. Objects go at 90 days; the row and every statistic derived from it stay |
| `grant update (note, photo_url)` | Already held by `authenticated`, so filling the column after the insert needs **no** migration |
| `photoUpload` rate limit | 20 an hour, declared in `lib/ratelimit.ts` since the start with **no caller**. This step is its writer |

**What does not exist: anything that uploads.** `browser-image-compression` has been a dependency since day one and has never been imported.

#### Two things the old plan did not mention

1. **The storage path forces the order of operations.** It is `{user_id}/{goal_id}/{entry_id}.webp`, so the check-in row has to exist before the upload can be addressed. Every design below is downstream of that.
2. **`circle_roster` does not return `photo_url`.** It returns `id`, `title`, `hidden`, `checked`, `note`, `entry_id`, `note_shared`. A Circle member currently has no way to know a photo exists, which is why showing them needs a migration.

**A boolean would not have been enough, which is worth writing down because it looks like it would.** The path is `{user_id}/{goal_id}/{entry_id}.webp`, and **`entry_id` is returned only for your own rows** — migration 72 scoped it that way. So a viewer handed `has_photo: true` could not name the object it refers to. The roster returns the masked `photo_url` instead, which is the object key the column already stores and the same value `purge-expired-photos` hands to Storage.

**That is not a capability.** The bucket is private, so holding a key gets you nothing without a signed URL, and signing one still has to pass `checkin_photos_select`. The key is a name, not a door.

#### Decisions

| | |
|---|---|
| **Upload and display together** | A photo nobody can see is not a feature. Migration 79 adds a photo field to the roster |
| **A plain file input**, `accept="image/*"`, no `capture` | iOS draws its own sheet — Take Photo, Photo Library, Choose File — so the camera is one tap away and nothing legitimate is blocked. `capture` is ignored on desktop anyway, so forcing it would apply the rule to some people and not others |
| **The check-in wins; the photo is best effort** | Check in, upload, then patch `photo_url`. A failed upload leaves an ordinary check-in, which is a state the app already handles everywhere |
| **Removing a photo and undoing a check-in are two different things** | `removeCheckinPhoto` deletes the image and keeps the day. Undo removes both, and says so first. See below |
| **Photos are shared by default; notes are not** | Deliberate, and the one asymmetry in this step. See below |
| **Signed URLs, one hour, minted at render** | The roster is a server component, so they are already in the HTML |
| **Lazy thumbnails, one stored size** | `loading="lazy"` on a small `img`, full image on tap. No second object and no thumbnail pipeline |
| **Attachable any time today** | Check off the run now, add the photo when you get home. Not backfillable to a past day |
| **Hidden here means hidden here** | The roster already withholds the *note* from a Circle where the goal is hidden. The photo follows the same rule, so one Circle's view is internally consistent |

**That last one deserves care, because the two rules are deliberately not identical.** The Storage policy serves a photo if **at least one** shared Circle can see the goal; the roster masks per Circle. Both are right for their own job — Storage cannot answer "which Circle is this request about", and a Circle where you hid a goal should not show its photo. But it means the same photo is withheld by the roster and served by a direct signed URL. **Write it down in `security.md` rather than trying to make one rule serve both**, and do not re-implement either inside the other: migration 71 already had to undo exactly that mistake with `is_goal_hidden_in_group`.

#### Pieces

| Piece | |
|---|---|
| 13a | ✅ **Migration 79.** `photo_url` in `circle_roster`'s goals jsonb, masked exactly like `note`. Proved in a rolled-back transaction in four directions, with a negative control |
| 13b | ✅ `lib/photo-upload.ts`. `sniff`, `inspect` and `photoKey` are pure and unit-tested; `preparePhoto` needs a canvas and is Playwright's, so `browser-image-compression` is imported dynamically |
| 13c | ✅ The button on `/today` and in `TodayPanel`, the direct-to-Storage upload, and `attachCheckinPhoto` — which **derives the key rather than accepting one**, and finally spends the `photoUpload` limit |
| 13c-2 | ✅ `removeCheckinPhoto`, the confirmation on undo, and **migration 80** from the audit |
| 13d | ✅ `signPhotos` (batched, signed **as the caller**), `CheckinPhoto` on the roster and in `TodayPanel`. The object key never leaves `lib/supabase/` |
| 13e | ✅ **Migration 81** and the sweep, folded into `purge-expired-photos` (version 8, `verify_jwt` still off). `security.md` section 9 rewritten from designed to built |

#### Things that will go wrong, listed before they do

#### The one asymmetry: photos share, notes do not

`note_shared` exists because a note is a sentence you might not want read. **A photo is the proof**, so a photo nobody can see is a photo nobody asked for, and `can_view_checkin_photo` has served them to Circle members since migration 45 with no opt-in flag anywhere.

So the rule is: **hiding the goal is the control.** Hide it in a Circle and the photo goes with the title and the note; there is no second switch.

**Two fields on one row behaving differently is exactly the thing that gets "fixed" by someone who does not know why**, so it is stated here, in `security.md` section 9, and in the code comment on whatever renders it. If photos ever do need an opt-in, it is a column, a grant, a change to `can_view_checkin_photo`, and a second tick box on a form whose whole job is to be fast — not a small change.

#### Signed URLs

**One hour, minted during the server render.** The roster is a server component, so the URLs are in the HTML before the browser asks for anything.

**The alternative was a route handler** that checks access and redirects to a fresh URL per request. Rejected for a specific reason rather than cost: that endpoint would have to re-derive the access rule the Storage policy already enforces, and **the rule living in two places is the mistake migration 71 had to undo**. Storage is the single reader of `can_view_checkin_photo` and it stays that way.

**What an hour costs, honestly:** a tab left open overnight gets 403s on scroll, and a refresh fixes it. A URL copied out of the page works for an hour. Both are acceptable for a screen people open and close; neither would be at 24 hours.

#### Weight on the roster

A Circle holds ten people, each with up to ten goals. **One stored size (~1600px), displayed as a small `loading="lazy"` thumbnail, full image on tap.**

**No thumbnail pipeline**, because a second object doubles the paths, the policies and the purge logic for a product with ten people per Circle. The honest cost of that: a phone may pull a few hundred KB per *visible* photo even though it is drawn small. `loading="lazy"` is what keeps that bounded to what is actually on screen, so it is load-bearing rather than decorative.

#### When a photo can be attached

**Any time today, until rollover.** Check off the run now, add the photo when you get home. The entry is the anchor and `attachCheckinPhoto` exists anyway, so this is nearly free.

**Not backfillable to a past day**, though nothing in the schema stops it. A photo attached to last week's check-in is evidence for a day it was not taken on, which quietly removes the only thing a check-in photo is for. The restriction is the app declining to offer time travel, the same posture `undoCheckIn` already takes with its date filter — not a security boundary, and it should say so where it is written.

#### What 13d settled

**Keys stop at `lib/supabase/`.** `circle_roster` returns the object key,
`getCircleRoster` and `getTodayData` exchange it for a signed URL, and no
component ever holds a path. A component that held one would be a component that
could build a URL.

**Signed as the caller, never the service key.** `createSignedUrl` evaluates
`checkin_photos_select` for whoever asked, so Storage stays the only place the
access rule lives, and a key the roster offers but Storage refuses simply
arrives as null. That is also the **second gate** behind migration 80: two
independent things would have to be wrong for a photo to reach the wrong person.

**Batched, and matched by key rather than position.** A Circle of ten with ten
goals each is a hundred photos on one render. `createSignedUrls` reports a
*per-path* error rather than failing the batch, so matching by index would put
one person's photo on another person's row the moment a single key was refused —
a bug that reads as a privacy leak and is really an off-by-one.

**A plain `<img>`, not `next/image`.** The source expires within the hour and
differs per request, which is exactly the input an optimiser cannot cache.

#### One more bug, found by the build

`E2E_PROD=1` never got as far as running a test: `next build` refused, because `lib/supabase/circle-roster.ts` had gained `server-only` behind `signPhotos` while `today-roster.tsx` — a client component — imported `formatProgress` from it.

**It had been importing that for months.** The value import put the whole module in the browser bundle; nothing minded until the module started talking to Storage. The error named `photo-urls.ts`, which was correct and unhelpful.

The types and `formatProgress` now live in **`lib/roster.ts`**, importable from anywhere, and `circle-roster.ts` carries `server-only` — **whose absence was the actual defect**, since it is the thing that would have made this fail on day one instead of on the day it mattered.

**Neither `tsc --noEmit` nor ESLint sees this**, before or after. It is `patterns.md`'s twenty-seventh shape.

**And then a second one of the same family.** `photos.spec.ts` used `import.meta.url` to find its fixture. There is no `"type": "module"` here, so Playwright compiles specs to CommonJS and that is a syntax error **at load time** — the whole file leaves the run before a test starts, and typecheck and lint both pass on it. `env.ts` and `auth-state.ts` had already settled the convention: resolve from `process.cwd()`. **`npx playwright test --list` compiles every spec and runs nothing**, which is the two-second check that catches this, and it is now in `testing.md`.

#### Three rounds of test-only bugs, and what they have in common

None of them were product bugs, and **none were visible to `tsc` or ESLint**:

| | Caught by | The lesson |
|---|---|---|
| `server-only` reaching a client bundle | `next build` | A value import from a client component drags the whole module. `circle-roster.ts` lacked `server-only`, which is what would have failed on day one |
| `import.meta` in a spec | `playwright test --list` | Specs compile to CommonJS. `env.ts` and `auth-state.ts` had already settled on `process.cwd()` |
| Bare `.update()` and `.upsert()` | the run itself | `assertOk` reads `data: null` as failure, and PostgREST's upsert needs UPDATE on **every** payload column |
| Asserting against a shut roster row | the run itself | The goals list is `{open ? … : null}`, so a closed row has no goals in the DOM. **`today-roster.tsx` says this in its own header comment** |
| One picture, two `<img>` | the run itself | A thumbnail plus a full copy sharing an `alt`. **This one was a real defect, not a test bug**: a screen reader announces it twice. `CheckinPhoto` is now a single image that changes size on `group-open` |

**The common thread is that each convention already existed somewhere in the repo**, and in the last case it was written at the top of the very file being tested. The first thing to do in a new spec is read a neighbouring one, and the component it drives.

**Every absence assertion now has a presence assertion beside it.** `toHaveCount(0)` on a row that never opened passes whatever the masking rule does — which would have made the most important assertion in the file the one least able to fail.

**All three were verified by running the real thing**, not by reasoning: a real `next build`, a real `--list`, and the corrected statements replayed as `authenticated` in a rolled-back transaction.

#### The whole-project audit, after 13e

Walked with `patterns.md` in hand, plus a symbol-level pass over every `.ts`/`.tsx` with the TypeScript compiler API, plus the standing SQL checks against the **deployed** database rather than the migrations.

**Clean, and worth recording as clean:**

| | |
|---|---|
| The error contract | **24 hints raised by `pg_proc`, 24 resolved in `lib/errors.ts`, zero drift either way.** `errors.test.ts` already guards the retired `CIRCLE_NOT_ACTIVE` |
| `.rpc()` outside `app/actions/` | Exactly the three documented exemptions: `current_checkin_date`, `circle_preview`, `circle_roster` |
| Notification types | Five in the enum; four owned by the tab and rendered; `digest` deliberately neither, since 11c |
| Stray fixtures | 0 `E2E ` goals, 0 `E2E ` Circles, 0 orphaned notifications |
| `SECURITY DEFINER` | 0 with a mutable `search_path` |

**Four findings, all fixed:**

| | |
|---|---|
| `TodayGoal` was declared **twice** | `lib/supabase/today.ts` exported it and `today-panel.tsx` re-declared an identical copy, so step 13 added `entryId` and `photoUrl` to both by hand. Now one declaration in `lib/today-shape.ts` — which cannot live in the `server-only` module, for the reason the build already taught us |
| `TabNotificationType` had no reader | Its stated job is done by `satisfies readonly NotificationType[]`, which the compiler checks. Removed |
| `security.md` claimed **0 anon-executable** | It is 1, `circle_preview`, deliberately — and `patterns.md`'s standing check says to expect exactly that row. The two documents contradicted each other, and the query would have read as a regression |
| **Eight real rows claiming a photo that never existed** | Left in the production database by earlier runs of `photos.spec.ts`. `progress_entries_goal_id_fkey` is `ON DELETE SET NULL`, so deleting the goal kept the entry and its `photo_url`. Cleared by `job_null_missing_photos` — **migration 81 doing its job on real garbage rather than a fixture** — and the spec now deletes entries before goals, as `boundaries.spec.ts` always has |

**One thing left stale on purpose to report rather than fix:** `graphify-out/graph.json` was built at `e69212e` and HEAD is `b1d37e8`. **13 tracked files are missing from it**, all of steps 11–12, plus every file step 13 added. The CLI is not installed in this environment, so it wants a regenerate where graphify lives.

#### The manual pass, when the build is deployed

**Four things no headless browser can reach.** Under ten words a step, same format as step 10's, and moved to `history.md` once done.

| # | Flow |
|---|---|
| 1 | iPhone, installed PWA. Check off a goal. |
| 2 | Tap `+ photo`. **Sheet offers Take Photo, Photo Library, Choose File.** |
| 3 | Take Photo. Shoot **in portrait**. Confirm. |
| 4 | **The photo is upright, not sideways.** This is the EXIF check. |
| 5 | Photo Library. Pick a **HEIC** shot from the camera roll. |
| 6 | It uploads, or says to try a JPEG. Never a silent nothing. |
| 7 | Second account, same Circle. Open the Circle. |
| 8 | Thumbnail appears. Tap it. Full image opens. |
| 9 | Scroll a roster with several photos. **Does it feel fast on mobile data?** |
| 10 | Owner: hide the goal in that Circle. Reload the other account. Photo gone. |
| 11 | Owner: `Remove photo`. Check-in survives, day still counts. |
| 12 | Owner: add a photo, then `Undo`. **Dialog warns before deleting it.** |
| 13 | Undo a goal with **no** photo. **No dialog.** |

**Step 4 is the one to be careful about**, because a sideways photo looks like a working feature and nothing will report it. **Step 2 is where `Permissions-Policy: camera=()` would show up** if the reasoning about `capture` versus `getUserMedia` is wrong.

#### The audit after 13c

**One real hole, and it was one 13a opened.** `authenticated` holds `update (photo_url)`, the only WITH CHECK on the table is `user_id = auth.uid()`, and since 79 `circle_roster` hands that column's value to your Circle. So a hand-crafted PostgREST call could point `photo_url` at **someone else's object key**, and circle-mates would be shown a stranger's photo as your proof of a day.

Bounded rather than catastrophic: signing a forged key still has to pass `checkin_photos_select`, so a viewer only ever reached a photo they could already see. What it bought was **misattribution**, which an accountability product cannot be casual about. **Migration 80** states the rule as a CHECK, where PostgREST cannot route around it.

**Its null escapes are load-bearing.** Both foreign keys are `ON DELETE SET NULL` (migration 12), a `SET NULL` is an UPDATE, and a CHECK is evaluated on it — so a constraint demanding `goal_id is not null` whenever a photo exists would make **deleting a goal fail** on a row nobody touched. Proved in a rolled-back transaction: own key accepted, foreign owner refused, wrong entry refused, and the goal still deletable.

**Three smaller findings, all fixed**

| | |
|---|---|
| A throwing action leaves the button stuck | The transition never settles and the control is disabled with no explanation. **The same bug step 10 shipped in the push toggle.** Both handlers now catch as well as check |
| `lib/supabase/client.ts` said "reads only" | No longer true: the upload writes to Storage from the browser, and it has to — the bytes would otherwise cross our runtime to reach a bucket the browser can already address. Now documented as a deliberate exception, with the note that the write which *matters*, `attachCheckinPhoto`, is still an action and still metered |
| The attach flow needed a test from a real client | The migration's proof runs as the table owner. `e2e/photos.spec.ts` now asserts the constraint through PostgREST, including the subtle half: **your own folder, a different entry**, which a constraint checking only the owner would accept |

**One refinement to the plan.** The photo button appears once a goal is checked off, rather than sitting inside the check-in form. The object key is `{user_id}/{goal_id}/{entry_id}`, so there is nothing to address until the row exists — and it costs no taps, because picking a file is itself a tap and a sheet either way.

#### Removing a photo, and undoing a check-in

**These are two different intentions and they get two different controls.** The case people actually hit is a blurry or wrong photo, and making them undo the whole check-in to fix it would put a streak calculation in the path of a cosmetic mistake.

| Control | What it does |
|---|---|
| **Remove photo** | Deletes the object, nulls `photo_url`, **keeps the check-in**. The day still counts |
| **Undo check-in** | Removes both. When a photo exists it says so and asks first; with no photo it stays one tap |

**The confirmation cannot offer to keep the photo, and that is not a UI choice.** The path is `{user_id}/{goal_id}/{entry_id}.webp` and the purge job finds objects *through* `photo_url`, so a photo whose row is gone is unreachable by its owner and invisible to the job that is supposed to clean it up. The dialog's job is to warn, not to offer a third option that would leak.

**The confirmation is conditional on purpose.** A dialog people meet every time is a dialog they stop reading, and a check-in with no photo is trivially redone. It appears when it has something real to say.

**Both paths delete the object before the row.** The rule is already in `security.md` section 9 and it is the same one the purge job follows: a crash between the two steps should leave a row claiming a photo that is gone, not a file nothing references. The first is a wrong pixel on a screen; the second is a private object nobody can ever reach or remove.

**And `removeCheckinPhoto` must not spend the `photoUpload` limit.** Deleting is not uploading, and metering it would mean a run of bad photos locks you out of fixing them — a limiter punishing the correction rather than the abuse.

**The same hole, one step earlier.** An upload that succeeds and then fails to patch `photo_url` is an orphan for the same reason. That is the accepted cost of "the check-in wins", so **13e owes the purge job a second sweep**: objects under `checkin-photos` that no `progress_entries` row points at, older than some grace window. Without it, choosing the simple write path quietly chooses a slow leak.

**EXIF orientation is not the same problem as EXIF stripping.** Re-encoding through a canvas drops metadata for free, which is the privacy requirement — a check-in photo must not carry the poster's GPS to the Circle. But it also drops the *orientation* flag, and if the flag is not applied before the re-encode, every photo taken in portrait on a phone arrives sideways. `browser-image-compression` has an option for this. It has to be on.

**HEIC decoding is the browser's, not ours.** Safari decodes HEIC to a canvas; Chrome on Android does not. "Converted client-side" means "converted by a browser that can", so the honest behaviour is to attempt it and say something clear when it fails, rather than to claim support that depends on the reader.

**A client-side magic-byte check stops mistakes, not attackers.** The upload goes straight to Storage, so nothing of ours ever sees the bytes, and the bucket's `image/webp` restriction checks the *declared* content type. Worth doing for the renamed-`.jpg` case, but the real containment is that the object is private, reached only through a signed URL, and rendered in an `<img>` from an origin our CSP already allows. **Say this plainly in the docs** instead of letting "validate magic bytes" read as a guarantee.

**Step 12 owes this step less than it thought.** The old note here said `Permissions-Policy: camera=()` would have to be opened. With a plain file input that is probably wrong: `capture` hands off to the operating system's camera app, not `getUserMedia`, and the header governs the latter. **Leave the header shut**, and if Take Photo does nothing on a real device, it is the first thing to suspect.

**Two questions the old plan asked, now answered by what exists.** Compression runs in the browser, because the client is the only party that ever holds the original. And archiving a goal does nothing to its photos: retention is a flat 90 days by design, since a photo belongs to a user-owned goal visible in every Circle that user is in, so "the cycle this photo belongs to" is not a question the schema can answer. `owns_active_goal` separately means you cannot upload under an archived goal in the first place.

#### What the tests have to cover

A real image fixture through `setInputFiles`, so the path is exercised end to end rather than mocked. A check-in whose upload fails, ending as an ordinary check-in. An undo that removes both the row and the object. And the masking case that migration 71 was written for: **two Circles, one goal, hidden in the first** — the roster must withhold it there and show it in the second, and the assertion has to name the Circle, because a test that only checks "hidden somewhere" passes under both rules.


---

## Step 14: what the loop deferred ✅ done

Four things that were correct to postpone and are now the cheapest work left. In order:

| Piece | |
|---|---|
| ~~14a~~ | ✅ **done.** Dashboard latency: skeletons, per-view reads, route segments |
| 14b | Regenerate `graphify-out/`. Built at `e69212e`, missing 13 tracked files plus everything since |
| ~~14c~~ | ✅ **done.** Achieving a goal, and migration 83 making it one-way |
| ~~14d~~ | ✅ **done.** Goal deadlines, and migration 84 making the column a `date` |
| ~~14e~~ | ✅ **done.** Delete your account, from settings |

---

#### 14a. Dashboard tab switching is slow, and it is not the network ✅ done

Reported from the installed PWA. **Every tab is a `<Link>` to `/dashboard?tab=…`**, so a switch is a full server navigation that re-renders the whole page.

**What a switch to Notifications paid for before step 2 below**, measured against the code:

| | |
|---|---|
| `getTodayData` | Four queries **plus a Storage signing round trip** — and `TodayPanel` only renders under `view === "overview"`, so all of it is discarded |
| `goals`, `categories` | Read by `GoalsPanel`, which is also Overview-only |
| `getCheckinDate` | Needed only by the two above |
| `hasUnfinishedDay` | The `/today` gate. This one is deliberate everywhere |

Roughly **seven sequential hops and ten queries, about half of them rendering nothing** — and there was no `loading.tsx`, so none of it was visible and the tap appeared to do nothing.

##### The fix, in three parts

**1. ✅ `loading.tsx`.** One for `/dashboard`, one for the whole `(app)` group, over a shared `SkeletonLine`/`SkeletonRegion`. The work did not get faster; it stopped being invisible, which was most of what "slow" meant. Unanimated on purpose, and announced once through a `role="status"` container rather than once per placeholder.

**2. ✅ Compute per view.** The reads are now three groups, and **exactly one of the last two runs**:

| Group | Contents | When |
|---|---|---|
| Base | memberships, the profile row, the unread count, `getCheckinDate` | Always. Memberships are read by all three tabs; the profile and the date feed the gate; the count renders on a tab *label*, so it cannot wait for its own tab |
| `loadOverview` | `goals`, `categories`, `getTodayData`, `goal_group_visibility`, the digest reads | `view === "overview"` |
| `loadNotifications` | the notification rows, the push-nudge cookie | `view === "notifications"` |

`getCheckinDate` moved **into** the base batch rather than out of the page: it depended on nothing above it and was costing a full sequential round trip of dead time. `Circles` now runs the base group and nothing else.

**Two decisions worth recording.**

The loaders are **nested functions inside the component**, not module-level helpers. They close over `supabase`, `userId`, `today`, `active` and `inactive`, so their return types are inferred — and `GoalsPanel` does not export the shapes it accepts, so the alternative was hand-writing row types for four PostgREST selects, which is exactly how a panel's props and the query feeding it drift apart.

The JSX branches on **`overview ?`, not `view === "overview"`**. The data only exists on the branch that loaded it, so narrowing on the object is what lets TypeScript prove `overview.todayData` is present. Branching on the string would leave it possibly-null and invite a `!`.

**The `/today` gate stays everywhere**, before either loader runs, so a redirect skips the per-view work entirely. It is one query, and moving it would mean a push notification deep-linking to a tab no longer diverts you to an unfinished day.

**3. ✅ Tabs become route segments**, with the shell in a layout:

```
dashboard/
  sections.ts             the list of sections, and nothing else
  tab-bar.tsx             client; owns the active state
  layout.tsx              header row, tab bar, unread badge, the /today gate
  loading.tsx             body-only skeleton
  page.tsx                Overview
  circles/page.tsx
  notifications/page.tsx
  profile/page.tsx        step 15, one folder and one line in sections.ts
```

**Why this and not Suspense or client state.** Next does **partial rendering**: navigating between sibling segments re-renders only the segment that changed and reuses the layout above from the router cache. So the shared reads happen once per visit rather than once per tap, and — the part that matters more — **the nav bar is never unmounted**. It is the same DOM across every switch, which is the requirement, not a side effect.

##### Two constraints this design has to satisfy

**The nav must survive every navigation, in appearance and in identity.** This is the direction the app is heading: a mobile shell with a persistent bar and a body that swaps. A layout gives that for free *provided the bar does not depend on anything the layout computes per navigation*, which leads directly to the trap below.

**Sections must be addable and removable at will.** `profile/` is coming in step 15 and more will follow. So the list of sections lives in `sections.ts` as data — key, label, href, optional badge key — and both the bar and the layout read it. **Adding a section is one entry and one folder.** Nothing else in the dashboard knows how many sections there are.

##### The trap, and it is a good one

**A server-rendered active tab would freeze on whichever tab you arrived on.** The bar belongs in the layout; the layout does *not* re-render on a sibling navigation. So a layout that computes `active` from the URL and hands it to the bar would compute it exactly once, and every tab after the first would render with the wrong one highlighted — a persistent nav that looks broken in precisely the way a non-persistent one does not.

**So the bar is a client component and reads `usePathname()`.** That hook subscribes to the router, so it updates without the layout re-rendering. It also updates *immediately on tap*, before the new segment has finished loading, which makes the tap feel instant even while the body is still a skeleton.

Matching is **longest href wins**, not `startsWith`. `/dashboard` is a prefix of every other section, so a naive prefix test lights up Overview on every page. Longest-match needs no `exact: true` flag on one special entry, which is one less thing for a future section to get wrong.

##### Three more things

**The badge goes stale.** The unread count renders on a section *label*, so it belongs in the layout — and the layout is precisely what does not re-render on a sibling navigation. Opening Notifications marks them read and the badge would keep the old number.

The fix is `router.refresh()` from `MarkRead` after the mark, **not** `revalidatePath`. The action deliberately avoids `revalidatePath` because it would re-run the page, re-mount the component that called it, and call it again. `router.refresh()` preserves client state, so `MarkRead` is not re-mounted and its `fired` ref never re-arms — the loop is structurally impossible rather than merely unlikely.

Badges are passed as a **map keyed by section key**, so a future Profile badge is a key, not a change to the bar.

**`sw.js` does *not* deep-link to a dashboard tab.** I said it did when planning this; that was wrong. Its only `?tab=` is `/circles/<id>?tab=overview`, which is the Circle page and is unaffected. Recorded rather than quietly deleted, because the check that found it is the reason to keep doing it.

**`?tab=` keeps working anyway**, as a redirect from `/dashboard?tab=circles` to `/dashboard/circles`. That costs one line, keeps every bookmark and every existing spec valid, and leaves `?tab=nonsense` falling through to Overview exactly as before.

**`/circles/[id]` stays on `?tab=`.** It has two tabs, no shared reads worth hoisting, and no persistent-nav requirement. That is a decision, not an oversight, and `app.md` says so.

**`Notice` stays in Overview's page**, because layouts do not receive `searchParams` — and every `?notice=` redirect in the codebase targets a bare `/dashboard`, so there is nothing to spread across the other segments.

##### Verified

Typecheck, ESLint, `next build` and the e2e suite all pass. Three of those cannot run in my sandbox, so the claim rests on the run, not on inspection.

Two assertions are worth naming, because they are what makes "the bar is persistent" a fact rather than a hope:

- **The bar is the same DOM node across a click.** Asserted by tagging the element with a property and re-reading it after a client-side navigation — not by "it is still visible", which passes just as happily when the bar has been torn down and rebuilt.
- **The highlight moves.** `aria-current="page"` follows the section, which is what proves the client-side `usePathname` reading works and the layout is not being asked to do it.

`?tab=circles` and `?tab=notifications` are asserted to redirect, so nothing written before this split has been orphaned.

#### 14b. Regenerate the code graph ✅ done

`graphify-out/` was built at `e69212e`. The step 13 audit worked around it with the TypeScript compiler API, which answered the reader/writer questions but is not what the graph is for.

**The gap, measured against `manifest.json` rather than estimated.** The manifest indexes code and migrations only — 211 entries across `.ts`, `.tsx`, `.mts`, `.mjs`, `.js` and `.sql`, no docs and no assets — so that is the set the comparison uses. **26 files are wrong or absent:**

| | Count | What |
|---|---|---|
| Absent, committed | 10 | The public surface (`privacy`, `terms`, `robots`, `sitemap`, `legal-footer`, `policy-page`, `lib/legal`, `lib/site-url`, `e2e/legal.spec`) and migration 82 |
| Absent, uncommitted | 9 | All of 14a: `sections`, `tab-bar`, `layout`, `memberships`, the two new section pages, both `loading.tsx`, `components/skeleton` |
| Present but stale | 7 | `dashboard/page`, `notifications-panel`, and five specs |

**Nothing is stale in the other direction** — the manifest names no file that no longer exists — so this is purely a catch-up, not a rebuild.

**Two hygiene problems found while measuring, and neither is about staleness. Both fixed.** ✅

- **`graphify-out/.graphify_root` was committed and contains an absolute Windows path.** A machine-local pointer in a shared repository: anyone else cloning this got a path that does not exist on their disk.
- **`graphify-out/cache/` was committed**: 87 content-hashed AST files. It is a build cache keyed by file content, so every regeneration renames a slice of it and produces a large, unreadable diff.

Both are now in `.gitignore` and removed from the index with `git rm --cached`, so **the files stay on disk and the next run is still fast** — they simply stop being repository content. `.graphify_analysis.json` went with them for the same reason. `graph.json` and `manifest.json` remain tracked, because those are what another machine would actually use.

**Verification is a script, not an eyeball:** `node scripts/graph-freshness.mjs`. It reports all four categories and exits non-zero if any is non-empty, so it can gate a commit later if that is ever wanted.

Two things it does deliberately. **It learns which extensions to check from the manifest** rather than hard-coding them, so the day graphify's configuration changes it does not start reporting every `.md` file as missing. And **it detects "changed since" through `git diff`, not through the manifest's stored mtime** — a checkout, a rebase or a `git stash pop` rewrites mtimes without changing a byte, and any of those would otherwise report the entire tree as stale.

The one thing it cannot infer is that `package-lock.json` is not indexed while `package.json` is; that exception is listed in the file rather than guessed.

**The regeneration itself has to be run on the machine graphify is installed on** — it is not in the sandbox these sessions run in, which is worth knowing before planning around it. Commit first, so nothing is indexed that git does not know about, then `graphify . update`.

**Done: 237 files, all four categories empty.** The one aftermath worth recording is that **the `git rm --cached` came undone between the cleanup and the commit**, and the whole cache was staged again with zero deletions. Caught by reading `git ls-files` rather than by trusting that the earlier command had held. `.gitignore` does not protect a file that is already tracked, so the removal is the load-bearing half and the ignore rule only stops it coming back.

**Expect a CRLF warning on every regeneration.** graphify writes both files with Windows endings and `.gitattributes` normalises them to LF on the way in. Harmless, and exactly what that rule is for: without it these two files would flip endings between graphify and an editor and show as whole-file diffs.

#### 14c. Achieving a goal ✅ done

Achieving moves the check-in denominator exactly as archiving does. Adding it before the first streak existed would have meant debugging two denominator-movers at once, against a baseline that had never produced a correct number. Streaks work now.

##### The database side is already built, and that is the main finding

Reading the migrations rather than assuming: **every piece of this shipped between migrations 04 and 34, and none of it has ever had a writer.**

| Piece | Where | What it already does |
|---|---|---|
| `goals.achieved_at` | 04 | The column, with its own comment distinguishing it from `archived_at` |
| `grant update (… achieved_at …)` | 25 | `authenticated` may already write it |
| `goals_achieved_not_future` | 26 | `achieved_at <= now()` |
| `enforce_active_goal_cap` | 16 | Fires `on update of achieved_at`; achieving frees a slot |
| `recompute_daily_completion` | 34 | Excludes achieved goals from **both** numerator and denominator |
| `goals_count_achievement` | 34 | Increments `total_goals_achieved` on the null → not-null transition |

So 14c is **a server action and a button**, not a schema change. The one exception is below, and it is worth the migration.

##### `total_goals_achieved` is inflatable, and this is the moment to close it

`authenticated` holds `update (achieved_at)` with no constraint on direction, and `goals_count_achievement` fires on **every** null → not-null transition. So: achieve, set it back to null, achieve again. The counter goes up twice for one goal, through the ordinary API, with no policy violated.

Nothing reads that number yet — `/profile/[username]` is step 15 — which is exactly why it should be fixed **now**, before a stat with a public surface is computed from a column anyone can pump. A CHECK cannot express it, because the illegal thing is a *transition*, not a state. **Migration 83 is a trigger that refuses to clear `achieved_at` once set.**

Archiving deliberately does **not** get the same rule. `archived_at` feeds no counter, and un-archiving is a reasonable thing to want.

##### "Achieved but still active" is not a state, whatever migration 04 says

Migration 04's column comment reads *"a goal can be achieved and kept active"*. **Every consumer disagrees**: the partial index, the cap trigger, `recompute_daily_completion` and `can_check_in_on_goal` all treat `achieved_at is not null` as retired. Achieving *is* retirement.

That kills one third of the follow-up prompt this step was going to ship. The old note said the prompt would offer **archive, edit into a new goal, or keep it active** — and "keep it active" cannot be built without `achieved_at` meaning something different to every reader of it. Dropped, rather than built as a checkbox that quietly does nothing.

What replaces it is honest copy: **achieving stops the goal counting toward your day.** That is the fact people need before they press it, and it is the same denominator move archiving makes.

The migration comment cannot be edited after the fact, so `schema.md` carries the correction.

##### The three things to build

1. ✅ **Migration 83**, applied as `20260825034125`. Proved in a rolled-back transaction: clearing refused, moving refused, **and a negative control** — achieving a fresh goal still works and moves the counter by exactly one. Without that control a trigger that refused everything would pass. `md5(prosrc)` matches the file.
2. ✅ **`achieveGoal`**, mirroring `archiveGoal` exactly: `"now"` rather than a client timestamp, `.is("achieved_at", null)`, `.select("id")` because RLS filters silently and the affected-row count is the only evidence the write landed. That `.is()` filter is load-bearing twice — it makes a second press a no-op *and* it is why this action can never trip migration 83's trigger, since a request that would move an already-set value matches no rows.
3. ✅ **The control**, beside Archive in `GoalsPanel`, with a confirmation. The panel already rendered an "Archived and achieved" group, so the display half needed nothing.

**The confirmation is on Achieve and not on Archive**, following `RowButton`'s rule: a dialog appears only when something cannot be got back. Archiving is reversible; achieving is not. A confirmation people meet on every button is one they stop reading.

##### Tests

Three, in `e2e/goals.spec.ts`, and one helper pair that matters as much as they do.

- **Achieving from the dashboard**: the row leaves the active list, appears under "Archived and achieved", `achieved_at` is set, **`archived_at` is still null**, and the counter moves by exactly one. The archived-column assertion exists because both states retire a goal and the panel groups them together, so setting the wrong one looks identical on screen and is wrong in the counter, the export and the profile.
- **The database refuses to un-achieve**, through PostgREST as a real signed-in user. The migration proves this as the table owner, where grants do not apply and RLS is bypassed; this is the only way to know the trigger, the `update (achieved_at)` grant and the UPDATE policy agree. Asserted on `hint`, never on the message, so copy edits cannot break it.
- Moving the timestamp is refused too, and after both refusals the counter is one ahead rather than three.

**`achievedCount` / `restoreAchievedCount` are the `freeGoalSlots` pair for the counter.** `deleteE2EGoals` removes the goal but nothing walks the counter back — that is precisely what migration 83 guarantees — so without a restore in `finally` every run would inflate a real person's lifetime stat by one, permanently.

**Playwright dismisses dialogs by default.** Without `page.on("dialog", d => d.accept())` registered before the click, the confirmation is cancelled and the test asserts that nothing happened: green for the wrong reason.

##### Verified, and one real bug found on the way

The suite passes. The first run failed three tests, and the three had nothing to do with each other.

**`/robots.txt` and `/sitemap.xml` were being redirected to sign-in.** Neither was in the proxy's `PUBLIC_PREFIXES`, and its matcher excludes `sw.js`, the manifest and image extensions but not `.txt` or `.xml`. A crawler is by definition signed out, so both files — written, routed and served correctly — were unreachable by the only clients that exist for them. Fixed in `proxy.ts`.

**The legal spec passed through all of it, which is the more useful finding.** It asserted the response contained `/privacy` and `/terms` and did not contain `/join`. **A sign-in page satisfies all three**, because `legal-footer.tsx` is on it — three passing assertions against a document that was not a sitemap. `request.get` follows the redirect and reports 200, so the status check could not catch it either. Both tests now assert the **content type** before the content: a redirect can imitate the contents of a document, not its kind.

**The other two failures were transient, and my leading hypothesis about them was wrong.** Both were on `/today`, and I suspected `app/(app)/loading.tsx` from 14a — the only change that touches that screen, and the first Suspense boundary the app has ever had. It was not that: the file is untouched and both tests pass. The evidence pointed elsewhere all along and I under-weighted it. One trace showed the account sitting on `/onboarding` with no username, which is a fixture state only `gates.spec` creates; the other showed a check-in button stuck on its pending label. Both are shared-real-account effects, which this suite has been bitten by before. **Worth watching rather than worth chasing**, since neither reproduced.


#### 14d. Goal deadlines ✅ done

`<input type="date">` is native everywhere and needs no library, so the earlier "that's design work" objection was wrong.

##### The column was the obstacle, and it was free to fix

`goals.deadline` was `timestamptz`, and a date input submits `YYYY-MM-DD`, which stores as midnight **UTC**. Someone in `America/Los_Angeles` picks 1 September and reads back 31 August — and it looks like a bug in the picker rather than in the schema.

**Not fixable in the reader.** Every consumer would have to agree on which timezone to un-apply, and any one of them getting it wrong is a date off by one. A goal deadline is a **calendar date, not an instant**; `date` has no timezone semantics, so the error class stops existing.

**Migration 84**, applied as `20260825054058`. Confirmed at the database first: 16 goals, **zero** with a deadline, one SQL reader (`export_user_data`). That mattered — `timestamptz -> date` casts in the session timezone, so with data this would have been a silent decision about whose midnight counts, taken by whichever connection ran the migration. The migration **refuses to run** if a non-null value ever appears, rather than trusting the note above.

Proved rolled back on three claims: the type changed, `authenticated` still holds insert and update on the column (an `alter column ... type` rewrites it, and a lost grant would surface later as a bare `42501` from a form that looks correct), and `2026-09-01` written through the column reads back as `2026-09-01`.

`export_user_data` gets better rather than breaking: the exported value becomes `2026-09-01` instead of `2026-09-01T00:00:00+00:00`, which is what the person chose.

##### What was built

- **Inline on the goal row**, so set, change and remove are one control. Clearing the field removes the deadline; there is no separate button.
- **An explicit Save**, matching every other control in the panel. A date input fires `change` while you are still picking on some platforms, so an auto-submitting field would write intermediate dates and revalidate the page under the picker.
- **Overdue means strictly before today**, matching the rule `/circles/[id]` already states for a Circle's deadline: the deadline day itself is fully playable. Two deadline concepts in one app disagreeing about the last day would be worse than either answer.
- `lib/goal-deadline.ts` holds `isOverdue` and `deadlineLabel` as pure, UTC-pinned functions, unit-tested in the runner pinned to `America/Los_Angeles`.

**"Today" is the check-in date, passed down from the server.** Not `Date.now()` in the component: "is this overdue" and "does today count" have to be the same day, or they disagree for two hours either side of the 2 AM boundary.

**The design notes held.** No default — the column is nullable on purpose, most daily goals have no end date, and defaulting turns an opt-in field into an opt-out one that makes every new goal look overdue tomorrow. And no `min` attribute, because recording a missed or historical deadline is legitimate; a past date renders as overdue, which is a fact about it rather than a complaint.

##### Tests

Unit tests cover the boundary cases that a UTC runner cannot fail: the deadline day is not overdue, month and year boundaries, and a missing `today` producing a date with no claim about it. **Month names are asserted with `toContain`**, following `digest-days.test.ts` — `month: "short"` is ICU data and this runtime renders September as "Sept" where another renders "Sep", so a pinned abbreviation would fail on a version bump and say nothing about the code.

The e2e test sets, changes and clears through the screen. **Its load-bearing assertion is the stored value, not the label**: the owner's timezone is west of UTC, so under the old column the date would be consistently wrong in both the database and the screen, and a UI-only assertion would agree with itself.

---

#### 14e. Delete your account ✅ done

**Everything behind this already existed.** `delete-account` is deployed with `verify_jwt` on: it identifies the caller from their own token, scrubs note text, collects and deletes Storage objects, then deletes the auth user and lets the cascade do the rest. `security.md` section 11 documents the ordering and why it is load-bearing. What was missing was a button.

**The rule this step turned out to be about.** `settings/page.tsx` carries a standing rule that it holds only controls whose backend exists, written after 8h spent two migrations removing a table that had policies, grants, two enforcing consumers and no writer. **This was that same failure from the other end**: a complete, deployed, correct backend that nothing could call. Same drift, opposite direction, and only one of the two had a rule watching for it.

##### What was built

| | |
|---|---|
| **The confirmation** | Typing your username. `ArchivePanel` had already drawn this line and said why: *"that ceremony suits deleting an account"*, and archiving destroys no history. This does |
| **Checked twice** | The panel disables the submit until it matches; the action re-checks against the username **read from the database**, never from a hidden field, or the form would be confirming itself. The client check is a courtesy, the server one is the control |
| **Saying what survives** | Photos, notes, goals and the account go; **check-ins stay, anonymised**, because deleting them would rewrite other members' streaks. Someone who learns that afterwards has been misled by omission, so it is in the panel, in the notice, and on `/privacy` |
| **Ownership** | Warned, and **named**. "You own 2 Circles" makes someone go and look; naming them answers it in place. Succession stays automatic, and a Circle with nobody left is archived — `handle_membership_removal`, unchanged |
| **After** | `redirect("/?notice=account-deleted")`. `/` is outside `(app)` and is the only route left that can render anything. Landing on sign-in with no explanation reads as being logged out rather than as having succeeded |
| **Sign-out failure is swallowed** | The account is already gone, so the refresh token belongs to a user that no longer exists and Supabase may answer with an error. Reporting it would tell someone their deletion failed *after* it succeeded, which is the worst wrong answer available here |

**The coupling was honoured.** `/privacy` said to email for deletion, because that was true. That sentence is a link now, in the same change. The email route is kept as an alternative rather than removed, since some people would rather write.

**No migration.** Nothing here touches the schema.

##### The test deliberately does not cover the most important check

`e2e/delete-account.spec.ts` covers the gate a person meets: closed by default, submit disabled until the typed name matches exactly, a prefix and a superset both refused, cancel clearing the field so the next open cannot start with a match already typed. It ends by asserting the account still exists.

**It never submits.** The suite runs against two real accounts, and `E2E_OWNER_EMAIL` owns the storage state every other spec depends on — a successful deletion would end the run, and nothing in this repository could undo it. Covering the server-side check means POSTing a deliberately wrong username, which is safe if the check works and destructive if it does not. **A test whose failure mode is "the thing it was testing already happened" is not a test.** Written down here rather than left as a gap for someone to find.

The honest fix, if this ever needs real coverage, is a disposable account created and destroyed by the spec. That is a change to `auth.setup.ts` and the account model, not to this file.


---

## Step 15: profiles, and the moderation surface they carry ✅ done

**Named, not planned.** `/profile/[username]` is where four things that already exist in the schema get their first caller:

| | |
|---|---|
| `user_lifetime_stats.visible_on_profile` | A column with no reader |
| `user_blocks` | A table with no writer |
| `content_reports`, and the `report` rate limit | **The last limit in `lib/ratelimit.ts` with no caller.** As built, reporting is a thing you do to *content*, not to a person — see below, the old note here had that backwards |
| `total_goals_achieved` | Written since migration 34, made un-inflatable by migration 83 in step 14c, and still read by nothing. This is the screen that reads it |

That third row is why this is step 15 rather than a loose end: the limit is not missing a caller by oversight, it is waiting for the screen it belongs to.

**The rule step 14e ended on applies here first.** `settings/page.tsx` refuses controls whose backend does not exist; `delete-account` was the mirror image, a finished backend nothing could call. **This step is four of those at once.** Whatever else it does, it should close them rather than add a fifth.

#### What was decided

| Question | Answer |
|---|---|
| Who can see a profile | **Any signed-in user.** Not just Circle-mates, and not the public web |
| How that is done | **A masked `SECURITY DEFINER` RPC**, not a widened RLS policy |
| What the toggle controls | The four lifetime stats. Identity is always visible to a signed-in viewer |
| What blocking does | **Mutual profile invisibility**, and nothing else |
| Where reporting lives | **Both**: photos and notes on the roster, and the profile itself, via a new report type |
| Who can report | **Circle-mates only**, on every surface |
| What is on the page | Username, display name, member since, and the four stats |

#### The pieces, and what each one turned on

| | Piece | Migration | The decision worth remembering |
|---|---|---|---|
| 15a | `profile_by_username` | 86 | **A masked RPC, not a widened policy.** RLS filters *rows*: relaxing `users_select_self_or_groupmate` would have exposed `checkin_timezone` and two preference columns along with the three profile ones. The function returns `created_at`, which `authenticated` cannot select at all — that is the point of it choosing. Same pattern as `circle_roster` |
| 15b | `/profile`, `/profile/[username]` | — | **Profile is the fourth tab, and that restructured the shell.** `dashboard/` and `profile/` now sit under `app/(app)/(shell)/`; a route group adds nothing to the URL, so all four tabs share one never-unmounted bar. `/today`, `/settings` and `/circles/[id]` stay outside it — `/today` is a full-screen gate a nav bar would undermine |
| 15c | The stats toggle | — | **The narrowest write in the app.** `authenticated` holds `update (visible_on_profile)` and nothing else on that table, because the counters are trigger-maintained. So no RPC: the policy and the column grant already say it |
| 15d | Block, unblock | 87 | **Blocking hides the thing it is undone from.** A blocked profile 404s, so Unblock lives in settings — and needs an RPC, because `users_select_self_or_groupmate` will not return a blocked account's username once you share no Circle |
| 15e | Reporting | 88 | **Reporting is about content, not people** — that is what the enum always said, and the old note in this file had it backwards. `user_profile` was added so a profile can be reported too |
| 15f | Avatars | 85 | **The `avatars` bucket was set to `image/webp`**: migration 82's trap, armed, one bucket over. And `avatar_url` held Google URLs that our own CSP blocks and nobody chose to publish |

#### The rules these landed on

**Stats are opt-in; identity is not.** Username, display name, picture and join month are visible to any signed-in user. The toggle governs four numbers, and the copy says so — "hidden" read as "invisible" would be misleading by omission.

**Absent is not zero.** With the toggle off the RPC returns nulls and `stats_visible: false`, and the page says "hasn't shared their stats". Four zeroes would be true of a new account and false of someone withholding.

**You always see your own stats**, whatever the toggle says. Mirrors `user_lifetime_stats_select_visible`'s first clause.

**A blocked profile and a nonexistent one are the same 404.** Anything distinguishable turns "did they block me" into something anyone can probe.

**Blocking is mutual, and `private.is_blocked_by` only answers one direction.** The RPC tests both. Blocking does not remove either of you from a shared Circle — hiding a member from the roster would make the member count and group streak disagree between two people looking at the same Circle.

**Block needs no shared Circle; Report does.** Blocking is how you stop seeing someone. Reporting is a complaint a moderator must be able to act on, and `content_reports_insert_own` keeps that rule.

**A check-in report points at `<user_id>/<goal_id>/<check_in_date>`.** The roster returns `entry_id` for your own rows only, and a photo's signed URL dies in an hour, so neither is a reference a report can keep. `lib/report-reference.ts` owns the format and the resolving query.

**Avatars are one fixed key, `<uid>/avatar.jpg`, overwritten in place.** A timestamped key would orphan the previous image on every change and need the sweep job migration 81 exists for on the other bucket.

#### Two traps, written down because they will recur

**A new enum value must land in its own migration.** Postgres allows `add value` inside a transaction and then refuses `unsafe use of new value` the moment anything references it. Migrations apply transactionally, so migration 88 adds the value and stops — no proof block, for exactly that reason.

**Safari cannot encode WebP**, and `canvas.toBlob` falls back to PNG silently while supabase-js sends `blob.type` rather than the `contentType` option. Three facts, none wrong alone. It cost three device bugs in step 13 and was sitting in the avatars bucket ready to cost them again.

#### The security and resilience audit, before commit

**One real privacy defect, and it lived in a seam rather than in a file.**

`job_scrub_and_list_user_media` listed the avatar to delete only `where avatar_url is not null`. **"Remove picture" clears the column and deliberately keeps the object** — one fixed key, overwritten in place, nothing orphaned by a replacement. Each decision is defensible alone. Together: remove your picture, then delete your account, and **a photograph of your face outlives the account**.

**Migration 89** derives the key from the user id instead of reading the column. A deletion path must not ask permission of the state it is deleting. `md5(prosrc)` matches the file.

**Two smaller holes in `reportContent`, both from trusting a form:**

- **`content_type` was cast, not checked.** `contentType as ReportType` on a raw string is a lie to the type system; an unrecognised value reached Postgres and came back as `22P02`, which `toMessage` renders as "Something went wrong." Now narrowed against a literal list, which also means **`planet_avatar` cannot be filed** — it is in the enum for a feature that does not exist.
- **`content_reference` has no length CHECK** and is client-supplied `not null` text, so a report could have carried a megabyte of anything. Both valid shapes are exact, so it is validated by comparison rather than by a cap: a profile report must name the account it is about, and a check-in report must parse back through `lib/report-reference.ts`.

**Avatar uploads were unmetered.** `setAvatar` now enforces `photoUpload`, the same limit `attachCheckinPhoto` uses — an avatar and a check-in photo are the same act against the same budget. **It bounds recorded writes, not bytes**: the browser uploads directly to Storage, so the real bounds are the bucket's 2MB cap and `avatars_insert` confining a writer to their own folder. Clearing is not metered; it writes a null.

**What the audit cleared:** every `SECURITY DEFINER` function pins `search_path`, and **`circle_preview` is the only one `anon` can execute**, which is deliberate — `/join/[token]` serves signed-out visitors. `img-src` already covers the Supabase origin, so signed avatar URLs render without a CSP change. No secrets reachable from a client bundle.

#### The audit of 14 and 15

Run as checks rather than as reading.

**Clean:** 0 syntax errors across 17 changed files; no `.rpc()` outside `app/actions/`; no `createAdminClient` in anything bundled; no `new Date("YYYY-MM-DD")` anywhere; no `import.meta` in any spec; no `server-only` module reaching a client bundle (four apparent hits were three comments and one erased `import type`). **Every rate limit now has a caller** — `report` and `deleteAccount` were the last two.

**Two real defects, both fixed:**

1. **Blocking left you on a page you had just made invisible.** The block happens on `/profile/[username]`, which needs the **route pattern** — `revalidatePath("/profile/[username]", "page")`. Passing the resolved URL silently revalidates nothing.
2. **A refused report said "You don't have access to that."** A policy refusal is a bare `42501` with no hint, and this policy refuses for one reason a person can act on.

**One gap closed by the audit:** `lib/report-reference.ts` had no unit test. It has one now, including `//2026-08-25` — three segments, two empty uuids, which a length check alone would accept.

#### Still open in step 15

- **`content_reports` has a writer and no reader.** A moderation console is deferred to v2; the gap is closed by *documenting the process*, and **the step is not done until `security.md` says how a report reaches a human**.
- **`/privacy` should say a username and display name are visible to any signed-in user.** Enumeration is now possible by design.
- **No device run for avatars.** See the manual pass at the top.

---

## Step 17: the admin dashboard ✅ done

Pulled out of v2. `content_reports` had a writer and no reader, and the plan's answer was "document a manual query" — which is a promise to be diligent rather than a feature.

#### Decided

| Question | Answer |
|---|---|
| Who is an admin | A `role` column on `users`, `standard` or `admin`. **Not readable or writable by any client** |
| What an admin sees | **The reported item and nothing else**, through one RPC. Not full read access |
| What an admin does | **Triage only**: reviewed, actioned, dismissed. No content removal, no suspensions |
| How admins are made | SQL for the first; after that an admin-only, audited UI |

#### The database layer ✅ done — migrations 91, 92, 93

**`user_role`, not `group_member_role`.** There is already an `admin` in this schema and it means *admin of one Circle*. Two unrelated powers with one name would make the audit log unreadable, so the audit values are `site_admin_granted` / `site_admin_revoked`.

**The column is in no grant at all.** `authenticated` cannot read or write `users.role` through PostgREST — not their own, not anyone's. Every admin path is a `SECURITY DEFINER` function calling `private.is_admin()` as its **first statement**, so there is one door and one place to read to know what an admin can reach. **No admin policies were added**, deliberately: a policy would be a second place the rule lives.

**The escalation is scoped to a row, not to a role.** `admin_report_detail` returns the note or photo *that was reported* and nothing else — an admin cannot browse someone's goals, their other days, or anything nobody complained about. Photo keys leave the database and the server signs them with the service key, because widening `checkin_photos_select` for admins would be a permanent escalation where this is a per-report one.

**Three guards on `admin_set_role`**, each for a specific failure: the caller must already be an admin; **you cannot change your own role**, which is how a single admin locks everyone out; and **the last admin cannot be revoked**, counted `for update` at the moment of the write, because two admins demoting each other concurrently would each see one other admin and leave none.

**A proof caught a real thing before it shipped.** Migration 91 asserts `authenticated` holds nothing on `users.role` — and failed, because `authenticated` holds `REFERENCES` on every column of `users` from a table-level grant. REFERENCES permits creating a foreign key and permits neither reading nor writing, so the assertion was refusing the wrong thing; it now names SELECT, INSERT and UPDATE.

#### The screens ✅ done — migration 94

`/admin` (queue, filtered by status), `/admin/reports/[id]` (the report, its content, triage) and `/admin/people` (the admin list and the role form). Error copy added.

**`notFound()`, not a redirect and not a 403.** A 403 confirms the route exists and has something worth being refused from; a 404 says only what a wrong URL says. The database refuses independently, so the gate is a courtesy and the RPCs are the control.

**Outside `(shell)`.** The four-tab bar is the product; this is the back office, and Overview across the top of a moderation queue invites doing one while distracted by the other. `(app)/layout.tsx` still applies, so the header says which account you are moderating as.

**Migration 94 exists because the app could not ask the question.** `private.is_admin()` is revoked from `authenticated` and `private` is not exposed, so `am_i_admin()` is the one read that gates the route — no argument, so it cannot be asked about anyone else. `admin_list_admins()` is there because a privilege whose holders you cannot enumerate is not reviewable.

**Granting is confirmed; revoking is not.** Granting hands somebody the ability to read other people's reported content and cannot be undone once they have looked. A confirmation on the safe direction is how people learn to click through the unsafe one.

**The signed photo URL for a reported image is minted with the service key**, the only place in the app that does so for someone else's object. `checkin_photos_select` will not sign a stranger's photo for an admin and should not — widening it would be standing access to every photo in the product, where this is one key from one report somebody else raised.

**Still to do: the first admin, by SQL.**

```sql
update public.users set role = 'admin' where username = 'ryahn2';
```

#### Tests, and the bug they found — migration 95

`e2e/admin.spec.ts` asserts the gate **at the database and not only at the page**: a standard user calling each of the five admin RPCs directly is refused with `42501`, and the report they tried to resolve is still `pending` afterwards. The 404s are asserted too, but as the courtesy they are.

**Writing the third test found a real defect in migration 93**, and it is the sharpest kind — a rule that could not fire and a rule that fired wrongly, in the same guard.

93 forbade changing your own role *and* refused to revoke the last admin. Those cannot both matter: to reach the last-admin check the caller must be an admin and the target a **different** admin, which means there are two. **The self-guard made the last-admin rule unreachable.** 93's own proof passed only because its final call was a self-demotion — refused by the self-guard, which raises the same SQLSTATE. An assertion that could not fail, of exactly the shape `patterns.md` warns about, written by the same hand that wrote the warning.

And the branch that *was* reachable was wrong: the admin count ran on **every** demotion without checking whether the target held the role. With one admin — a fresh install — revoking anybody at all, including someone who was never an admin, failed with "That is the last administrator". Not an edge case: the common one.

**Migration 95** allows self-demotion, which is what makes the last-admin rule reachable and therefore real, and scopes the count to targets who actually hold the role. `ROLE_SELF_CHANGE` is deleted rather than renamed. Every branch is now asserted **by hint**, because all three refusals share a SQLSTATE and "it was refused" is precisely what hid the first bug.

#### The legal pages, brought up to date

**`/privacy` said "there is no way to browse other users", which stopped being true in 15b.** That was the sharpest correction: profiles are now visible to anyone signed in, and usernames are enumerable by design. It now says so plainly, separates the three tiers (public to nobody, profile to any signed-in user, everything else to your Circles), and states that streaks and totals are **off by default**.

New in both: pictures, blocking, reporting, and a section on **what a moderator can see** — the reported item and nothing else, with the scale named rather than implied, since "an administrator" in a one-person product means one person. `/terms` gains reporting and blocking, and its deletion paragraph now points at settings rather than at an email. Both versions bumped, which is what dates the change in the footer.

---

---

## Step 16: the goal record ✅ done

From the manual pass. The "Archived and achieved" `<details>` on Overview lists a title and a word. It should be a place you go back to.

#### What the data already supports, and what it does not

`progress_entries` keeps every check-in forever — date, note, `note_shared`, `photo_url` — and `goals` keeps `created_at`, `deadline`, `achieved_at`, `archived_at`. **The record is a read.** No new columns.

**Three things it cannot show, and the page has to be honest about each:**

| | |
|---|---|
| **Photos older than 90 days are gone** | Retention deletes the object and nulls the column. A day with a note and no image is the ordinary case for an old goal, and it must read as *"the photo was deleted after 90 days"* rather than as a broken thumbnail |
| **Deleting a goal is not possible, but archiving keeps the entries** | `progress_entries.goal_id` is `ON DELETE SET NULL`, so a record page keyed on `goal_id` shows nothing for entries whose goal was removed. Nothing removes goals today except the suite |
| **Missed days are not stored** | Only check-ins exist. A calendar of hits and misses can be *derived* from `created_at` to `archived_at`, and that is a different feature — see below |

#### Decided

**A fifth tab.** `/dashboard/goals` joins Overview, Circles, Notifications and Profile in `sections.ts` — one entry and one folder, which is what that file was built for.

**The extensive controls live there, not on Overview.** Creating a goal, setting a deadline, achieving, archiving and per-Circle visibility all move to `/dashboard/goals`. Overview keeps a compact list of active goals and a **View all goals** link, so it is about today rather than about management.

**The archived list is a page, not a preview.** Overview's "Archived and achieved (N)" `<details>` becomes a link to `/dashboard/goals/archived`. An expandable list of retired goals on the screen you check in from is clutter on the way to somewhere else.

**Days completed, not days missed.** The record lists what happened, not a wall of gaps on a goal somebody abandoned. Deriving misses is possible and is a separate decision.

**Photos are signed in batches**, as the roster does. A goal with 200 check-ins must not become 200 signing round trips.

**Paginated from the start.** A daily goal kept for a year is 365 rows. The roster gets away with no paging because a Circle holds ten people; this has no such bound.

#### No migration

`goals_select_own` and `progress_entries_select_own` are both `user_id = auth.uid()`. **The whole feature is a read of your own data**, so there is no RPC, no policy and no grant to add — the first step in a while that touches no SQL.

#### The routes

| | |
|---|---|
| `/dashboard/goals` | Active goals with the full controls, and a link to the archive |
| `/dashboard/goals/archived` | Retired goals: achieved or archived, with when each started and ended |
| `/dashboard/goals/[id]` | One goal's record: a row per check-in date, with that day's note and photo |

**`/dashboard/goals/archived` and `/dashboard/goals/[id]` are siblings**, and a static segment wins over a dynamic one in Next, so `archived` resolves to the page rather than to a goal. Goal ids are uuids, so nothing can collide with the literal — but it is worth knowing that the rule is ordering rather than luck.

**Under `/dashboard`, not at the root.** Profile is the only section that sits outside it; `sections.ts` holds absolute hrefs and does not care where the files live, so this was a folder move and one string.

#### Built

**Goals is the one section that is *not* `exact`.** `/dashboard/goals/archived` and `/dashboard/goals/[id]` are still your goals, so the tab stays lit — where `/profile/[username]` is somebody else's page and must not light your Profile tab. The flag turns on whose thing you are looking at, not on the shape of the URL, and `sections.test.ts` now pins both cases.

**Overview keeps the `Your goals` landmark**, now a read-only summary: the live list, and only *overdue* deadlines called out, because a deadline three weeks away is not news on the screen you check in from. Every control moved, so `goals.spec.ts` navigates to `/dashboard/goals` — a locator that still found the region on `/dashboard` would have passed while pressing nothing.

**The record pages 60 days at a time**, newest first, with `page` clamped rather than trusted: `Number.parseInt` on nonsense is `NaN`, which becomes a negative `range` and an empty page that reads as a goal with no history.

**Retention is stated once, at the foot of the list**, not on every dateless row. Somebody scrolling a two-year-old goal should understand why the early days have no pictures without working it out.

**The counts are one grouped read, not one per goal.** Active goals stop at ten; retired ones have no cap, so a count per goal is unbounded round trips.

---

---

## Step 18: inviting a person, not a link ✅ done

**Built, typechecking and linting clean; the e2e specs have not been run yet.** Five migrations, all proved rolled back with negative controls, all files written under the versions the server recorded, all three function bodies verified by `md5(prosrc)`.

**One bug found and fixed inside the step.** Migration 99's `circle_preview_members` resolved the token to a group id and then never filtered by it: it returned the first ten rows of `group_members` across **every Circle in the database** to anybody holding any live invite link. Migration 100 adds the `where`. It is in `patterns.md` under "a definer function that resolves an id and never filters by it", and `invite-user.spec.ts` compares the returned count against the Circle's own so it cannot come back.


**The gap.** Every invite today is a URL you have to carry somewhere else: generate it in Circle settings, then find the person in a messaging app and paste it. Solarity knows who its users are and cannot introduce two of them. The whole product is people you already know, and the one flow that adds a person leaves the product to do it.

**The shape.** Search a username, pick the person, they get a notification, tapping it lands them on the invite page they would have reached from a pasted link, which now also shows who is already inside.

Four decisions taken before writing any of it, each with a cost:

| Decision | Chosen | The cost accepted |
|---|---|---|
| How search matches | **Prefix, three characters minimum** | This is a directory. Anyone signed in can walk the user table by typing letters, which the app has never allowed before: `/profile/<username>` needs the whole handle. Metered, capped, and `%`/`_` escaped, but the enumeration surface is real and is the price of the feature being usable |
| What the notification carries | **The invite link itself** | No new table, and the entire join flow is reused unchanged. The token is a bearer credential sitting in a `notifications` payload: readable only by its recipient under RLS, and still valid for anyone it is forwarded to. A `circle_invites` row with Accept and Decline was the alternative, and it is the v2 shape if invites ever need revoking |
| Who may invite | **Any member** | Matches the link, which any member can already generate and pass around. A tighter rule here would be a guard with an open door beside it |
| Who the invitee sees | **Usernames and pictures** | The roster is exposed to whoever holds the token, which is already true of the Circle's name and member count. It is also the question an invitee actually has: do I know these people |

### 18a. Finding somebody — migration 96, `search_users`

`SECURITY DEFINER`, `set search_path = ''`, revoked from `public` and `anon`, granted to `authenticated`. Returns id, username, avatar key, capped at **10 rows**.

- **Refuses under three characters.** Not a UI nicety: one character returns a slice of the whole table, so the floor belongs where the rows are.
- **`%`, `_` and `\` are escaped** before the `like`. Without it, typing `%` is a request for every user in the system, which is the whole enumeration hole arriving through the front door.
- **Case-insensitive**, reusing the existing `lower(username)` index rather than adding one.
- **Excludes**: yourself, anyone blocked in either direction, and anyone already in the Circle being invited to. The last is what stops the results being a list of people the button will refuse.
- Metered at the action, per user, alongside the existing limits in `lib/ratelimit.ts`.

### 18b. The invite — migration 97 (enum), migration 98 (`invite_user_to_circle`)

**`invited` is a new `notification_type` value, and it gets its own migration.** An enum value added inside a transaction cannot be used in that transaction, which is why 88 exists as its own file; this is the same rule, not a preference.

`invite_user_to_circle(p_group_id uuid, p_user_id uuid)`, `SECURITY DEFINER`, refusing with named hints so `lib/errors.ts` has copy for each:

| Refusal | Hint |
|---|---|
| You are not in that Circle | `NOT_A_MEMBER` |
| The Circle is locked or archived | `CIRCLE_INACTIVE` |
| Ten people already | `CIRCLE_FULL` |
| They are already in it | `ALREADY_MEMBER` |
| Either of you has blocked the other | `NOT_FOUND`, deliberately indistinguishable from a username that does not exist |
| No live invite link on the Circle | `INVITE_LINK_MISSING` |

**It reads the Circle's current link rather than minting one.** `create_invite_link` disables every existing link before inserting, so a direct invite that quietly generated one would revoke the link members are already sharing. If there is no live link, the panel says so and offers the existing generate button.

**One unread invite per person per Circle.** A second call while the first is unread is a no-op returning success, because the alternative is a button that spams somebody's notification list.

### 18c. Who is already in it — migration 99, `circle_preview_members`

A companion to `circle_preview`, not an extension of it: changing that function's return type means dropping and recreating something granted to `anon`, and the two answer different questions.

- Returns username, avatar key and role, ordered owner first then by join date.
- **Zero rows unless the link is live.** A revoked or expired token stops showing the roster in the same breath it stops working, so this cannot become a way to watch a Circle you were removed from.
- Granted to `anon` as well as `authenticated`, because the join page serves signed-out visitors and asking someone to make an account before telling them what they are joining is the wrong order.
- **Pictures only for signed-in visitors.** `avatars_select` is `bucket_id = 'avatars'` for authenticated readers, so a signed-out visitor cannot sign a URL. `components/avatar.tsx` already falls back to an initial, so this costs nothing and keeps signing as the caller rather than reaching for the service key.

### 18d. The surfaces

- **`/circles/[id]/settings`** gains a search box above the existing link panel: type, see up to ten matches with their pictures, press Invite. Results are a list of buttons, one action each.
- **The Notifications tab** renders `invited`, and `TAB_NOTIFICATION_TYPES` gains it so the badge, the list and mark-read keep agreeing. That constant exists precisely so this is one edit and not three.
- **`/join/[token]`** gains an "Already here" section under the count, and names the Circle's **owner** above the title. Not the inviter: a token is shared, and nothing in it records who sent it to *you*. `invite_links.created_by` is who made the link, which is a different person the moment one member generates a link and another forwards it. Who invited you specifically is in the notification that brought you here, where it is a fact rather than a guess.
- **The push teaser names the inviter**, under `push_shows_circle_name` like the Circle's name. It shipped naming nobody and that was wrong: see `notification-copy.md` row 8b.

### 18f. Copy variance ✅ **the three digest bodies are live; step 19's types land with step 19**

**The staleness problem.** A digest arrives every day, forever, and says the same sentence every time. The Circle name made four Circles distinguishable from each other; nothing makes today distinguishable from yesterday. Two hundred identical notifications is a notification people stop reading.

**Every string a person can receive**, which is the complete list and the thing to choose from. `{circle}`, `{who}`, `{done}`, `{total}` and `{streak}` are the only placeholders any of them can fill, because they are the only values in the payloads.

| # | Type | Condition | Today | Vary? |
|---|---|---|---|---|
| 1 | `digest` | nobody finished | `{circle}`: nobody checked in yesterday | **yes**, daily |
| 2 | `digest` | everyone finished | `{circle}`: everyone checked in yesterday | **yes**, daily |
| 3 | `digest` | some finished | `{circle}`: `{done}` of `{total}` checked in yesterday | **yes**, daily |
| 4 | `deadline_changed` | cleared | `{circle}` is now open-ended | no, rare |
| 5 | `deadline_changed` | otherwise | `{circle}` changed its deadline | no, rare |
| 6 | `kicked` | | There's an update about one of your circles | **never** |
| 7 | `group_locked_renewal` | | `{circle}` has finished its cycle — tap to decide what's next | no, rare |
| 8 | `invite_accepted` | | Someone joined your circle, `{circle}` | no, rare |
| 8b | `invited` | | `{who}` invited you to `{circle}` | no, rare |
| 9 | unknown type | | You have a new notification | **never** |
| 10–16 | in-app lines | | see `notification-copy.md` | no: durable copy, read once |
| 17–20 | step 19's four | | not built | **yes**, 17 and 20 repeat |

**Vary what repeats, and only that.** A message you see daily goes stale; one you see twice a year does not, and rewording it three ways only makes the product's voice inconsistent for no gain. That splits the list cleanly: the three digest bodies, plus `circle_activity` and `circle_first_finisher` from step 19.

**Two that must never vary.** Row 6 is deliberately vague because being removed from a Circle may be read by the person who removed you, and a set of playful alternatives is exactly the wrong instinct there. Row 9 is the fallback for a type whose copy has not landed; it should stay dull, because it is the branch most likely to meet something unfamiliar.

**One caution about tone.** Row 1 is the "nobody managed it" message, and it is the one a variance set can quietly turn into a voice that punishes people for a bad day. Forward-looking or neutral; never disappointed.

**`{streak}` is available and unused.** `group_streak` has been in the digest payload since step 11 and no push has ever read it. A variant that says how long the run is gives the copy somewhere to go that is not just rephrasing.

#### Chosen: seeded by notification id

**`teaser()` gains the row's id and picks by hashing it.** The sender already selects `id` alongside `type` and `payload`, so nothing new is read.

This is the choice that keeps the copy testable. `lib/teaser.test.ts` asserts exact strings, and a genuinely random pick would make every one of those assertions flaky; a date rotation would make four Circles read identically again on any given day, which is the problem this file was opened for. Hashing the id gives **one stable answer per notification** — a redelivery says what the first attempt said, a re-render never flickers — while reading as random across days, because the ids are.

A small non-cryptographic hash, in `teaser.ts`, with no imports: this file is unit-tested precisely because it depends on nothing.

#### Chosen: the three digest sets

Written `{circle}` first wherever it fits, so the Circle stays the scannable part.

| Row | Variants |
|---|---|
| 2, everyone finished | `{circle}`: everyone checked in yesterday · Clean sweep in `{circle}` yesterday · All of `{circle}` finished yesterday · `{circle}` went `{total}` for `{total}` yesterday · `{circle}`: everyone finished, `{streak}` days running |
| 1, nobody finished | `{circle}`: nobody checked in yesterday · A quiet day in `{circle}` · `{circle}` had a quiet one · Nothing logged in `{circle}` yesterday |
| 3, some finished | `{circle}`: `{done}` of `{total}` checked in yesterday · `{done}` of `{total}` finished in `{circle}` · `{circle}` came in at `{done}` of `{total}` · `{done}` of `{total}` made it in `{circle}` |

**The streak variant needs a guard.** `{streak}` is 0 on a Circle's first perfect day and on any day after a reset, and "everyone finished, 0 days running" is worse than the sentence it replaced. It is skipped when the streak is under two, which also makes it the one variant whose availability depends on the payload rather than on the seed.

**Row 1 stays neutral by decision, not by accident.** Four ways of saying a day was quiet, none of them disappointed. The set has no variant that implies anybody let anybody down, because this is the message most likely to arrive three days running.

#### Chosen: step 19's three repeating types

| Type | Variants |
|---|---|
| `circle_activity`, one name | `{who}` got started in `{circle}` · `{who}` is off the mark in `{circle}` · `{who}` has begun in `{circle}` |
| `circle_activity`, two | `{who}` and `{who}` got started in `{circle}` (same three verbs) |
| `circle_activity`, three or more | `{who}` and `{n}` others got started in `{circle}` (same three verbs) |
| `circle_first_finisher` | `{who}` is first to finish in `{circle}` · `{who}` is out of the gate first in `{circle}` · `{who}` got there first in `{circle}` · First one done in `{circle}`: `{who}` |
| `last_one_left` | You're the last one in `{circle}` · `{circle}` is waiting on you · Everyone else is done in `{circle}` · Just you left in `{circle}` |

**The verb varies and the shape does not**, for `circle_activity`. It is the only message with three grammatical forms, and letting the sentence structure move as well as the wording would give three ways to be wrong about plurals instead of one.

**`circle_first_finisher` names an achievement, never a comparison.** The competitive framing ("`{who}` beat you to it") was on the table and is not what a Circle of friends is for: it addresses the recipient as losing on a day they may simply not have got to yet.

**`last_one_left` states the fact and stops.** No "still time" tail. The fact is the motivation, and a tail turns a friend's nudge into an app's.

#### Chosen: the name-withheld fallbacks vary too

Someone who turned lock-screen detail off still gets a notification every day, and theirs are the ones that read most identically, because the Circle name is the thing that distinguishes them. Same seed, same conditions, names removed.

| Condition | Variants |
|---|---|
| Nobody finished | Nobody checked in yesterday · A quiet day · Nothing logged yesterday · A quiet one yesterday |
| Everyone finished | Everyone checked in yesterday · A clean sweep yesterday · Everyone finished yesterday · `{total}` for `{total}` yesterday |
| Some finished | `{done}` of `{total}` checked in yesterday · `{done}` of `{total}` finished yesterday · `{done}` of `{total}` made it yesterday · Came in at `{done}` of `{total}` yesterday |
| Activity | Someone got started · A few people got started · Somebody is under way |
| First finisher | Someone finished first · Somebody is done already |
| Last one left | A circle is waiting on you · You're the last one in a circle · Everyone else is done in a circle |

**Counts stay, names go.** `{done}`, `{total}` and `{streak}` are numbers, not identifiers, and the current fallback already prints them; `{who}` is a handle and is withheld with the Circle name, the rule settled for `invited` in 18b.

**`{n}` counts people whose names are being withheld, and that is a deliberate yes.** "and 3 others got started" tells the recipient how many people moved without naming them, on a lock screen where they asked for no names. It is safe because everybody counted is in a Circle the recipient is already in: the number reveals nothing they could not learn by opening the app, and the whole point of the coalesced message is that it is a count rather than three separate buzzes.

**The nameless variants keep "tap to see" where they had it.** Without a name there is no reason to open the app, which is the job that tail was doing before the names arrived. It stays on the variants that would otherwise be a bare statement.

#### Not varied, and why

`goal_achieved` is rare by construction, so it keeps one line: `{who}` achieved a goal in `{circle}`. **Never the goal's title** — masking is per Circle and a lock screen is outside every check the app has.

The in-app lines, rows 10 to 16, all stay fixed. They are the durable copy, read once, in a list where two phrasings of the same event would read as two different events.

### 18e. Tests

- **Unit:** the `like`-escaping helper, because `%` is the whole hole and a regression there is silent.
- **Migration proofs**, rolled back, each with a negative control: search refuses two characters, search escapes `%`, an invite from a non-member is refused, a blocked pair is refused as `NOT_FOUND`, a second invite is a no-op, `circle_preview_members` returns nothing for a revoked token.
- **e2e (`invite-user.spec.ts`):** owner searches the joiner, invites, the notification appears for the joiner, tapping it reaches the join page, the join page names the owner, and the joiner joins. Plus the refusal path: invite somebody already in the Circle and read the message rather than a raw Postgres error.
- **e2e (`moderation.spec.ts`):** a blocked account does not appear in search results. This belongs there rather than in the new file, because that is where blocking's other guarantees live.

---

## Step 19: a Circle that talks back ✅ done

**Database and copy are done and proved; the e2e spec is not written.** Nine rolled-back assertions passed with controls, all four function bodies verified by `md5(prosrc)`, and every teaser body was run through node because vitest cannot start in the sandbox.

**Two assertions failed first and both were mine, not the triggers'.** "Total activity rows stays at 2" was wrong: a second person checking in *should* create a row for the first, who had none. The real invariant is **at most one row per recipient per Circle**, which is what the proof asserts now. And "nobody else gets `last_one_left`" caught a row from a *different* Circle these accounts share, which is the feature working. An assertion scoped more loosely than the thing it describes reports the code as broken.


**The gap.** A Circle is silent between rollovers. You check in, and the next thing you hear is tomorrow's digest telling you how yesterday went. The premise is friends watching each other's days; the product currently lets them watch a day that has already ended.

**Four events, chosen because each is self-limiting by construction.** The rejected version is instructive: "notify on everyone's first and last goal" is 2 events × 9 recipients in a full Circle, 180 rows a day inside one Circle, 72 pushes a day for somebody in four. That is not a stricter version of the same idea, it is a different product. Each event below either concerns one person or can only fire once per Circle per day.

| | Type | Fires | Recipients | Ceiling |
|---|---|---|---|---|
| 1 | `goal_achieved` | `goals.achieved_at` goes from null to set | Members of Circles the goal is **not hidden in** | Rare on its own: achieving is final (migration 83), so a person does this a handful of times ever |
| 2 | `circle_first_finisher` | The first member of a Circle to complete their whole day | Everyone else in the Circle | One per Circle per day, whatever the size |
| 3 | `last_one_left` | Everyone else has finished and you have not | **You alone** | One per Circle per day, and only for one person |
| 4 | `circle_activity` | Somebody's first check-in of the day | Everyone else, **coalesced** | See below |

### The one deviation, and why

You asked for a notification on somebody's first goal of the day, and added that arriving late is fine. Taken literally that is 90 rows a day in a full Circle, nine pushes each. **Because late is acceptable, they can be coalesced instead**, and the mechanism is already in the schema: `send-digest-push` delivers every row with `pushed_at is null` on an hourly cron.

So `circle_activity` **appends rather than inserts**. If the recipient already has an undelivered `circle_activity` row for that Circle, the new name joins its payload; only if there is none does a row appear. The ceiling falls out of the delivery schedule rather than from a rule someone has to remember: **at most one push per Circle per hour**, naming everyone who moved in it. "Ryan and two others got started in Runners" is also better copy than three separate buzzes saying the same thing.

### Where each one lands

**`circle_activity` is push-only, like `digest`.** It stays out of `TAB_NOTIFICATION_TYPES`, because the badge counts unread tab rows and a permanently non-zero badge is a badge nobody reads. The other three are events worth finding later, so they go in both.

**Nothing names a goal.** `send-digest-push` has said "a goal is never named here, ever" since step 13, and `goal_achieved` is the first type that would be tempted to. The copy is "Ryan achieved a goal in Runners", and the goal's title stays where the masking rules can see it.

### What has to change around it

- **The settings copy is a promise, and it becomes false.** "At most one a day: how your Circle did, and whether anyone is waiting on you" is on `/settings` today. It becomes a description of the digest plus a list of what else can arrive.
- **Four per-type toggles**, as boolean columns on `users` in the house style of `push_shows_circle_name`, defaulting on. All-or-nothing is what makes people switch off notifications entirely and lose the digest with them.
- **Masking is per Circle, not per person.** A goal hidden in one Circle and visible in another must announce its achievement in exactly one of them, which means the recipient list is computed per Circle rather than once.
- **Blocked pairs are skipped both ways**, consistent with everything else blocking does.
- **Archived and locked Circles are silent.** Nothing there can change.

### Tests

- **Migration proofs**, rolled back with negative controls: a hidden goal's achievement does not reach the Circle it is hidden in but does reach the one it is visible in; the second finisher in a Circle produces no `circle_first_finisher`; `last_one_left` fires for exactly one person and only when everyone else is done; a second `circle_activity` in the same Circle appends to the undelivered row rather than inserting; a toggle set to false stops the row being written at all.
- **Unit:** `teaser` copy for four new types, in both name states, plus the coalesced plural forms.
- **e2e:** two accounts in one Circle, the joiner checks in, and the owner's notifications tab is asserted to be unchanged for `circle_activity` (push-only) while `circle_first_finisher` appears.

---

### The audit, 1 September

**One real defect, found by the platform's own linter rather than by reading.** Migration 103 created three trigger functions in `public`, and a function in that schema is a PostgREST endpoint: `trg_goal_achieved_notify`, `trg_day_completed_notify` and `trg_first_checkin_notify` shipped callable by `anon` and by `authenticated`. Migration 7 wrote this rule down in August, for `handle_new_user`, and I did not follow it.

Not exploitable — plpgsql refuses a trigger function invoked outside a trigger — and that is not the point. Three `security definer` functions were sitting on the public API surface relying on a language check instead of a grant, and the next one might not be a trigger function. **Migration 104** revokes all three; every one of the ten `trg_*` functions in `public` is now closed to both roles, and the triggers were re-proved to still fire afterwards.

**Two limits that are real and are not being fixed.** `search_users` and `invite_user_to_circle` are rate limited in the server actions that call them, and both are also reachable directly at `/rest/v1/rpc/` by anyone holding a session. That is true of every RPC in the app and is the reason the limits are described as bounding enumeration rather than preventing it. The invite path is additionally bounded at the database: one unread invite per person per Circle, and five Circles a day.

**Accepted behaviour, not a bug.** Somebody whose whole day is one goal produces `circle_activity` *and* `circle_first_finisher` from a single check-in, so their Circle hears twice about one event. Both are true, both have their own switch, and suppressing one would mean the trigger guessing which the reader would rather have.

**Pre-existing and deliberate:** `audit_log` and `username_history` have RLS on with no policies, which is deny-all by design, and leaked-password protection is off because there is no password auth to protect.


---

## Step 20: the front door ✅ done

**Eleven commits, and three of them fixed something the previous one had just broken.** Every sub-step below is marked with what it actually shipped; the ones that changed shape while being built say so where the decision was made.

**Everything built so far assumes you already have an account, and a Google one.** `/` is a placeholder, the only way in is one button, and nothing tells a stranger what a Circle is. This step is the public surface plus email signup, and it is the last functional work before the design system.

**Four decisions taken before any of it was sequenced.**

| Decision | Chosen | What it cost or saved |
|---|---|---|
| Email and password auth | **Build the whole flow**, explicitly as a learning exercise | Roughly 80% of this step. Google-only would have been a fifth of the work, and the reason to do it anyway is that every trap below is a real one worth having met once |
| The signup form's fields | **Email and password only**; username moves to `/onboarding` | Overturns `deferred.md`. An unconfirmed account must not hold a username, and the two paths now share one implementation of the rules |
| Colliding addresses | **One account, Google keeps it** | Nothing to build. The rescue is a line of copy on `/auth/check-email`, which is the only thing that reaches somebody enumeration protection will not let the form explain |
| The landing page's finish | **Plain, mobile-first, and deliberately unstyled** | Its job is to explain and to get out of the way. Design lands later, with everything else. **Nothing in it may depend on styling to make sense** |
| Accounts that already exist | **Prompted once, at next sign-in** | A one-screen interstitial and a small RPC. The alternative was a backfill writing a timestamp claiming somebody agreed to something they were never shown, in the one column whose whole purpose is proving they did |
| Who the page is for | **Somebody you invited** | Not a stranger being persuaded. It answers what a Circle is, what a day looks like, and what the streak rule costs. Matches the ten-person cap and the audience the legal review assumed |

---

### The PWA question, because it changes the manifest

**A landing page at `/` does not break the PWA. `start_url` does.**

The manifest says `start_url: "/"`, harmless while `/` was a placeholder. The moment `/` becomes a real page, **every cold launch of the installed app opens on it**: a signed-in person gets a flash of the hero and a redirect, on the screen they open every morning.

| Field | Now | After | Why |
|---|---|---|---|
| `start_url` | `/` | `/dashboard` | The installed app opens the app. Signed out, `/dashboard` already redirects to `/auth/sign-in`, so that case needs no second rule |
| `scope` | `/` | **unchanged** | The trap in the other direction. Narrowing it would put `/privacy`, `/terms`, `/support` and **`/join/<token>`** outside the installed window, so on iOS an invite tapped inside the app opens in Safari — where that person is not signed in |

**The install prompt stays after signup, where it is.** `/onboarding/install` sits between account creation and the push ask, because push is the only reason installing matters. A landing-page install button targets somebody with no account, who would install an app that opens on a sign-in screen. The page **mentions** that it installs; it does not ask.

**One thing to check on the device rather than assume.** iOS home-screen web apps have historically kept storage separate from Safari's, which would mean signing up in Safari and then installing lands you in a signed-out app. If that still holds, install-before-signup is better on iOS and the paragraph above is wrong for that platform. Fifteen minutes on the iPhone that already has Solarity installed, and it decides whether the landing page gets an install call to action after all.

---

### The order, and why it is this order

Each of these is a commit. The dependencies are real: **20b before 20e** because the flow cannot be tested without the templates, **20h last** because enabling Turnstile before the forms send tokens breaks every password endpoint at once.

#### 20a. Terms acceptance ✅ **done, migrations 105 and 106**

Columns on `users`, `complete_onboarding` gains a parameter, and a small `accept_terms(p_version text)` RPC for accounts that predate all this.

**Adding a parameter to a Postgres function does not modify it, it creates an overload.** `create or replace` only matches an identical signature, so the two-argument version survives, PostgREST sees two candidates for `/rpc/complete_onboarding`, and every signup fails with an ambiguity error. The migration must `drop function public.complete_onboarding(text, text)` **first, in the same migration as the create**.

`TERMS_VERSION` in `lib/legal.ts` has had no writer since the legal pass. This is it, and the paragraph on `/terms` saying nothing records acceptance changes in the same commit.

**Built.** Two columns (`terms_accepted_at`, `terms_accepted_version`), an `accept_terms(p_version)` RPC for accounts that predate this, and `complete_onboarding` dropped and recreated with a third parameter. Both callers pass `TERMS_VERSION`.

**`authenticated` gets SELECT on the two columns and deliberately not UPDATE.** The gate has to read them; nothing but the two definer functions may write them. A column-level update grant would let any client forge a record of consent it never gave, in the one column whose entire purpose is proving it did. Asserted with `has_column_privilege`.

**The `coalesce` is the part that fails silently.** `complete_onboarding` is also the rename path, so without it a person changing their username two months from now would have their acceptance timestamp quietly moved to today. Proved by accepting 60 days ago, renaming, and asserting the timestamp did not move — the first version of that proof compared a value to itself and could not fail.

**Two things went wrong in the ten minutes after it applied, and both are worth keeping.**

**A rename in Settings recorded an acceptance.** `complete_onboarding` is two paths in one function, and the `coalesce` correctly stopped a rename *moving* an existing acceptance while quietly letting one *create* one. So changing a username wrote a timestamp saying that person agreed to terms nothing had shown them: the exact dishonesty the interstitial exists to avoid, arriving through a door nobody was watching, and worse than the backfill we rejected because it looks like a real event. **Migration 106** writes acceptance only when `v_current is null`, which is the branch that means onboarding. The false record was cleared rather than kept.

**And the first rename after 105 failed with "Something went wrong."** Dropping `complete_onboarding(text, text)` and creating `(text, text, text)` leaves PostgREST serving a cached schema, so a three-argument call matches nothing and returns `PGRST202`. The database was correct throughout and retrying could never have helped. `notify pgrst, 'reload schema';` fixes it, `toMessage` now names the schema cache instead of blaming the person, and `lib/errors.test.ts` covers it. **Every signature change is a chance to meet this again, and step 20 makes several.**

**Still to do in a later commit:** the paragraph on `/terms` saying nothing records acceptance is now false and changes with 20c, when the interstitial exists to make it true.

#### 20b. Supabase dashboard — configuration, not code ✅ **done 1 September**

None of it lives in `config.toml`, which configures the local stack only, and **nothing downstream can be tested until it is done**. There is no code in this sub-step; it is the prerequisite for 20e and 20f.

**Authentication → Sign In / Providers → Email**

| Setting | Value | What it breaks if wrong |
|---|---|---|
| Enable email provider | **on** | Off by default on a Google-only project. Every `signUp` call fails until it is on |
| Confirm email | **on** | Off means anyone can register any address, including one that is not theirs, and password reset becomes a takeover |
| Minimum password length | **8** | Supabase defaults to 6, below current guidance |
| Password requirements | **letters and digits** | |
| Leaked password protection | **on if the plan allows** | The linter reports it disabled today. It is a paid-plan feature, so a launch item rather than a prerequisite |
| CAPTCHA | **leave off** | 20h enables it, *after* the forms send tokens. Enabling now breaks every password endpoint at once |

**Authentication → URL Configuration**

Redirect URLs: `http://localhost:3000/**` and `https://solarity-five.vercel.app/**`. Both set, both correct — the `/**` wildcard is the form Supabase wants.

**Site URL is a different field, holds one value, and is the one that matters here.** It must be `https://solarity-five.vercel.app`, matching what `lib/site-url.ts` resolves to on Vercel via `VERCEL_PROJECT_PRODUCTION_URL`. `{{ .SiteURL }}` in the templates below reads from it, so a stale `http://localhost:3000` there sends every production confirmation link to a host nobody else can reach.

**A friction point to decide in 20e, not now.** Because Site URL is a single value, an email triggered from a local dev server still points at production. Three ways out, in order of preference:

1. **Temporarily point Site URL at `http://localhost:3000` while testing the flow, and put it back.** One field, reversible, and it keeps the templates simple.
2. Pass `emailRedirectTo` on `signUp` and switch the templates to `{{ .RedirectTo }}`. Per-environment and correct, but `.RedirectTo` is empty for invites sent from the dashboard, which silently produces a broken link.
3. Copy the `token_hash` out of the email and open it against localhost by hand. Fine once, tedious as a habit.

**Authentication → Email Templates — the line most likely to cost an afternoon**

Supabase's defaults use `{{ .ConfirmationURL }}`, an implicit-flow link that **does not work with the SSR client**. Confirmation appears broken and the failure reads exactly like a code bug in `/auth/confirm`. Replace the link in both templates:

| Template | Link |
|---|---|
| Confirm signup | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` |
| Reset password | `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/auth/reset-password` |

Both point at the same route: `/auth/confirm` exchanges the token for a session and then sends people where the `type` implies. That is why 20e builds it once and 20f reuses it.

**Brevo is already the sender and already verified**, so this is settings rather than integration. Two caps apply and they are independent: Brevo allows 300 a day, Supabase separately caps **30 new users an hour**, and that one binds first — worth knowing before wondering why the eleventh test signup did nothing.

**How to check it took**, before any of 20e exists: Authentication → Users → Add user → *Send invite*, to an address you control. An email should arrive through Brevo with a link to `/auth/confirm?token_hash=…`. A 404 on that route is expected and correct at this stage; the link's *shape* is what is being verified. No email at all means the provider or the SMTP settings, not the templates.

#### 20c. The terms interstitial ✅ **done**

`/onboarding/terms`, plus a fourth check in the gate. Existing accounts meet it once; new ones never see it, because `complete_onboarding` records acceptance as part of signup.

**Outside `(app)`, like `/onboarding` and `/onboarding/install`.** The gate redirects people who have not accepted, so a screen inside that group would redirect to itself, and a route cannot opt out of its own group's layout.

**The page summarises and links rather than embedding the terms.** A second copy of the text would be a second thing to keep in step with `TERMS_VERSION`, and the version people read is the short one either way. Both `/terms` and `/privacy` are one tap from the button.

**Two dead ends are closed at the top of the page**: no username sends you to `/onboarding`, which records acceptance itself rather than queueing this behind it; an existing acceptance sends you to `/dashboard`, so the URL asks nobody twice.

**The form posts a hidden `next` and the action redirects.** The first version awaited the action and routed on the client with `useRouter`, which worked and was worse twice over: it needed JavaScript to complete a form that otherwise would not, and it left both `useActionState` arguments unread. ESLint caught the second — `no-unused-vars` only forgives an unused argument when a later one *is* used, which is why every other action in the app gets away with `_prev`. Reading `formData` fixed the design and the warning together.

**`/terms` now says the opposite of what it said yesterday**, and that is the legal pass's own rule applied to itself: when the code changes what happens to somebody's data, the page changes in the same commit. The paragraph explaining that nothing records acceptance was true when written and is now false.

#### 20d. The gate, and `PUBLIC_PREFIXES` ✅ **done**

`app/(app)/layout.tsx` ends up checking four things in order:

```
!user                       → /auth/sign-in
!user.email_confirmed_at    → /auth/check-email
!profile.username           → /onboarding
!profile.terms_accepted_at  → /onboarding/terms
```

**A gate rather than a flow**, because any signup can be abandoned midway: close the tab after `signUp` succeeds and there is a real account with an unconfirmed address. Only something evaluated on every protected navigation catches that, and `email_confirmed_at` comes off the object `getUser()` already returns, so it costs no query.

`PUBLIC_PREFIXES` already covers `/auth` and `/`; it gains `/support`.

**The Google accounts were checked against the data, not assumed.** Adding `!user.email_confirmed_at` would have locked every existing account out behind a screen that did not exist yet, had Google sign-in left that column null. All three have it set, because Google verifies the address and Supabase records it at sign-in. That query cost nothing and the alternative was a self-inflicted outage.

**`/auth/check-email` landed here rather than in 20e**, because a redirect to a route that does not exist is a 404 loop dressed as a security check. 20e adds the resend control to it; the page itself belongs with the gate that needs it.

**It is not a signed-out screen.** `signUp` returns a session before confirmation, so whoever reads it has one and simply cannot pass the gate — hence the sign-out link, without which the only escape is clearing cookies.

**The Google rescue line is on it already**, and `legal.spec.ts` asserts it. With enumeration protection on, somebody whose address already has a Google account gets this screen and no email, ever; the form is not allowed to explain, so that button is the only thing that reaches them.

#### 20e. Signup, and signing in with a password ✅ **done**

**The form is email and password. Nothing else.** This overturns `deferred.md`, which had it collecting username and display name too, and the reason is confirm-email: a username taken on the form is a username held by an account nobody has proved they own. With enumeration protection on, somebody can quietly burn handles by signing up and never confirming, and there is no way to tell that from ordinary abandonment.

So **username moves to `/onboarding`, where Google users already set theirs**. One implementation of the rules and the profanity screen instead of two, one screen to change when they change, and an unconfirmed account reserves nothing. Display name follows it: optional, and already editable in Settings. The cost is one extra screen in the signup path, paid once.

The full path, and it converges with Google's at the third step:

```
/auth/sign-up → /auth/check-email → (email) → /auth/confirm → /onboarding → /onboarding/terms? → /dashboard
```

**Enumeration protection stays on**, so signup never reveals whether an address is registered. Supabase links identities by verified email, so somebody with a Google account on that address stays **one account, and Google keeps it** — the password signup silently succeeds and no email ever arrives. The whole rescue is copy: **`/auth/check-email` carries "Already have an account? Sign in" with the Google button**, because it is the only thing that reaches that person and the form is not allowed to explain.

**A resend control on `/auth/check-email`**, rate limited per address like the reset. A confirmation link that expires with no way to get another is a dead end, and expiry is the ordinary case for anyone who signs up and reads their email tomorrow.

**Four decisions taken while building it.**

**Password sign-in moved here from 20f**, because shipping signup alone would leave somebody able to create and confirm an account they cannot use. 20f is now purely forgot-and-reset, which is a cleaner boundary anyway: one commit creates accounts, one recovers them. `/auth/sign-in` keeps one route, Google on top, password beneath a divider — a second route would put the `next=` parameter through an extra hop, and that value is what carries somebody back to the Circle they tapped a notification for.

**Display name stays in Settings.** `coalesce(display_name, username)` always renders something, so nothing is missing without it, and asking would turn the shortest screen in the app into a two-field form for a value most people never change.

**The password rules are validated client-side as well as server-side**, which duplicates a policy that lives in the Supabase dashboard. That cost was taken deliberately for instant feedback, and the mitigation is `lib/password.ts`: the hint, the client check, the action and the tests all read one module, so they cannot disagree with each other — only with the dashboard, which is one place to look when they drift. **Change that file in the same sitting as the setting.** `\p{L}` and `\p{Nd}` rather than ASCII classes, because a Cyrillic-and-Arabic-Indic password satisfies Supabase and an ASCII check would refuse what the server accepts.

**`/auth/error` learned two reasons.** It was a passthrough for Supabase's OAuth message; `/auth/confirm` now sends `link` and `missing`, and rendering those as bare words would be worse than saying nothing. Both are mapped to a sentence and a way forward, and an unrecognised value still falls through to the passthrough.

**The e2e spec drives the real token exchange.** `admin.auth.admin.generateLink()` returns the same `hashed_token` the email would have carried without sending anything — the trick `e2e/session.ts` already uses — so `/auth/confirm` is tested with a genuine token, a genuine `verifyOtp` and genuine cookies. Six tests: an unconfirmed account cannot reach `/dashboard`; confirming lands on `/onboarding` because the gate decides, not the route; a link used twice says it expired; a link with nothing in it says so differently; the form states its rules and refuses a weak password with a control proving the button is not simply always disabled; and a wrong password produces the **same** sentence for a real address and an unknown one.

**One naming trap worth keeping.** `generateLink` calls the confirmation token `type: "signup"`, and `/auth/confirm` receives it as `type=email`, which is the `EmailOtpType` that verifies it. The two names are not a mistake.

**A confirmation field and a reveal**, added after the first test drive, and both live in `components/password-fields.tsx` because 20f's reset screen asks the same question and would otherwise grow a second copy.

**One toggle reveals both fields.** Two independent eyes is more chrome and a worse question — nobody wants to see one and hide the other — and revealing both is what makes the confirmation checkable by eye rather than only by its mismatch message. `type="button"`, because a bare `<button>` in a form submits it, and a reveal that submitted a half-typed signup would be memorable.

**The match is checked in the action as well as the browser.** The form works with JavaScript off, and with it off neither the rules nor the match run client-side. A mismatch arriving unchecked would create an account with the *first* password while whoever typed it is certain they used the second, leaving them unable to sign in and unable to say why. A typo-catcher that only works when scripting does is not one.

**The spec needed `{ exact: true }` on the password label**, because "Confirm password" contains "Password" and the locator otherwise resolves to two fields — a strict-mode violation reported as a missing input. Same shape as the prefix-username trap in `invite-user.spec.ts`.

#### 20f. Password reset ✅ **done**

**Identical response and comparable timing for real and unknown addresses.** A timing difference reintroduces exactly the leak enumeration protection exists to prevent.

**Sign-in keeps one page.** `/auth/sign-in` grows a divider and an email/password form beneath the Google button, rather than a second route: one place the `next=` parameter is handled, and it is exactly the sort of value that gets silently dropped across an extra hop, landing somebody on the wrong page after signing in. Google stays on top because it is what almost everybody will use.

**Out of scope, and written down so the decision is not remade:** changing your email address in Settings, and adding a password to an existing Google account. The first is a two-sided confirmation flow with its own traps; the second is a new way to lock yourself out. Both are real features and neither is needed to sign up and use Solarity.

**Built, and three things are worth keeping.**

**The refusal reads exactly like the success.** A rate-limited reset returns "if there's an account, we've sent a link", not "too many attempts", because a distinguishable refusal is still a signal: try an address, get the limit message, and you have learned the earlier attempts were counted against something real. The cost is that somebody genuinely limited is not told why, which is a fair trade for a form used once a year.

**No early return for unknown addresses**, so there is no timing difference either. Every call does the same two limit checks and the same Supabase call, and Supabase does not tell us which case it was. A branch would have leaked by clock even with identical wording.

**`/auth/reset-password` has no token on it.** The email points at `/auth/confirm?…&type=recovery&next=/auth/reset-password`, so the credential is spent before this page renders and the URL is clean — nothing single-use in the address bar, in history or in a referrer. It also lives under `/auth` rather than inside `(app)` on purpose: a recovery session is a real session, so the gate would happily let it through and then send anybody without a username to `/onboarding`, losing the reset.

**There is no "current password" field**, and that is not an oversight. Proving control of the address *is* the authentication; asking for the old password would ask the one thing somebody resetting it does not have. Which makes the session check the whole guard, and no session renders an offer of a new link rather than a form that cannot work.

**Three more e2e tests**, driving a real `type: "recovery"` token. The one that matters signs in with the new password afterwards and then fails to sign in with the old one — everything before that is satisfied by a form that navigates correctly and changes nothing.

**`/auth/forgot-password` names the Google case.** Somebody who signed in with Google and never set a password would otherwise request a link, receive nothing, and conclude the product is broken; enumeration protection forbids the form from explaining, so a static sentence does it instead.

#### 20g. Rate limits without a session ✅ **done, with 20e and 20f**

`lib/ratelimit.ts` documents its limits as keyed by user id, which is true today because every action needs one. **Signup and reset have no session**, so they key on client IP — a weaker key that groups a household, hence generous numbers. The doc comment is corrected in the same change.

| Action | Limit | Key |
|---|---|---|
| `signUp` | 10 / hour | IP |
| `signInWithPassword` | 20 / hour | IP |
| `resetPasswordForEmail` | 5 / hour | IP, **and** 3 / hour per address — **20f** |
| Resend confirmation | 3 / hour | address |

**Added with the actions rather than after them**, because an unmetered signup endpoint is exactly the kind of thing that ships. What is left for 20g proper is the reset limit and correcting the module's own doc comment, which still says every limit keys on a user id.

**The per-address limit is not abuse control.** Without it anyone can use Solarity to repeatedly email a stranger, which is how a sending domain gets flagged — and that domain is the one the monthly heartbeat exists to keep warm.

#### 20h. Turnstile ✅ **wired; the switch stays off, deliberately**

Configured and inert since step 12, because Supabase's CAPTCHA only guards endpoints taking a `captchaToken` and a Google-only app called none. Password auth adds three: signup, password sign-in and reset. All three now render the widget and pass the token.

**The trap fired on the way here.** CAPTCHA was switched on during 20b and every password endpoint began refusing with `captcha protection: request disallowed (no captcha_token found)` — because the forms did not send a token yet. That is the whole reason this sub-step was scheduled last, and it cost a debugging detour anyway.

**The CSP needed two directives, and the second is the quiet one.** `script-src` gains `https://challenges.cloudflare.com` or the loader is blocked and no widget appears. `frame-src` gains it too — it was `'none'` — or the script loads, the element mounts, and **nothing renders**: no error, no challenge, no token, and Supabase then refuses with the same `no captcha_token found` that points at the form rather than at the policy. Both are asserted in `lib/security-headers.test.ts`, along with the fact that `frame-src` names exactly one origin and `frame-ancestors` is still `'none'`.

**A token is single-use**, so each form resets the widget after a failed attempt. Without that, a second submit after a wrong password is refused *for the captcha* rather than for the password — the most confusing outcome available.

**No site key renders no widget**, because `next build` runs in CI with no environment variables and a component that needed one would fail a build meant to prove the app compiles.

#### The switch stays off, and this is the decision rather than an oversight

**One Supabase project serves both production and the e2e suite, and Playwright cannot solve a real challenge.** Turning CAPTCHA on would permanently break the six tests covering signup, confirmation and reset — the newest and least exercised code in the app — in exchange for protecting endpoints that already sit behind IP-keyed limits.

Cloudflare's always-pass test keys were the third option and are worse than off: the dashboard would report CAPTCHA enabled while every bot passes, which is a false sense of a control rather than a control.

So the wiring ships and the toggle waits. **The five-step enablement runbook is under Deferred in `build-plan.md`**, to be done after the first design version — it is configuration in three different dashboards, and doing it out of order reproduces the `no captcha_token found` failure this step already met twice. `architecture/app.md` has said since step 12 that rate limiting is the primary abuse control and a Google account is a higher barrier than a CAPTCHA; this does not change that, it just means the option is now real.

#### 20i. The landing page, and the manifest fix ✅ **done**

Seven sections, plain and mobile-first: hero and two buttons; why a small private group beats a solo tracker; how it works in three steps; **what a day looks like**; the streak rule stated honestly up front rather than discovered on day three; a mention that it installs; the footer that already exists as `legal-footer.tsx`, gaining Support.

**The example digest is a rendered component with fixture data, not a screenshot.** The daily-batched model is the least obvious thing about the product and much weaker described than shown — and a screenshot goes stale silently the first time the digest changes.

Signed-in visitors keep being redirected to `/dashboard`, as `/` does today.

**Built plain, and the constraint is what makes the later design pass a restyle rather than a rewrite:** nothing on the page may depend on styling to make sense. Semantic headings, real sections, readable at 375px, only utility classes the app already uses.

**The example digest is `app/example-digest.tsx`, a component with fixture data.** It deliberately does *not* import `DigestPanel`: that takes `DigestDay[]`, a viewer id and a `today`, all of which would have to be faked, and it renders `<details>` roll calls this page has no room for. Reusing it would couple a marketing page to a component answering to the dashboard, and the first change to either would break the other. `formatDay` **is** shared, because the date format is the part a reader later compares against the real thing.

**The date is fixed rather than `new Date()`.** A marketing illustration that renders differently on every request cannot be reasoned about or snapshotted.

**`LegalFooter` gained Support** rather than the landing page inlining its own footer. The inline version lasted about a minute before it was obviously two footers to keep in step, which is the thing that component exists to prevent — and every auth screen gets the link for free, which is where somebody locked out will look.

#### 20j. `/support` ✅ **done**

**Content and a `mailto:`, not a contact form**, which is the one place this step spends less than `deferred.md` budgeted. A form on a one-person product is a spam relay needing its own Turnstile, its own limit and its own sending path, to reach an inbox a `mailto:` reaches for free.

The content is not decoration: the backend implements all of it and **nothing links to any of it.** How to delete your account and what survives; how to export your data; the 90-day photo retention; how reporting works; how blocking differs from being removed; and why an iPhone needs the app installed to receive notifications.

**Seven answers, and `export_user_data` is the sharpest example of the gap.** It has existed since step 14 with exactly one caller — a Settings link nothing pointed at — so the feature was real and undiscoverable. The page also names the six things the export leaves out, matching `/privacy`, because two pages describing one file differently is worse than either alone.

**Added to the sitemap**, since it is the one page answering "what happens to my data" for somebody who does not have an account to ask from.

#### 20k. Tests ✅ **done**

**One precondition broke ten tests, and it was the last thing found.** The terms interstitial sends anybody with no `terms_accepted_at` to `/onboarding/terms`, and all three fixture accounts predate migration 105 — so the first full run after 20c failed ten tests across four files, each reporting a missing landmark on a page that was actually the terms screen. `auth.setup.ts` now writes acceptance for the three accounts, in the same spirit as `parkActiveGoals`: **a fixture account is not a person**, so nothing is being consented to on anyone's behalf, a precondition is being met.

That left the interstitial untested, so `sign-up.spec.ts` builds the state deliberately on a throwaway account — confirm, onboard, null the columns — and asserts the screen appears once, records the version as well as the timestamp, and does not ask again. It could not be tested on the fixture accounts: a test that accepted on their behalf would consume the exact state it was asserting.

The ones that catch something rather than the ones that are easy:

- Abandon signup after submitting. The account must be stuck at `/auth/check-email` and unable to reach `/dashboard` by typing the URL.
- Click a confirmation link twice. The second reaches `/auth/error` with a comprehensible message.
- Sign up with an address that already has a Google account, and read the copy as that person would.
- Sign up, abandon before confirming, then check the username is still free. This is the whole reason the form does not collect one.
- Password reset for an address that does not exist: identical response, comparable timing.
- Force `email_confirmed_at` to null in SQL and try to reach `/dashboard`.
- An existing account meets the terms screen once, and not again.
- Rename a username two months later and check `terms_accepted_at` has not moved. It is a `coalesce`, and it fails silently.
- **The manifest**: `start_url` is `/dashboard` and `scope` is `/`. One assertion, and it is the whole PWA answer above.

**Written across three files rather than one.** `sign-up.spec.ts` covers signup, confirmation and reset (nine tests, driving real tokens via `generateLink`); `legal.spec.ts` covers the public surface, `/support`, `/auth/check-email` and the manifest; `lib/security-headers.test.ts` covers the two CSP directives Turnstile needed.

**Not covered, and named rather than pretended:** the terms interstitial has no e2e test, because the only accounts that can see it are the three real ones and a test that accepted on their behalf would consume the exact state it was asserting. It was verified by hand instead.

---

## The audit over steps 19 and 20

Run on 1 September, after 20k. **Two real defects, both in the service worker, both invisible from the code that changed.**

**A branch that has never once run.** `sw.js` routes digest taps to `?tab=overview` when `d.type === "digest"`. The sender builds `data` as `{ notification_id, ...payload }`, and no notification payload has ever carried a `type` key — verified against all 138 rows. So the branch has been dead since step 10, with no symptom: taps landed on the Circle's default tab, which is a reasonable place to be. Fixed by putting `type: n.type` in `data` explicitly, spread last so a payload key cannot shadow it.

**An invite push landing where the invite cannot be accepted.** Step 18 pointed the *in-app* `invited` row at `/join/<token>`, because the recipient is not a member and `/circles/<id>` bounces them. The worker routes by `group_id` and was never updated, so the push went to a Circle they cannot see. One event, two renderers, one of them outside the diff.

**And a third, caught by the same read:** the worker's fallback target was `/`, which step 20i turned into a marketing page — so a tap with nothing to route on would have opened the landing page from inside the installed app. Now `/dashboard`.

**What the audit checked and found sound**

| Check | Result |
|---|---|
| Supabase security advisors | No new exposures. Migration 104's revokes held; every remaining warning is an intentional RPC |
| All nine step 19–20 functions vs. their migration files | `md5(prosrc)` matches for all nine, and the newest definition wins in both places |
| `security definer` + `search_path = ''` on all nine | Yes, all nine |
| `private.eligible_peers` reachability | Revoked from `anon` *and* `authenticated`; only the definer functions call it |
| Terms columns | `select` granted, `update` **not** — acceptance is writable only through the two RPCs |
| Every rate limit has a caller | 19 declared, 0 orphaned |
| Every `BY_HINT` code is raised, and every raised hint has copy | Both directions clean, allowing for the dynamic and retired lists |
| Vacuous `toHaveCount(0)` assertions in the new specs | Each has a control proving the page was not simply empty |

**One piece of sloppiness of my own, removed:** the reset test clicked a Sign out button inside `.catch(() => {})`. After a reset that button does not exist, and an empty catch makes "this never ran" and "this failed" the same silence.

**Left as known and accepted:** `notifications.payload->>'group_id'` has no index, which is fine at 90-day retention and small volumes; leaked-password protection is still off, which now matters more than it did because passwords exist — it is a paid-plan feature and belongs on the launch list rather than here.

---

## The public surface ✅ done

`/privacy`, `/terms`, `robots.txt`, `sitemap.xml`, and links from `/`, `/auth/sign-in` and `/settings`. **This was the gate on the Google OAuth consent screen** — until a privacy URL was publicly reachable, nobody outside the test accounts could sign in.


|                              |                                                                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/legal.ts`               | Every number the pages assert, annotated with the job that enforces it. `TERMS_VERSION` is a dated constant; **nothing records acceptance**, because Google sign-in never shows a checkbox and a column now would be declared with no writer |
| `components/policy-page.tsx` | One frame, so the two pages cannot drift apart                                                                                                                                                                                               |
| `lib/site-url.ts`            | The only place in the app that needs to know its own hostname. `NEXT_PUBLIC_SITE_URL`, then Vercel's, then localhost — the fallback is what keeps CI's **env-less** build working                                                            |
| `PUBLIC_PREFIXES`            | Extracted from the inline boolean in `proxy.ts`, matched as whole segments so `/termsomething` does not become public because `/terms` is                                                                                                    |


**The copy describes only what exists.** Account deletion is a deployed Edge Function with no UI, so the page gives an address rather than promising a button. **That sentence becomes a link in 14e's commit**, not later — a policy offering a slower path than the product does is the same drift in the other direction.

**Decisions:** individual rather than a company, contact `ryanhang07@gmail.com`, **18+**, dated version constant with no acceptance tracking.

**The assertion the whole spec exists for:** the sitemap must never contain `/join`. An invite token is a bearer credential, so enumerating them would publish every Circle. `sitemap.ts` cannot reach the database today and must never gain the ability — the test fails the moment somebody adds a helpful-looking `groups.map(...)`.

### The legal review, in more detail than "get it reviewed"

The pages say they are not legal advice. That is honest, and it is also not a plan. What a review is actually for, and when it starts mattering:

**Three different things are bundled under "legal review", and they have different urgency.**

| | What it is | When it bites |
|---|---|---|
| **Accuracy** | Do the pages describe what the code does? | ✅ **Done 31 Aug**, and it found six defects; they are listed below. This was the part that was your problem rather than a lawyer's. Every number lives in `lib/legal.ts`, and `EXPORT_CONTENTS` and `PROCESSORS` now join them, but nothing enforces that the *prose* keeps up beyond the four assertions added to `legal.spec.ts` |
| **Sufficiency** | Do they contain what the law requires of you? | ✅ **Done 31 Aug**, at the level chosen for the audience: friends, mostly US. Named controller, the three reasons processing happens, the rights list with a **30-day** window, US storage stated as a transfer, and a cookie section. Written in the pages' own voice rather than as articles, on the grounds that a reader needs the answer more than a regulator needs the vocabulary. **Not done:** a CCPA notice-at-collection and an explicit do-not-sell heading, deliberately, since a "does not sell" sentence already sits under *What is collected*. Revisit if the audience stops being people you know |
| **Exposure** | Do the terms actually protect you? | **When someone is unhappy.** "No guarantees" and "we can close your account" are the two clauses most often unenforceable as written, and both are in there. A one-person operation with no company is personally liable, which is the real reason this matters more here than it would behind an LLC |

### What the accuracy pass found, 31 August

Six defects, in a set of pages that had been written carefully six days earlier. Every one was a sentence describing a thing the code does not do.

| | Was | Is |
|---|---|---|
| 1 | "Everything Solarity holds about you is downloadable as one JSON file" | `export_user_data()` returns six things and omits notifications, push subscriptions, blocks, reports, the notification and screen preferences, and the email address in `auth.users`. **The single worst sentence to have wrong**, because it is the one a data access request is judged against. The page now lists what the file holds, from `EXPORT_CONTENTS`, and names what it does not |
| 2 | "a change that matters will be shown in the app before it takes effect", on both pages | Nothing implements it. No acceptance record, no banner, and the app sends no email. **A policy that overstates its own machinery is the failure these pages exist to avoid.** Now: the date is the notice, said plainly |
| 3 | IP addresses unmentioned | `clientIp()` sends the caller's IP to Upstash as a rate-limit key on the two signed-out paths, and Vercel logs it with every request. Now a bullet under *What is collected*, and both processor roles say which data reaches them |
| 4 | Retention listed only what expires | Avatars have no sweep, and neither do `content_reports` or `audit_log`. A list of things that expire, with no mention of what does not, reads as though everything does |
| 5 | Deletion mentioned only the check-in carve-out | It also leaves a report and an admin-access record behind with the user link nulled, and it *does* delete the avatar object, which the page never said. Both are now stated |
| 6 | "the only thing it does with them", in Terms | Contradicted two sections later by the reporting flow, where an administrator reads one reported note or photo. Qualified in place |

**And one near-miss worth recording.** Brevo was almost deleted from `PROCESSORS`, because nothing in the repository sends email and a grep says so. It is configured as Supabase's auth SMTP sender in project settings, outside the codebase, and `architecture/app.md` had it documented all along. **A processor is named for what it is wired to receive, not for what it happened to handle this month.** The entry now says both halves: configured, and unused while Google is the only way in.

`legal.spec.ts` gained four assertions from this: every `PROCESSORS` name appears on the page, the export section still says what it leaves out, and the phrase "told in the app" appears nowhere.

### And the sufficiency pass, same day

Four decisions, taken for an audience of friends who are mostly in the US, and each one is a commitment rather than a wording choice.

| | Decision | What it cost |
|---|---|---|
| **Controller** | Named: `CONTROLLER_NAME` in `lib/legal.ts` | A name without a postal address. The usual position for an individual, and the strongest argument for forming an entity is the address question, not this one |
| **Response window** | `RESPONSE_DAYS = 30`, the GDPR month rather than the CCPA's 45 | **A personal commitment with no team behind it**, including during a holiday. Chosen because export and deletion are both instant and self-serve, so the only requests arriving by hand are the six things the export omits |
| **Transfers** | `DATA_REGION`, stated plainly | Nothing, and its absence was conspicuous. `us-west-1`, plus US-hosted Vercel and Upstash |
| **Cookies** | A section saying they are all functional | Shorter than the banner would have been, and it explains why there is no banner |

**Written as things you can do, not as articles.** The rights section leads with the two that are buttons in the app, because a rights list that reads as a formality buries the fact that deletion is one click. The lawful bases are recoverable from the wording without the phrase appearing: a service you asked for is contract, a switch you turned on is consent, stopping abuse is legitimate interests.

Four more assertions in `legal.spec.ts`: the controller name, the response window, the cookie heading, and the data region, three of them read from `lib/legal.ts` so editing a constant without the page fails.

**The specific things a reviewer should be pointed at**, rather than handed the pages cold:

- **18+ with no verification.** The terms state it; nothing enforces it, because Google sign-in asks nothing. That gap is normal, but it should be a deliberate position rather than an accident, and it changes if you ever market to students.
- **Photos of other people.** The terms say do not post someone who has not agreed. A product whose whole point is sharing photos with a small group is a product that will eventually host a photo of someone who did not consent, and there is currently no reporting path — that is step 15.
- **Deletion is partial, on purpose.** Check-ins survive anonymised so other members' streaks are not rewritten. This is defensible and unusual, and it is exactly the sentence a regulator would ask about. It is stated plainly on the page, which is the right call, but it is worth confirming that "anonymised" is doing the work you think it is: the row still ties to a Circle and a date.
- **Processors and transfers.** Supabase, Vercel, Upstash, Google and Brevo are named, each with the data that reaches it. Whether any of them need a signed DPA, and where the data physically sits, are questions nobody has asked yet.
- **An export that is not complete.** The page now says so, which is the honest fix. The better one is extending `export_user_data()` to cover notifications, push subscriptions, blocks, reports and the preference columns, which is one migration and would let the page make the stronger claim.
- **No company.** Everything above lands on you personally. Forming an entity is the single change that alters the whole risk picture, and it is a decision, not a task.

**The cheap version**, if a full review is not proportionate yet: keep the audience to people you know, keep the pages accurate, and revisit before the first stranger signs up. The expensive version is discovering the gap after that.

**And one standing rule:** when the code changes what happens to someone's data, the page changes in the same commit. `lib/legal.ts` exists so the numbers cannot drift; the prose has no such guard and needs the discipline instead.

---

## The manual passes, and what they found



Rows 1 to 15 of the checklist itself live in `build-plan.md`, because they are repeated before every deploy. What follows is what those passes *found* — kept here because each one is a bug that passed headless.



### Found by the second manual pass

| Report | Cause |
|---|---|
| Settings offered "Turn on notifications" on a device that already had them on | **A `??` that turned "the read failed" into a confident "no".** `pushSubscribed` discarded its error, so `count` came back null and `(null ?? 0) > 0` said `false`. `pushEnabledHere` had a second one: `readyWorker()` resolves to `null` after ten seconds, and a wedged service worker rendered identically to an absent subscription. Both now return `unknown`, which the toggle draws as a sentence and a **Check again** button rather than as an off switch, and which the nudge treats as "say nothing" |
| Overview named every goal twice | Today lists every active goal with its controls; the summary underneath printed the same titles with nothing to do to them. **The summary is gone**, replaced by a right-aligned *View goals* link, and Overview is two panels and a way out. Two queries came out of the page with it |

### Found by the first manual pass, and fixed

| Report | Cause |
|---|---|
| Skeleton only appeared moving to and from Profile | **A loading boundary only fires for a navigation that changes the segment it sits in.** 15b moved `dashboard/loading.tsx` up to `(shell)/` on the assumption that one boundary above both covered everything below. It covered the one transition that already felt fast and none of the three 14a existed to fix. Both files are needed |
| Date picker text invisible on iOS; calendar icon black on black | `globals.css` swapped colour *variables* under `prefers-color-scheme` and never set **`color-scheme`**, which is the only thing that tells the UA which palette to draw its own widgets in. Chromium's calendar indicator is a fixed image rather than a themed control, so it needs an `invert(1)` as well |
| Avatar upload refused ordinary photos | The input cap was the **bucket's** 2MB. An iPhone photo is 3–5MB, and what actually gets stored is a 256px JPEG of tens of kilobytes. Two different numbers that had been one constant; the input cap is now 10MB and the bucket is unchanged |
| No photo on a Circle roster row | **Not a bug.** The roster shows *today*; the newest check-in photo in the database is three days old. Attach one today and it appears |
| Avatars were only on the profile | **The plan promised the roster and I built half of it.** Now on the roster row beside the name, in the header beside the username (linking to `/profile`), on the profile and in settings — all four through one `components/avatar.tsx`, down from two hand-rolled copies. **Migration 90** adds `avatar_url` to `circle_roster`, unmasked: an avatar is not about a goal, and it is the same picture any signed-in user can open on the profile. `getCircleRoster` now signs two batches in parallel, one per bucket |

---

## Step 21: the galaxy ports, and the sky gets its data ✅ done

3 September. Migrations 107–109. The renderer moves into the app, the roster learns to describe a Circle's sky, and a graph pass over the codebase found that three of the plan's claims about Solarity were false.

### The port

`pixijs-galaxy` was read on 1 September and judged genuinely portable, with four defects to fix **before** copying — cheaper where the playground can see them than after the module is inside Solarity. All four were fixed upstream, and a fifth thing that had only been named was built.

| Defect | Fix |
|---|---|
| **The pure half dragged PixiJS in through one string array.** `buildSnapshot → planetCosmetics → render/planetTexture → pixi.js`. `SURFACE_KINDS` is six strings living in a module that imports the renderer, so the *server-side* data mapper transitively imported the whole of it | `SURFACE_KINDS` moved to `constants.ts`, and the entry point split |
| **The adapter files had never been typechecked** — `tsconfig.json` excluded `src/adapters`, so the only files intended to be copied were the only files with no compiler over them | The exclusion removed. It found three broken relative imports immediately |
| **`dynamic(ssr: false)` cannot live in a Server Component** and Next 16 fails the build rather than the render | `components/galaxy-view.tsx` is `"use client"` and takes the snapshot as a prop |
| **A snapshot update during mount was dropped.** `mountGalaxy` is async; a snapshot arriving while it awaited was lost, and the galaxy showed the state it started with. Unlikely on a slow screen and **exactly what a check-in does** | A ref holds the latest and applies it once the handle resolves |
| Named but not required: **no WebGL context-loss handling.** iOS reclaims contexts from backgrounded tabs and the canvas goes permanently blank with no error | Built. `onContextLost` re-applies the pending snapshot |

**Two entry points, and a test that walks the import graph.**

| Entry | Contains | Safe from |
|---|---|---|
| `lib/galaxy/data.ts` | `buildGalaxySnapshot`, categories, cosmetics, palettes, tiers, every type | A server component |
| `lib/galaxy/index.ts` | `mountGalaxy`, plus `export * from "./data"` | Client only |

`lib/galaxy/data.boundary.test.ts` asserts the data half reaches **no external module at all** — stronger than "not pixi", and a stronger rule is easier to keep. A third case walks `index.ts` and requires that it *does* find `pixi.js`, so a walk that silently resolved nothing would fail rather than pass everything. **Mutation-tested against the real defect**: restoring `planetCosmetics.ts`'s import from `render/planetTexture` turns two of three red with `data.ts reaches pixi.js through render/planetTexture`.

This class of bug is `patterns.md`, "a boundary only the bundler enforces". `tsc` and ESLint both pass on either side of it.

**The background became a token.** `--galaxy-sky` in `globals.css`, read by the component and handed to `mountGalaxy`, so the canvas and the CSS around it cannot disagree. It sits **outside** the light/dark swap on purpose: a galaxy is a night sky in both themes, and a white sky with white stars shows nothing. What the token buys is that the decision is visible beside the other colours instead of being a number inside a renderer.

**ESLint earned its keep on arrival**, catching three ref-during-render writes in the host that the source repo had never linted. They moved into an effect declared before the mount effect, so `pendingRef` still holds the right value when `mountGalaxy` is called.

### The graph pass, and three claims that were false

Run before a line of SQL was written, and the reason none of the SQL is what was planned.

| The plan said | Actually |
|---|---|
| Both writes go inside "the existing `create_goal` RPC", raising `GOAL_LIMIT` in one transaction | **There is no `create_goal` RPC.** A plain insert in `app/actions/goals.ts`, and the comment above it is a decision: "There is no RPC because a single insert governed by RLS is already atomic". `GOAL_LIMIT` arrives as a `check_violation` carrying a hint |
| A backfill script must import the real roll so the distribution cannot drift | **The roll is one coin flip.** `createGoalCosmeticsRoll()` returns `beltVisible` and nothing else; surface kind is already derived from the goal's uuid and radius is left undefined |
| "There is no such field on a goal" (of `hidden`) | `goals.hidden_everywhere`, migration 71, three weeks old |
| `skyClosed` comes from `group_daily_completion` | It does — **the next morning** |

Three of the four are the same mistake: a document describing a codebase from memory rather than from the codebase. The fourth is subtler and is the one worth carrying: the table existed, the column existed, the value was correct, and it was correct **too late**.

### Migration 107: one column, not a table

```sql
alter table public.goals
  add column belt_visible boolean not null default (random() < 0.2);
```

The plan specified a `goal_cosmetics` table — primary key, derived `user_id`, four RLS policies, grants, a second write inside goal creation, and a backfill script. **For one boolean.** The column answers all five of the table's requirements, four of them by construction rather than by care: it is a column of the goal, so there is no `user_id` to forge and no second write; `goals` RLS already governs it; and the `alter` backfills every existing row as it runs, from the same expression that will fill every future one.

**The grants on `goals` were already column-level**, which is what makes it safe without a policy: `authenticated` holds INSERT on exactly `(category_id, deadline, title, user_id)`, so a new column is not writable by anyone until it is granted. Only `select (belt_visible)` was granted. A person cannot choose whether their planet has a belt, which is the v1 decision — cosmetics stored, not editable.

**It rewrites the table on purpose.** Postgres skips the rewrite for a `not null default` only when the default is constant; `random()` is volatile, so the expression is evaluated once per row. A constant-folded default would have given every planet in the app the same answer.

Proved: no nulls; the rate over 5,000 synthetic inserts sits near `PLANET_BELT_CHANCE` in a band wide enough that the assertion is not itself a coin flip; and a negative control — sixty rows in one statement do not all agree, which is what would happen if the default were evaluated per statement. Result on real data: 16 goals, 3 with belts.

**A trigger was chosen and is not needed.** The question asked how the cosmetics *row* should appear and the answer was a trigger on insert; the next answer removed the row. Recorded because the two answers only look contradictory — they were answers to a question that stopped existing between them.

### Migration 108: `skyClosed` was not live

**The finding that cost the most.** `daily_completion` is maintained by triggers on `progress_entries` and `goals`. **`group_daily_completion` is not** — it is written by `run_daily_rollover`, a nightly job. So the Circle-complete moment, the strongest thing the whole feature does, would have played the morning after everyone finished, for nobody.

`private.group_day_closed(p_group_id, p_date)` is now the single definition: every non-grace member has `daily_completion.all_completed` for that date, and a Circle entirely in grace is `false` rather than vacuously true. `private.rollover_group_day` calls it and stores the answer; `circle_roster` calls it and returns it live. **Neither computes it.** Deriving it on the client would have been a fourth copy of a rule migration 71 exists to stop copying, and it would have had to re-derive the grace exclusion to agree.

**Group and date, not cycle**, because the rollover resolved the group as its first act and the rule never needed the cycle. The date is the Circle's day — the owner's — which is what the streak has always been evaluated on.

Two properties it inherits rather than introduces, and they are worth knowing: `daily_completion` is recomputed against the goals active **now**, and `streak_grace` is read as it stands **now**, so a historical date can answer differently today than it did at rollover. That is equally true of the stored row and predates this migration.

### Migration 109: the roster carries what the sky needs

The roster returned no category, for anybody, so a Circle of ten would have drawn nine members in grey. A drop-and-recreate, since the return type changed.

| Added | Level | For |
|---|---|---|
| `category_slug` | goal | The planet's colour |
| `belt_visible` | goal | Its shape |
| `joined_at` | member | Their slot in the sky |
| `all_completed` | member | Whether their sun is lit |
| `sky_closed` | Circle | The Circle-complete moment |
| `achievement_count` | Circle | The ambience tier |

**`joined_at` had to come whether or not it was asked for.** The roster orders itself `is_self desc, joined_at asc` and returned neither term. That order is right for a list — you are at the top of your own roster — and wrong for a sky, where every viewer would see a different arrangement of the same Circle. The layout makes one promise: a member's slot depends only on when they joined, so nobody moves when somebody else arrives. That cannot be kept from a viewer-dependent order, and it cannot be kept from user ids.

**Two dates, and they may disagree.** `all_completed` is each member's own check-in date, matching the counts printed beside it. `sky_closed` is the Circle's. A member in another timezone can therefore have a lit sun under an open sky. That split is not introduced here — it is the one that already exists between a member's roster row and the Circle's streak — and resolving it in a renderer would mean the galaxy disagreeing with one of the two numbers on the page.

**Hidden goals keep their colour and their belt.** Asked three times, including a middle option using `is_self` and one giving hidden goals a deliberately plain shape; confirmed each time. What it costs, recorded so it is a decision rather than an oversight: nine categories with nine fixed hex values means **the colour is the category**, so a coloured untitled planet says you have a hidden goal in, say, Mindfulness & Mental Health. The belt carries no meaning of its own but it is **a stable fingerprint** — the same hidden goal is recognisably the same planet across days. The plain-shape alternative was rejected because a visibly generic planet is itself a tell. Title, note and photo stay masked, and reverting is one `case` expression since `is_self` is in scope.

**The Circle's achievement total is achieved goals across current members**, so the sky dims when somebody leaves and takes their achievements with them. Chosen over completed cycles and the longest group streak knowingly: the Circle is its members.

### The rule the sky shows without softening

`recompute_daily_completion` writes `v_active > 0 and v_done >= v_active` — **zero active goals is `false`, never vacuously true**, deliberate and labelled "Section 3" in migration 34. The rollover then requires every non-grace member, so one member with no goals stops the Circle from ever closing. The galaxy mirrors it: an empty sun, no orbits, and a sky that does not close. Softening it in the renderer would put the sky and the streak in disagreement about the same day.

### Three assertions that failed, and were right to

Two of the three failures in this step were the assertion blocks catching **the migration that contained them**, which is the only evidence an assertion block is doing anything.

| Failure | What it was |
|---|---|
| "rollover_group_day still computes the rule itself" | The check matched on the aggregate's *name*, and the new body contained a comment saying the aggregate had been removed. **A rule about what a function means should be asked of what it reads**, not of its prose. Rewritten to check the tables |
| "group_day_closed is not stable/definer/search_path-pinned" | Postgres stores `set search_path = ''` as `search_path=""`, **with the quotes**. Matching the unquoted form found nothing and failed a function that was correctly pinned |
| "Unknown category slug: health-wellness" | In the readers. `asCategorySlug` guarded with `categoryBySlug`, **which throws rather than returning undefined**, so the fallback for an unknown category was itself the crash it existed to prevent. Found only because a test invented a slug |

And one that passed when it should not have: the belt tests asserted on `planet.belt`, which is always built. `beltVisible` is the flag that decides. **The assertion passed for both values of the thing it was testing.**

### The rolled-back proofs

`private.group_day_closed`, six cases, every write discarded by a deliberate `raise`:

| Case | Answer |
|---|---|
| everybody completed | closed |
| one member has no row | open |
| one member open | open |
| that member in grace | closed |
| every member in grace | open |
| a date with no rows at all | open |

They were necessary because the migration's own equivalence assertion compares against real data, which is 30 (group, date) pairs and contains **no member in grace at all** — so the half of the rule most likely to be got wrong was not exercised by it.

`circle_roster`, as a real circle-mate: a visible goal carries title, slug and belt; the same goal hidden carries a **null title** with slug and belt intact; a non-member is refused with `NOT_A_MEMBER`. **The first run reported the visible control as having no title**, which looked like masking leaking onto everything. It was not — the goal picked at random was already hidden. A negative case that was never positive proves nothing.

### The readers

`lib/galaxy/solarity/snapshots.ts` — `buildPersonalSnapshot` and `buildCircleSnapshot`, 12 tests. It imports `../data` rather than `../`, so the seam between Solarity and the renderer cannot drag PixiJS into a server component.

One test earns its place beyond the mapping: `GOAL_CATEGORIES` is pinned against the nine slugs the database seeds, written out by hand, because a unit test cannot reach the database. A tenth category added on one side and not the other now fails by name instead of turning one planet grey in production.

### The audit

| Check | Result |
|---|---|
| **Do the committed migration files match what the server runs?** | **Byte for byte.** `md5(prosrc)` of `circle_roster`, `group_day_closed` and `rollover_group_day` computed from the repo files equals the server's |
| Does anything but the client host import the renderer? | **No.** One file imports `@/lib/galaxy`; everything else takes `@/lib/galaxy/data` |
| Is `private.group_day_closed` reachable by a client? | **No.** Absent from the advisor's list of definer functions `authenticated` can execute, which every other RPC appears on. `authenticated` holds USAGE on `private`, so without the revoke it would have been callable for any group id |
| New security findings? | **None.** Every advisor warning predates this step |
| Does anything read `goals` with `select *`? | **No.** A new column cannot leak through a wildcard |
| Do the roster's consumers break on four new columns? | **No.** `getCircleRoster` spreads rather than listing columns |
| Does the sky degrade safely if a Circle has no owner? | **Yes**, and it was worth asking: `v_circle_date` would be null, the date join matches nothing, and `sky_closed` comes back false rather than erroring. No Circle is ownerless and none has two owners |

**Totals**: 212 unit tests, `tsc` clean, ESLint clean. `npm run build` is **not** among them — `pixi.js` is in `package.json` and not installed, and the build is the only thing that can see a bundler-level boundary leak.

---

## Step 22: the galaxy lands on Overview, and the resize bug is found ✅ done

3 September. The panel, and the end of a bug that had survived two fixes.

### The panel

`lib/supabase/galaxy.ts` reads your goals, today's entries and your achieved goals, and hands them to `buildPersonalSnapshot`. **Deliberately separate from `getTodayData`**, which is the one implementation of "what is checked off today": this is a different projection of the same rows — slugs rather than hexes, `belt_visible`, and the achieved goals `/today` would otherwise pay for on every visit. What it does *not* re-read is `daily_completion`; `dayClosed` is passed in, so the sun and the fraction printed above it are the same fact.

`dashboard/galaxy-panel.tsx` is the client boundary and the only thing that mounts a canvas. The page stays a server component and hands the snapshot down as a prop.

**Three things found by putting it on a screen:**

| | |
|---|---|
| **`mountGalaxy`'s rejection was unhandled** | `Application.init` rejects when WebGL is refused — disabled, out of GPU memory, a virtualised browser — and nothing caught it. The host would have sat on its skeleton forever, which reads as the app being broken rather than as the galaxy being absent. `GalaxyView` gained `onReady` and `onUnavailable`; the block now removes itself and the page closes up, with no message, because nothing the person came for is missing |
| **`compact` was being forced** | The panel passed `compact` as a prop, and `mountGalaxy` resolves `opts.compact ?? isCompactLayout(host)` — so supplying it *replaced* the module's own measurement instead of defaulting it. Every screen got the phone's projection, including a 27-inch monitor. The prop is gone; the module measures |
| **`h-56` was below the compact threshold anyway** | `isCompactLayout` is `width <= 420 \|\| height <= 320`, and 224px fails on height at any width. `h-64 md:h-96` clears it on desktop, which is why the panel "looked short" — it was being drawn for a phone |

**It sits first on the page.** It was under Today for one release, on the argument that the thing you came to do should lead. That is true of the *goals*, which are one scroll away either way; Overview's job is to say where you stand, and the galaxy says it in the form worth looking at. The cost is that the block most likely to be absent is the first one, which is survivable because it removes itself cleanly.

**The boundary test grew a case.** `lib/supabase/galaxy.ts` is `server-only` and reaches `solarity/snapshots.ts`, so that file is in a server graph now — and it is one hop from `../data`, exactly where a convenient `from "../"` would go unnoticed. Extending the walk also exposed a defect in the walk itself: **`@/lib/roster` was being counted as an external package**, so the new case would have passed by never opening the file. The walk follows the alias into the repo now.

### The resize distortion, third attempt and the last one

**The fix was the previous fix.**

`Galaxy.layout` recomputed the camera fit and kept it only when it shrank:

```ts
const needed = this.fitScaleForReach(this.measureClusterReach());
if (needed < this.baseFitScale) { … }
```

That one-way rule was written to stop a split-pane drag rescaling the scene under the cursor, and it half worked: the galaxy stopped growing, and it also stopped **recovering**. Drag a pane narrow and back and it stayed small. Wiggle it and the galaxy shrank monotonically toward nothing, because every smaller viewport was remembered and no larger one ever was. **A one-way rule made the scene stateful about window history**, which is the one thing a viewport should never be.

`layout` now assigns the fit unconditionally, as `settleReach` and `endReachAnimation` — the other two assignment sites — always did, and consults `shouldAutoFitCamera` before moving the *displayed* fit, which `layout` never did at all. So somebody who had panned or zoomed no longer has their view yanked back by a resize.

**"Resizing shows more sky, it does not zoom" is still honoured**, by the clamp rather than by the ratchet: `fitScaleForReach` is `Math.min(1, …)`, so once the content fits, a bigger window changes no scale.

**Why it took three attempts.** The first stopped an orbit refit that was re-running with nothing to fit — a real bug, and not this one. The second found `isCompactLayout` flipping the tilt from 0.95 to 0.5 as a pane crossed 420px, which squashes every orbit ellipse from 0.81 of its width to 0.48 — also real, also not the whole of it, and the reason the mode is now decided once at mount. Both were confirmed by the observation that **no non-uniform scale exists anywhere in the scene graph**, which was true and pointed away from the answer: `fitScaleForReach` uses `min(width, height)`, so the distortion was uniform scaling against a frame that was not.

The test that replaced the old one asserts the property rather than a direction — **the same viewport gives the same fit, whatever route it arrived by** — plus that a wiggle does not accumulate and that a window past the fit rescales nothing. Mutation-tested: restoring the ratchet fails it with "a bigger viewport drew the galaxy smaller".

---

## Step 23: the galaxy's controls, and expanding it ✅ done

3 September. The interaction, and it is all in the module rather than in a prop.

### One bar, two sets

`attachCameraControls` takes a `touch` flag. A mouse in a wide window gets everything; a finger gets **reset and the four pans, and nothing else.**

The split is `(pointer: coarse)` **or** a compact host, whichever is more restrictive — two conditions rather than one, because either is wrong alone: a phone-sized desktop window is not a touch device, and a large tablet is. A device that lies about one of them gets the more forgiving set.

**Pan looks redundant next to a pannable canvas and is not.** A one-finger vertical drag belongs to the page, so those four buttons are the only way to move the view up or down at all. Reset stays because it is the undo for every other gesture. Zoom goes because pinch is better at it.

**The viewing angle is the real casualty**, and it is asserted rather than dropped quietly: a drag cannot reach tilt on a compact host, so on touch it becomes unreachable. The test names it so it is a decision somebody revisits rather than a gap somebody finds.

### One finger scrolls, two fingers pan

`touch-action: pan-y` already handed vertical drags to the page. It did not stop a **horizontal** one-finger drag panning the galaxy — so the gesture that scrolls and the gesture that pans differed only by angle, and a diagonal thumb did both.

One finger no longer pans on a touch surface. Two do: the pair pinches to zoom, as before, and now also pans from **the midpoint of the two fingers**. The midpoint is what stops the two fighting — pinching moves it hardly at all, so a pinch that drifts reads as one gesture rather than two.

**Decided from `pointerType`, not from the host.** A laptop with a touchscreen has both, and the right answer depends on which is in use at that moment; a mouse or a stylus still drags with one pointer on the same surface.

### The bar is the app's, drawn on the galaxy

Dark chips and a gold hover became `border: 1px solid currentColor`, transparent, `opacity: 0.7` until hover — the app's own hierarchy rule, resolved light because it sits on a night sky rather than on the page. `currentColor` throughout, so a host that wants another colour sets one property instead of restating four rules. A focus ring was added: opacity alone is not a focus indicator.

**Controls are on for the panel in both states.** The module's default is "controls only on a compact host", which is backwards for an embedded panel — the desktop one is the surface a mouse can reach and the one where the viewing angle is worth changing.

### Expanding

**The same canvas, resized.** The host div stays mounted and only its classes change, so the mount effect never re-runs, `resizeTo: host` picks up the new size, and the scene keeps its camera, its animation and its GPU resources. A modal rendering its own `GalaxyView` would pay for a second WebGL context and start from a cold camera every time.

`position: fixed` leaves the document alone, so the page is exactly where it was when this closes, and nothing locks the body scroll — the overlay is opaque and full-screen, and a lock is a thing to remember to undo. Escape closes it.

**A button rather than a tap on the canvas**, which is a departure from the decision as taken, with a reason: tapping a planet already opens that goal, so a bare tap-to-expand would have had to guess which the person meant from where their thumb landed. A named control is also the only version a keyboard can reach.

### The tests

`cameraControls.test.ts` is new and is the one part of this module a jsdom test can see completely. It asserts both button sets by accessible name, that the arrows move the *view* the way they point (`panBy` moves the content, so the signs are inverted — they were backwards once and read as broken), that the angle button cycles rather than settling, and that `detach` takes the bar away so a host that mounts twice does not end up with two.

**218 tests in Solarity, 202 in the module.**

---

## Step 24: the Circle's sky ✅ done

3 September. **The screen the whole project was for**, and by this point it was mostly wiring: the renderer had the topology, migration 109 had the data, and `buildCircleSnapshot` had the mapping with twelve tests over it.

### One card, two surfaces

The dashboard panel and the Circle sky differ in **what a tap on a planet means** and in nothing else, so the shell moved to `components/galaxy-card.tsx` — heading, frame, skeleton, expand control, camera move, the WebGL-absent path. Two files that each carried a copy would have agreed only until one of them changed.

| Surface | A planet tap |
|---|---|
| Overview | Opens that goal. A shortcut to a page the list below already links to, never the only way there |
| A Circle | **Nothing.** These are other people's goals: a hidden one has no destination at all, the rest are named in the row below, and a canvas that navigated on a mis-tap would be doing worse what the roster does well. Tapping a *sun* still flies to that member, which is the module's own default and is about looking rather than going |

### Built in the client, from the roster the page already had

`buildCircleSnapshot` is a pure function over `RosterMember[]`, behind `lib/galaxy/data`, which is proven to reach no renderer code. The roster is already going over the wire for `TodayRoster`, so serialising a second derived copy of the same facts would double the payload for a picture of what the list beside it says.

### A frozen Circle, answered partly and said so

An archived or locked Circle's roster is frozen at a past instant. The backdrop is switched off — a sky that keeps drifting implies live data where there is none — but **the orbits still turn**, because the module has no pause and adding one is scene work rather than a prop. Named in the component rather than left for somebody to notice.

### The viewhole learned that a frame can sit in the middle of a page

On Overview the galaxy leads and everything else is one block beneath it. On a Circle the sky sits between the tabs and the roster, and **a wrapper cannot be discontiguous** — so `PageBlocks` gained `where="before"`, and `globals.css` a second name. A `view-transition-name` must be unique per document, so the two regions are named separately; they animate identically, because the split is a fact about layout rather than a second behaviour.

The first version put the provider inside the Today branch and left the header and tabs outside it. That worked — the overlay is opaque, so they were covered — but they sat still while the roster moved, which is the class of thing that reads as clunky. The provider wraps the page now.

---

## Step 25: onboarding asks for one goal ✅ done

3 September. A person used to finish setting up with a username and an empty app — and the dashboard's whole subject is goals, a Circle is about whether people finished theirs, and the galaxy draws a sun with nothing orbiting it. **The first screen after signing up was the emptiest the product will ever be**, and it is the one where somebody decides whether to come back.

### The three decisions

| | Taken |
|---|---|
| Skippable? | **No.** Every account reaches the app with something to check off tonight, and the empty dashboard stops existing for new accounts. The cost is stated rather than hidden: somebody who cannot think of a goal is on a form they cannot leave, and an outage in this one write blocks sign-up |
| One screen or two? | **Two.** Each screen asks one thing, and a goal field under the username would lengthen the one screen where a long form costs most |
| Which write first? | **Username, then the goal.** `complete_onboarding` stays the last thing that must succeed for the account to be usable; abandoning between the two leaves a complete account with no goal, which is a state the app already handles. The reverse would leave a goal on an account with no username — recoverable, but a state nothing has ever produced |

### Where it sits

`/onboarding` → **`/onboarding/goal`** → `/onboarding/install` → `/onboarding/notifications`.

Immediately after the username and **ahead of the two nudges**, because it is the only required step of the four. A requirement placed behind two things a person may decline is a requirement placed where they have already started saying no.

### The gate is "never had a goal", not "has none now"

**Deliberately, and it needs no new column.** Goals have no DELETE grant — archiving and achieving both leave the row — so "this account has never created a goal" is a question the `goals` table already answers, and it is true of exactly one population: accounts that have not been through this screen.

The other reading would drag an existing person who archived their last goal back into onboarding, which is a gate applied to somebody who has already passed it. This codebase has shipped that shape before, and `patterns.md` carries it.

It costs one `head` count on an indexed column, and it lives in **`(app)/(shell)/layout.tsx`** rather than one layout up. That placement was a fix rather than a first draft — see the audit below.

### It writes through `createGoal`

Not a second insert path. That action carries the title length check, the profanity screen, the rate limit, the category lookup by slug rather than by uuid, and the first-goal marker that stops the person being thrown at the daily check-in screen the moment they arrive. **The step that makes a first goal universal is the step that most needed that marker to exist.**

The action returns a result rather than redirecting, because four other callers need it to; the form navigates on success, which keeps the action ignorant of which screen called it.

### The test, from the direction that is safe

`gates.spec.ts` asserts that an account which already has goals is sent onward from `/onboarding/goal` — the half most likely to be got wrong. The opposite case needs an account with no goal row that has ever existed, and manufacturing one means deleting rows the app itself cannot delete.

---

## The suite, green again, and what the three failures were ✅ done

3 September. The first full run since the galaxy, three migrations and two new gates. **Every failure was a precondition, and none was a product defect** — which is the pattern this suite keeps producing and the reason it is worth running.

| Failure | What it was |
|---|---|
| `goals_achieved_not_future` on an achieve | **A client's clock is not the database's.** The test sent `new Date().toISOString()` at a CHECK evaluated as `achieved_at <= now()` in Postgres, so it failed whenever the runner ran even milliseconds ahead. Both writers now send the string `"now"`, which Postgres resolves to the transaction time — the clock that judges the value is the clock that mints it. `goals.spec.ts` had always done it that way; this file was the odd one out |
| "no labelled file input for this goal" | **A race the error message disguised.** `click()` returns when the click dispatches, and the photo control does not exist until there is a `progress_entries` row to attach it to. The page snapshot showed the row mid-flight — `button "…" [disabled]` — so a five-second assertion was racing a round trip and reporting it as missing markup. It waits for `Undo`, which is the real completion signal; raising the expect timeout would have made it slower to fail and charged every other assertion for one action's latency |
| Two accounts sent to `/onboarding/goal` | **Step 25's gate, twice.** `auth.setup.ts` demanded a goal of the admin account, which has never created one because moderation has nothing to do with goals — the same fact that moved the gate out of `(app)/layout.tsx` in the first audit. And `sign-up.spec.ts` mints its own account, which had none |

### The one worth keeping

Fixing the sign-up spec by **seeding a goal armed a different gate**: an account with an unchecked goal has an unfinished day, so `/dashboard` diverted to `/today`. Fresh accounts default to `once_daily` and the three fixture accounts are set to `never` by `auth.setup.ts` for exactly that reason.

**A test that mints its own account owes it every precondition the shared fixtures are given, and `auth.setup.ts` is the list of what those are.** Reading that file would have produced one fix instead of two.

---

## The Circle's rings, and whose galaxy this is ✅ done

3 September, from looking at a real Circle.

### The rings had been rounded away

`orbitStrokeAt` multiplied the stroke width by the cluster legibility, and `clusterRingLegibility` floored at 0.35 — so at ten members a ring was **0.44 physical pixels**. A sub-pixel line is not a faint line: the rasteriser blends it into the background and it is gone. A Circle drew suns with loose planets and no orbits.

Two changes, and the second is the real one:

- the floor is 0.62
- **the dimming is spent on alpha, and the width keeps most of its weight**, with 0.9px as the floor below which a stroke stops being a stroke. A line that reads as thinner is mostly a line that reads as dimmer

**Nothing had ever constrained the weight of a ring** — the existing tests covered colour and cleanup — which is why it could regress silently. The new one asserts both the pixel floor and that a crowded Circle keeps more than 70% of a solo galaxy's width, and it is mutation-tested: restoring `width * legibility` fails it at 0.775.

### Hovering a member says whose it is

`onSystemHover(systemId | null, x, y)` on the scene's host interface, bound to **the planets as well as the sun** — in a Circle the planets are what a cursor lands on, since the sun is one small disc and the orbits are wide.

**The label is DOM, not canvas.** The scene draws no text and is not going to: a name rendered by the host is styled by the app, selectable, and needs no font atlas in a WebGL context that is already the largest thing on the page. The module reports a member and a position; the host decides what to say.

| Decision | Why |
|---|---|
| Circle only | A solo galaxy has one system and it is yours. A label naming you, over your own sun, on your own dashboard, says nothing |
| `{username}'s galaxy` | The username first, matching `today-roster.tsx`'s own rule: `display_name` is not unique and two people can hold the same one, so a hover reading "Sam's galaxy" twice in one Circle names nobody |
| `aria-hidden`, `pointer-events: none` | The roster underneath already names every member in order, in text. And a label under the cursor would trigger its own `pointerout` and flicker |
| Nothing on a coarse pointer | Hover is a mouse idea; on a phone it fires around a tap and the name would stick with nothing to dismiss it |

**ESLint caught the first attempt at clearing it**: `setState` inside an effect, which `patterns.md` already names, with the previous-value pattern as the answer. It is that now.

---

## The second audit: the whole diff against the bug list ✅ done

3 September. The first audit read the new code for defects. This one walked **every file in the diff against `patterns.md`'s forty-nine shapes**, one shape at a time, which found things reading for defects did not.

Twenty-four files changed, three migrations added, and the four findings below.

### 1. A shipped fix, reintroduced, on the one screen nobody can skip

`first-goal-form.tsx`:

```html
<option value="" disabled>Pick one</option>
```

`goals-panel.tsx`, thirty lines of comment, since step 16:

> **Not `disabled`, and that is the whole fix for iOS.** iOS renders a `<select>` as a wheel and skips disabled options entirely. With the placeholder disabled the wheel opened showing the first real category *highlighted* while the element's value was still `""`, so tapping Done moved nothing, fired no `change`, and submitted an empty category.

The same defect, on **the screen most likely to be met on a phone and the only one in the app nobody can skip**. Writing a new form is exactly when a fix that lives in another form gets lost, and neither `tsc` nor ESLint has an opinion about a boolean attribute.

**Found by the checklist, not by reading the file.** "A platform that renders your control differently" is one row of a table, and it names the markup.

### 2. A gate that treats a failed read as "no"

`(app)/(shell)/layout.tsx`:

```ts
const { count: everHadAGoal } = await supabase…
if (!everHadAGoal) redirect("/onboarding/goal")
```

A failed count comes back as `count: null`, so `!everHadAGoal` conflates "I could not tell" with "definitely none" — and this is a gate, so the cost is **sending an established account into onboarding because one read hiccuped**. `patterns.md`, "a default that answers a question the read never answered": for anything a person will act on, absence and failure are not the same, and the fix is a third state rather than a better default.

The third state is "carry on": someone who has passed the gate sees their dashboard, someone who has not is asked again on the next navigation.

`getPersonalGalaxy` had the same shape with a quieter cost — `(goals ?? [])` draws a bare sun, which is a *claim* the read never made. It returns null now and the panel removes itself, which is the honest answer for an additive surface.

### 3. The setup project did not assert the new precondition

`patterns.md`: **"a new gate is a new precondition for every signed-in test"** — the terms interstitial shipped correct in step 20 and broke ten tests across four files, each naming a missing landmark on a page it was never on.

All three accounts have goals, so nothing would have failed today. But the check now lives in `auth.setup.ts`, because the failure it produces names the account and the reason, and the failures it prevents name neither.

### 4. PostgREST was serving a schema from before migration 109

`circle_roster` was **dropped and recreated with four more columns**. The signature is unchanged, so this is milder than the `PGRST202` case in the bug list — but the shape is the same one, and the remedy costs nothing: `notify pgrst, 'reload schema';`, run.

### Shapes checked and found clean

| Shape | Where it would have been |
|---|---|
| A client's clock is not the database's | The only new timestamps are `"now"` in `circle-activity.spec.ts` and `getCheckinDate` in `createGoal` — both the database's |
| A function in `public` is an API endpoint | Migration 108's function is in `private` with `execute` revoked; 109 restates the roster's grants. `get_advisors` clean |
| A cast standing in for a check | `asCategorySlug` casts **after** a membership test; the `startViewTransition` cast is behind a feature check |
| A boundary only the bundler enforces | `data.boundary.test.ts` walks it, and the first audit moved `GalaxyView` behind `dynamic` |
| A control that moved, asserted through a landmark | Every `getByRole("region")` in the suite is named; the new sections are `Your galaxy` and `This Circle's sky` |
| Cleanup that only runs on the happy path | The new gates test creates a goal titled `E2E …`, which `deleteE2EGoals` reaches by prefix even if a timeout skips the `finally` |
| An assertion that cannot fail | The resize and boundary tests were mutation-tested; the new gate test fails if the redirect is removed |
| Stale `useActionState` outliving what produced it | `FirstGoalForm` navigates on the result and remounts on return |

---

## The audit over steps 22 to 25 ✅ done

3 September, run over the galaxy surfaces, the viewhole and the onboarding gate. **Three defects, and the first would have locked an account out of the app.**

### 1. The goal gate stood in front of `/settings` and `/admin`

It was written into `(app)/layout.tsx`, which wraps **every** signed-in route — not just the ones about goals.

Found by asking the database which accounts the gate would divert, rather than by reasoning about it:

```
username      goals_ever   active_now
ryahnadmin             0            0
ryahn3                 1            1
ryahn1                 2            2
ryahn2                14            3
```

**The admin account has never created a goal**, because moderation has nothing to do with goals, so the console became unreachable behind a form asking it to name one.

And the sharper consequence, which the admin case only pointed at: somebody who signs up, abandons at the goal step, and later wants to **delete their account** could not reach `/settings` to do it. **A gate that stands between a person and leaving is not a nudge.**

The gate belongs to the product loop, so it now guards the loop's screens: `(app)/(shell)/layout.tsx`, which is `/dashboard`, its sections and `/profile`. Every session starts there, so nobody who skipped gets far; `/settings`, `/admin`, `/today` and `/circles/[id]` stay reachable. The shell layout is cached across section switches, so it also costs one count per visit rather than one per tap.

**A query that names the affected population is worth more than an argument about who is affected.** The reasoning for "never had a goal, not has none now" was right and the placement was wrong, and only the data showed which.

### 2. The whole renderer was in the client bundle of both surfaces

`GalaxyCard` imported `GalaxyView` directly, and `GalaxyView` statically imports `pixi.js` — so the renderer landed in the client bundle of **Overview and a Circle's Today tab**, which between them are most of the app.

That is exactly what the handoff's `dynamic(ssr: false)` arrangement existed to prevent, and part 1 of the plan named it as one of four defects to fix before copying. It was fixed in the port and then lost again by a component that imported the component the ordinary way.

Now `dynamic(() => import(...), { ssr: false })` inside the card, which is legal because the card is a Client Component — Next 16 forbids `ssr: false` only in a Server Component, and that is the reason the boundary is drawn at this file rather than at the page. No `loading` option: the card already renders a skeleton until `onReady`, and a second placeholder underneath it would be two answers to one question.

### 3. `useViewhole` outside a provider was a new object every render

```ts
useContext(ViewholeContext) ?? { open: false, setOpen: () => {}, onCommit: () => () => {} }
```

A fresh identity per render, `onCommit` included — so every effect keyed on it would tear down and re-register on every render, forever, on any page that rendered a card without a provider. Not a loop and not visible, which is the kind that survives. Frozen at module scope now, so the no-provider case is as stable as the real one.

### What was checked and found sound

| | |
|---|---|
| The gate cannot loop | `/onboarding/goal` is outside `(app)`, like `/onboarding` and the two nudges |
| `view-transition-name` uniqueness | One frame per page, and the two `PageBlocks` regions are separately named. A second card on one page would break it, and the CSS says so |
| The e2e accounts | All three have goal rows that have ever existed, and `withNoActiveGoals` archives rather than deletes — so the suite does not trip the new gate |
| Section labels | `galaxy-heading` and `circle-galaxy-heading`, so a page with both would not collide |
| The commit hook's lifetime | Registered in an effect, unregistered on cleanup, and `handle.resize()` is a no-op after destroy |
| The frozen-Circle path | `ambientEffects={false}`, with the orbits still turning — a partial answer, named in the component rather than left to be found |

---

## The first goal, and the gate it tripped ✅ done

3 September, reported from real use: **adding a goal threw you straight into the daily check-in screen.**

`hasUnfinishedDay` is two conditions — at least one active goal, and an incomplete day. The second has always been true for a new account; the first is what kept the gate quiet. So the very first goal satisfies both at once, `revalidatePath("/dashboard")` re-renders the shell, and the person is redirected off the screen they were in the middle of setting up. **In the same breath as pressing Add.**

`createGoal` now reads whether there were any active goals **before** the insert, and writes the today marker when there were none. Three narrower and wider options were considered:

| Option | Why not |
|---|---|
| Any goal creation defers the prompt | Simplest, and it weakens the daily prompt for everyone to fix a first-run problem. Someone who adds a goal at 9am and never checks in loses the nudge for the day |
| Never divert on a render that followed a write | The most precise reading of the bug — the gate should fire on arrival, not on a revalidate — and a server component has no signal for it. The most machinery for the same outcome |
| **Only the first goal** | Chosen. An existing user adding an eleventh goal genuinely does have an unfinished day, and being told so is the product working |

**The marker rather than a skip.** It is already per device and per day and already means "do not divert me", so there is no second mechanism to keep in step and the prompt returns tomorrow on its own. The date comes from the database, the same way `markTodaySeen` reads it — a client value would let a stale tab suppress the wrong day.

Covered by `gates.spec.ts`, using the `withNoActiveGoals` fixture that already existed, and asserting **both** that the redirect does not happen and that a fresh navigation to `/dashboard` afterwards still does not redirect. The first assertion alone would pass if the marker were never written and the revalidate simply had not re-run the layout.

---

## The index: every numbered step, and where its reasoning is

**All twenty-one are built, and the unit suite is green.** Step 20 was the last functional work before the galaxy; step 21 is the galaxy's data half. What remains of it — the two screens and the design system — is in `build-plan.md`. Everything in this table is written up above, in this file.

| # | Step | State |
|---|---|---|
| 1–7 | Auth, Circles, goals, check-ins, the Circle page, invites | ✅ 12–14 Aug |
| 8 | Seeing each other | ✅ 17 Aug, migrations 68–75 |
| 9 | The daily check-in flow | ✅ migration 76. `/today`, the gate, the streak header |
| 10 | Install nudge, then push permission | ✅ migrations 77–78. **Manual pass done on an iPhone**; its eight flows are kept in `history.md`, because a permission dialog is one-shot per browser |
| 11 | Digest boxes on Overview | ✅ no migration. Five day boxes, a per-Circle roll call, digests out of the Notifications tab |
| 12 | Security headers | ✅ no migration. Nonce CSP, HSTS, `Permissions-Policy`. **`E2E_PROD=1 npm run test:e2e:ios` before any deploy**: the dev CSP is not the one that ships |
| 13 | Check-in photos | ✅ migrations 79–82. **Manual pass complete on a real iPhone**, including portrait EXIF orientation and a HEIC from the camera roll. **JPEG, not WebP** — Safari cannot encode WebP |
| 14 | What the loop deferred | ✅ migrations 83–84. Dashboard route segments, the code graph, achieving a goal, goal deadlines, account deletion. Also fixed `/robots.txt` and `/sitemap.xml`, which the proxy had been redirecting to sign-in |
| 15 | Profiles, and the moderation surface they carry | ✅ migrations 85–90. `/profile`, avatars, the stats toggle, blocking, reporting |
| 16 | The goal record | ✅ **no migration.** A fifth tab: `/dashboard/goals`, `/archived`, `/[id]` — every control, and a row per check-in day |
| 17 | The admin dashboard | ✅ migrations 91–95. Site roles, the report queue, triage, and who may moderate |
| 18 | Inviting a person, not a link | ✅ migrations 96–100. Username search, an invite that arrives as a notification, and a join page that says who is already inside |
| 19 | A Circle that talks back | ✅ migrations 101–104. Four intraday notification types, four per-type switches, coalesced activity, and the copy variance that stops a daily notification going stale |
| 20 | The front door | ✅ migrations 105–106. Email and password auth, terms acceptance, Turnstile wired, a landing page and `/support` |
| 22 | The galaxy lands on Overview | ✅ no migration. The panel, the WebGL-absent path, and the end of the resize distortion |
| 23 | The galaxy's controls, and expanding it | ✅ no migration. Two button sets from one bar, two-finger pan, and expand-in-place on the same canvas |
| 25 | Onboarding asks for one goal | ✅ no migration. A required step after the username, gated on "never had a goal" |
| 24 | The Circle's sky | ✅ no migration. `GalaxyCard` shared by both surfaces, the sky above the roster, and a viewhole that can sit mid-page |
| 21 | The galaxy ports, and the sky gets its data | ✅ migrations 107–109. `lib/galaxy` with two entry points, the client host, `goals.belt_visible`, `private.group_day_closed`, and a roster that can describe a Circle's sky |

**What that means.** A person can sign in, set goals, check them off with a note and a photo, invite a friend **by name** into a Circle, see who finished today, hear about it while the day is still going, keep a streak, and read a five-day digest. **The premise the product exists to test is now testable.**

**What it does not mean.** Nothing has shipped to anyone yet. That sentence used to continue "and the only way in is a Google button on a page that explains nothing" — step 20 closed exactly that, and it is kept here because the gap is what the step was for. What is left before anyone outside the two test accounts sees it is the design pass, a device run over the five new auth screens, and a regenerated code graph.
