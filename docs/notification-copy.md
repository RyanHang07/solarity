# Solarity: Notification Copy

Every string a person can receive, in one place. **Edit the "New" column and nothing else**; the two source files are updated from this.

**The push half is shipped** (10g, `send-digest-push` version 7). The in-app column is still open for editing.

**Rows 10–16 now describe a shorter list.** Since 11c the Notifications tab renders only the four event types, so the `digest` line below is what the *panel* would say if one ever arrived — it cannot, because the query filters by type. The digest content people actually read is the day boxes on Overview.

| Where it lives | File |
|---|---|
| Push bodies | `supabase/functions/send-digest-push/teaser.ts` — split out so `lib/teaser.test.ts` can reach it |
| In-app lines | `app/(app)/dashboard/notifications-panel.tsx`, `describe()` |

---

## The problem this file was opened for

**Four Circles produce four identical notifications.** Every push title is the literal string `Solarity`, and no push body names the Circle, so a phone showing four digests shows the same sentence four times. The `tag` is `circle-{group_id}`, so they do not even collapse into one.

**It was deliberate.** The edge function's header keeps Circle names off lock screens because a name is visible to anyone holding the phone, outside the app's access controls. That reasoning is sound and the result is still unusable, which is why the fix is a **per-user setting** rather than a reversal: names on by default, off for anyone who wants a contentless lock screen.

---

## Push bodies

Title is currently `Solarity` for every one of them. **If a name goes anywhere, the title is the place**: iOS renders it largest and groups by it, so four Circles read as four lines rather than one repeated four times.

| # | Type | Condition | Current | New |
|---|---|---|---|---|
| 1 | `digest` | `done === 0` | Nobody checked in yesterday — tap to see | **one of four**, see *Variance* below |
| 2 | `digest` | `done === total` | Everyone checked in yesterday — tap to see | **one of four, or five with a streak** |
| 3 | `digest` | otherwise | `{done}` of `{total}` checked in yesterday — tap to see | **one of four** |
| 4 | `deadline_changed` | `cleared` | A circle is now open-ended — tap to see | `{circle}` is now open-ended |
| 5 | `deadline_changed` | otherwise | A circle's deadline changed — tap to see | `{circle}` changed its deadline |
| 6 | `kicked` | | There's an update about one of your circles | **unchanged** |
| 7 | `group_locked_renewal` | | A circle's cycle has ended — tap to decide what's next | `{circle}` has finished its cycle — tap to decide what's next |
| 8 | `invite_accepted` | | Someone joined your circle | Someone joined your circle, `{circle}` |
| 8b | `invited` | | You've been invited to a circle — tap to see | `{who}` invited you to `{circle}` |
| 8c | `goal_achieved` | | — | `{who}` achieved a goal in `{circle}` — **never the goal's title** |
| 8d | `circle_first_finisher` | | — | **one of four**: `{who}` is first to finish in `{circle}` · `{who}` is out of the gate first in `{circle}` · `{who}` got there first in `{circle}` · First one done in `{circle}`: `{who}` |
| 8e | `last_one_left` | | — | **one of four**: You're the last one in `{circle}` · `{circle}` is waiting on you · Everyone else is done in `{circle}` · Just you left in `{circle}` |
| 8f | `circle_activity` | one name | — | `{who}` **{got started / is off the mark / has begun}** in `{circle}` |
| 8g | `circle_activity` | two | — | `{who}` and `{who}` **{got started / are off the mark / have begun}** in `{circle}` |
| 8h | `circle_activity` | three or more | — | `{who}` and `{n}` others **{got started / are off the mark / have begun}** in `{circle}` |
| 9 | unknown type | | You have a new notification | **unchanged** |
| T | **title**, all types | | Solarity | **unchanged** — see below |

## Variance (step 18f)

