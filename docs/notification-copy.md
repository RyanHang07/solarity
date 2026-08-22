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
| 1 | `digest` | `done === 0` | Nobody checked in yesterday — tap to see | `{circle}`: nobody checked in yesterday |
| 2 | `digest` | `done === total` | Everyone checked in yesterday — tap to see | `{circle}`: everyone checked in yesterday |
| 3 | `digest` | otherwise | `{done}` of `{total}` checked in yesterday — tap to see | `{circle}`: `{done}` of `{total}` checked in yesterday |
| 4 | `deadline_changed` | `cleared` | A circle is now open-ended — tap to see | `{circle}` is now open-ended |
| 5 | `deadline_changed` | otherwise | A circle's deadline changed — tap to see | `{circle}` changed its deadline |
| 6 | `kicked` | | There's an update about one of your circles | **unchanged** |
| 7 | `group_locked_renewal` | | A circle's cycle has ended — tap to decide what's next | `{circle}` has finished its cycle — tap to decide what's next |
| 8 | `invite_accepted` | | Someone joined your circle | Someone joined your circle, `{circle}` |
| 9 | unknown type | | You have a new notification | **unchanged** |
| T | **title**, all types | | Solarity | **unchanged** — see below |

**"Tap to see" is gone from 1–5.** It was doing the work the Circle name now does: giving a reason to open something otherwise unidentifiable. Row 7 keeps its tail because it prompts a decision rather than a look.

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
| 12 | `kicked` | You were removed from `{circle}` | |
| 13 | `group_locked_renewal` | `{circle}` has finished its cycle | |
| 14 | `deadline_changed` | `{circle}` changed its deadline | |
| 15 | unknown type | Something happened in `{circle}` | |
| 16 | any, Circle deleted | the above, plus " (no longer available)" | |

---

## What each type can say

Only these values exist in the payload. Anything else needs a migration to `build_daily_digests` or whichever function writes that type.

| Type | Available |
|---|---|
| `digest` | `circle`, `done`, `total`, `date`, `group_streak` |
| `invite_accepted` | `circle`, `who` (the joiner's username) |
| `kicked` | `circle` |
| `group_locked_renewal` | `circle` |
| `deadline_changed` | `circle`, `cleared` (true when the deadline was removed) |

**`date` is a plain date**, not a timestamp. Formatting it in a push means formatting it on the server, in the recipient's timezone, which the sender does not currently read.

**Push has no access to the live Circle name**, only the frozen `circle_name` in the payload. A Circle renamed after the digest was written will push its old name and display its new one. That is the denormalisation working as designed, and it is worth knowing before writing copy that leans on the name.

---

## Two rules any rewrite should keep

**Never name a goal.** Titles are masked per Circle by `hidden_everywhere` and `goal_group_visibility`, and a lock screen is outside every one of those checks. Counts are safe; titles are not, ever.

**A push is a prompt, not the content.** iOS truncates aggressively, and the in-app row is the durable copy. If a sentence only works at full length, it belongs in the panel.