**A digest arrives every day, forever.** Naming the Circle made four Circles distinguishable from each other; nothing made today distinguishable from yesterday, and a sentence you have read two hundred times is one you stop reading. Rows 1–3 are the only shipped push bodies that repeat, so they are the only ones that vary.

**Seeded by the notification's own id**, hashed with FNV-1a inside `teaser.ts`. One stable sentence per row: a redelivery says what the first attempt said, and `lib/teaser.test.ts` can keep asserting exact strings by passing a known id. Random would have broken both. A date rotation would have made four Circles read identically again on any given day, which is the problem this file was opened for.

Measured over 40,000 random v4 uuids, a four-set lands 25.2 / 25.1 / 25.0 / 24.7.

**An unseeded call returns the first variant**, which is always the sentence that shipped. FNV's offset basis is 1 modulo 4, so without that guard an unseeded call would land on the *second* variant: deterministic, arbitrary and quietly different from the copy every existing test asserts.

| Row | With a name | Without one |
|---|---|---|
| 1, nobody | `{circle}`: nobody checked in yesterday · A quiet day in `{circle}` · `{circle}` had a quiet one · Nothing logged in `{circle}` yesterday | Nobody checked in yesterday · A quiet day · Nothing logged yesterday · A quiet one yesterday — **all keep "— tap to see"** |
| 2, everyone | `{circle}`: everyone checked in yesterday · Clean sweep in `{circle}` yesterday · All of `{circle}` finished yesterday · `{circle}` went `{total}` for `{total}` yesterday · **+** `{circle}`: everyone finished, `{streak}` days running | Everyone checked in yesterday · A clean sweep yesterday · Everyone finished yesterday · `{total}` for `{total}` yesterday |
| 3, some | `{circle}`: `{done}` of `{total}` checked in yesterday · `{done}` of `{total}` finished in `{circle}` · `{circle}` came in at `{done}` of `{total}` · `{done}` of `{total}` made it in `{circle}` | `{done}` of `{total}` checked in yesterday · `{done}` of `{total}` finished yesterday · `{done}` of `{total}` made it yesterday · Came in at `{done}` of `{total}` yesterday |

**The fifth variant of row 2 needs a streak above one.** `group_streak` is 0 on a Circle's first perfect day and 1 the day after a reset, and "everyone finished, 1 days running" is ungrammatical as well as pointless. It is the one variant whose availability depends on the payload rather than on the seed.

**Row 1 is neutral by decision.** Four ways of saying a day was quiet, none of them disappointed, because this is the message most likely to arrive three days running and the one where a variance set could quietly give the product a voice that punishes people.

**The withheld-name fallbacks vary too.** Those are the ones that read most identically, precisely because the Circle name is what distinguishes the others. Counts stay — `{done}`, `{total}` and `{streak}` are numbers, not identifiers — and `{who}` is withheld with the Circle name, the rule settled for `invited`.

**Rows 8f–8h are the only body with three grammatical forms.** The verb varies and the sentence shape does not, so the plural cannot disagree with the subject: "Ryan and 2 others is off the mark" is a bug that reads fine in a diff and wrong on a lock screen. `{n}` counts the *others*, so four names read as "and 3 others".

**Row 8c never names the goal.** It is the first type that is *about* a goal, and therefore the first tempted to. Masking is per Circle and a lock screen is outside every one of those checks; `lib/teaser.test.ts` asserts a title in the payload still never reaches the body.

**Rows 4–8b do not vary, and that is not an oversight.** A message seen twice a year does not go stale, and three phrasings of it only make the product's voice inconsistent. Row 6 must never vary: being removed from a Circle may be read by the person who removed you, and a set of cheerful alternatives is exactly the wrong instinct. Row 9 stays dull because it is the branch most likely to meet something unfamiliar.

---

**"Tap to see" is gone from 1–5.** It was doing the work the Circle name now does: giving a reason to open something otherwise unidentifiable. Row 7 keeps its tail because it prompts a decision rather than a look.

**Row 8b names a person, and that is the one row where the setting governs two names.** It shipped naming nobody: the reasoning was that `push_shows_circle_name` governs a *group's* name, and a handle is a different disclosure. That made one setting mean two things depending on which notification arrived, and left the only notification asking for a decision indistinguishable from spam. Both names are now withheld together and shown together. The two halves degrade independently, because `inviter_username` has no CHECK behind it the way `circle_name` does.

**Row 6 stays vague deliberately** and was not part of the instruction. Being removed from a Circle is the one notification whose subject might be read by the person who removed you, and naming the Circle on a lock screen is exactly what that avoids.

**The title stays `Solarity` unless you say otherwise.** Rows 1–8 now differ from each other, which solves the four-identical-lines problem. Moving the Circle into the title would go further — iOS renders it largest and groups by it — but it is a separate decision and this is not it.

**One fallback to decide.** These read `circle_name` from the payload. Migration 73 backfilled every row and a CHECK requires it, so it is always present today. If it ever is not, the sender should fall back to the current generic sentence rather than print `undefined`.

**Row 9 exists for a type that has no renderer yet** — an enum value added by a migration before its copy lands. It should stay dull.

## In-app lines

These **already name the Circle**, from the live `groups` row, falling back to the frozen copy in the payload when the Circle is gone.

| # | Type | Current | New |
|---|---|---|---|
| 10 | `digest` | `{circle}`: `{done}` of `{total}` finished on `{date}` | |
| 11 | `invite_accepted` | `{who}` joined `{circle}` | |
| 11b | `invited` | `{who}` invited you to `{circle}` | links to `/join/{token}`, not to the Circle: you are not a member yet |
| 12 | `kicked` | You were removed from `{circle}` | |
| 13 | `group_locked_renewal` | `{circle}` has finished its cycle | |
| 14 | `deadline_changed` | `{circle}` changed its deadline | |
| 14b | `goal_achieved` | `{who}` achieved a goal in `{circle}` | |
| 14c | `circle_first_finisher` | `{who}` finished first in `{circle}` | |
| 14d | `last_one_left` | `{circle}` is waiting on you | |
| 14e | `circle_activity` | **not in the tab at all** | push-only, like `digest`: it can arrive hourly, and a badge that is never zero is a badge nobody reads |
| 15 | unknown type | Something happened in `{circle}` | |
| 16 | any, Circle deleted | the above, plus " (no longer available)" | |

---

## What each type can say

Only these values exist in the payload. Anything else needs a migration to `build_daily_digests` or whichever function writes that type.

| Type | Available |
|---|---|
| `digest` | `circle`, `done`, `total`, `date`, `group_streak` |
| `invite_accepted` | `circle`, `who` (the joiner's username) |
| `invited` | `circle`, `who` (the inviter's username), `token` (the live invite link) |
| `kicked` | `circle` |
| `group_locked_renewal` | `circle` |
| `deadline_changed` | `circle`, `cleared` (true when the deadline was removed) |
| `goal_achieved` | `circle`, `who` (the achiever) |
| `circle_first_finisher` | `circle`, `who`, `date` |
| `last_one_left` | `circle`, `date` |
| `circle_activity` | `circle`, `names` (an array, appended to while undelivered) |

**`date` is a plain date**, not a timestamp. Formatting it in a push means formatting it on the server, in the recipient's timezone, which the sender does not currently read.

**Push has no access to the live Circle name**, only the frozen `circle_name` in the payload. A Circle renamed after the digest was written will push its old name and display its new one. That is the denormalisation working as designed, and it is worth knowing before writing copy that leans on the name.

---

## Two rules any rewrite should keep

**Never name a goal.** Titles are masked per Circle by `hidden_everywhere` and `goal_group_visibility`, and a lock screen is outside every one of those checks. Counts are safe; titles are not, ever.

**A push is a prompt, not the content.** iOS truncates aggressively, and the in-app row is the durable copy. If a sentence only works at full length, it belongs in the panel.
