// The words a push notification says. Split out of index.ts in 10g so they can
// be unit-tested: index.ts imports Deno and npm specifiers, this imports
// nothing, and copy is exactly the kind of thing that breaks quietly.
//
// The full inventory, both surfaces, lives in docs/notification-copy.md.

export type Teaser = { title: string; body: string }

/**
 * Step 18f. Picks one of a set, the same way every time for a given row.
 *
 * ## Why a seed rather than `Math.random()`
 *
 * A digest arrives every day forever. The Circle name made four Circles
 * distinguishable from each other; nothing made today distinguishable from
 * yesterday, and two hundred identical notifications is a notification people
 * stop reading.
 *
 * Random would have been one line and is wrong twice. **A redelivery would
 * differ from the first attempt** — the sender retries, and a push that arrives
 * twice saying two different things reads as two events. And it would make this
 * file untestable by equality, which is the entire reason it was split out of
 * `index.ts`.
 *
 * Rotating by date was the other option: everyone would see the same variant on
 * the same day, so four Circles would read identically again, which is the
 * problem this copy was rewritten to solve.
 *
 * Hashing the notification's own id gives one stable answer per row, and reads
 * as random across days because the ids are.
 *
 * ## FNV-1a, and nothing imported
 *
 * `teaser.ts` imports nothing at all, which is what lets a Deno module be unit
 * tested from Vitest. A hash from `node:crypto` would end that, and the
 * requirement here is spread, not cryptographic strength: the ids are v4 uuids,
 * so any mixing function distributes them.
 *
 * **An empty id returns the first variant, and that is a guard rather than a
 * coincidence.** FNV's offset basis is 2166136261, which is 1 modulo 4, so an
 * unseeded call would otherwise land on the *second* variant of a four-set —
 * deterministic, arbitrary, and silently different from the sentence that
 * shipped. Every existing caller and test that omits an id gets the original.
 */
function pick(variants: string[], seed: string): string {
  if (variants.length === 1 || !seed) return variants[0];

  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    // `Math.imul` because the 32-bit FNV prime overflows a JS number under `*`,
    // and an overflowed multiply silently stops mixing the high bits.
    hash = Math.imul(hash, 16777619);
  }

  return variants[Math.abs(hash) % variants.length];
}

/**
 * A person's handle, or null when it may not be shown.
 *
 * **Governed by the same setting as the Circle name**, the rule settled for
 * `invited` in 18b: withholding lock-screen detail has to mean both names or it
 * means nothing. "ryahn achieved a goal" tells whoever is holding the phone who
 * this person's friends are, which is the disclosure the setting exists to
 * prevent.
 */
function personFrom(raw: unknown, showName: boolean): string | null {
  return showName && typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * Whether the body may name the Circle.
 *
 * **This is a per-account setting, read from `users.push_shows_circle_name`.**
 * A Circle name on a lock screen is readable by anyone holding the phone,
 * outside every access control the app has, and for some Circles the name is
 * the sensitive part. Default is on, because the alternative — the state this
 * function shipped with — is four notifications that read identically and
 * cannot be told apart.
 *
 * `id` seeds the copy variance; see `pick`. It is the notification's own id,
 * which the sender already selects.
 */
export function teaser(
  type: string,
  payload: Record<string, unknown>,
  showName: boolean,
  id = "",
): Teaser {
  const raw = payload.circle_name
  // A name only when we have one *and* may use it. Migration 73 backfilled
  // every row and a CHECK requires it, so the fallback is for a future type
  // that forgets, not for today — and it degrades to the old wording rather
  // than printing "undefined" on someone's lock screen.
  const name = showName && typeof raw === "string" && raw.trim() ? raw.trim() : null

  const title = "Solarity";

  switch (type) {
    /**
     * Step 18f. **The one message that arrives every day, so the one that goes
     * stale.**
     *
     * Four or five ways of saying each outcome, seeded by the row's id. The
     * first variant of every set is the sentence that shipped, which is not
     * sentiment: it is what makes this a widening rather than a rewrite, and it
     * is the one a reader recognises if the others ever read oddly.
     *
     * **"Tap to see" stays on the nameless variants only.** It was doing the
     * work the Circle name now does: supplying a reason to open something
     * otherwise unidentifiable. With a name it is noise; without one it is
     * still the whole prompt.
     */
    case "digest": {
      const done = Number(payload.completed_count ?? 0);
      const total = Number(payload.member_count ?? 0);
      const streak = Number(payload.group_streak ?? 0);

      if (done === 0) {
        return {
          title,
          body: pick(
            name
              ? [
                `${name}: nobody checked in yesterday`,
                `A quiet day in ${name}`,
                `${name} had a quiet one`,
                `Nothing logged in ${name} yesterday`,
              ]
              : [
                "Nobody checked in yesterday — tap to see",
                "A quiet day — tap to see",
                "Nothing logged yesterday — tap to see",
                "A quiet one yesterday — tap to see",
              ],
            id,
          ),
        };
      }

      if (done === total) {
        const named = [
          `${name}: everyone checked in yesterday`,
          `Clean sweep in ${name} yesterday`,
          `All of ${name} finished yesterday`,
          `${name} went ${total} for ${total} yesterday`,
        ];

        /**
         * **Only above one, and this is the guard the set needs.**
         *
         * `group_streak` is 0 on a Circle's first perfect day and on any day
         * after a reset, and "everyone finished, 0 days running" is worse than
         * the sentence it replaced. At 1 it is true and pointless. So this is
         * the one variant whose availability depends on the payload rather than
         * on the seed — which also means the same row can pick a different
         * sentence tomorrow, when the streak has grown. That is fine: a
         * notification is delivered once.
         */
        if (name && streak > 1) {
          named.push(`${name}: everyone finished, ${streak} days running`);
        }

        return {
          title,
          body: pick(
            name
              ? named
              : [
                "Everyone checked in yesterday — tap to see",
                "A clean sweep yesterday — tap to see",
                "Everyone finished yesterday — tap to see",
                `${total} for ${total} yesterday — tap to see`,
              ],
            id,
          ),
        };
      }

      return {
        title,
        body: pick(
          name
            ? [
              `${name}: ${done} of ${total} checked in yesterday`,
              `${done} of ${total} finished in ${name}`,
              `${name} came in at ${done} of ${total}`,
              `${done} of ${total} made it in ${name}`,
            ]
            : [
              `${done} of ${total} checked in yesterday — tap to see`,
              `${done} of ${total} finished yesterday — tap to see`,
              `${done} of ${total} made it yesterday — tap to see`,
              `Came in at ${done} of ${total} yesterday — tap to see`,
            ],
          id,
        ),
      };
    }

    case "deadline_changed":
      if (payload.cleared) {
        return {
          title,
          body: name
            ? `${name} is now open-ended`
            : "A circle is now open-ended — tap to see",
        };
      }
      return {
        title,
        body: name
          ? `${name} changed its deadline`
          : "A circle's deadline changed — tap to see",
      };

    // **Deliberately vague, named or not.** Being removed from a Circle is the
    // one notification whose subject might be read by the person who removed
    // you, and naming the Circle on a lock screen is what that avoids.
    case "kicked":
      return { title, body: "There's an update about one of your circles" };

    case "group_locked_renewal":
      return {
        title,
        // Keeps its tail: this one prompts a decision rather than a look.
        body: name
          ? `${name} has finished its cycle — tap to decide what's next`
          : "A circle's cycle has ended — tap to decide what's next",
      };

    case "invite_accepted":
      return {
        title,
        body: name ? `Someone joined your circle, ${name}` : "Someone joined your circle",
      };

    /**
     * Step 18b. **Names the inviter, under the same setting as the Circle.**
     *
     * This shipped naming nobody, on the reasoning that `push_shows_circle_name`
     * governs a *group's* name and a person's handle is a different disclosure.
     * That was wrong twice over. It made the setting mean two things depending
     * on which notification arrived, when a person who has turned lock-screen
     * detail **off** wants both withheld and one who has turned it **on** wants
     * both — the whole product is people you already know, so "invited you" is
     * not a scarier fact than the Circle's name.
     *
     * And it made the one notification that asks for a decision the least
     * decidable: an invite from nobody in particular, to a circle, is
     * indistinguishable from spam, and the name is the only thing that makes it
     * obviously not.
     *
     * Both halves degrade independently. A payload with a Circle but no inviter
     * still says something useful, which matters because `inviter_username`
     * has no CHECK behind it the way `circle_name` does.
     */
    case "invited": {
      const rawInviter = payload.inviter_username;
      const inviter =
        showName && typeof rawInviter === "string" && rawInviter.trim()
          ? rawInviter.trim()
          : null;

      if (inviter && name) {
        return { title, body: `${inviter} invited you to ${name}` };
      }
      if (inviter) {
        return { title, body: `${inviter} invited you to a circle` };
      }
      return {
        title,
        body: name
          ? `You've been invited to ${name}`
          : "You've been invited to a circle — tap to see",
      };
    }

    /**
     * Step 19. **Rare, so it does not vary**, and it never names the goal.
     * Masking is per Circle and a lock screen is outside every check the app
     * has; the title stays where `circle_roster` can decide who sees it.
     */
    case "goal_achieved": {
      const who = personFrom(payload.who, showName);
      if (who && name) return { title, body: `${who} achieved a goal in ${name}` };
      if (name) return { title, body: `Somebody achieved a goal in ${name}` };
      return { title, body: "Somebody in your circle achieved a goal — tap to see" };
    }

    /**
     * Step 19. First to finish their whole day.
     *
     * **Names the achievement, never a comparison.** "Beat you to it" was on
     * the table and is not what a Circle of friends is for: it addresses the
     * reader as losing on a day they may simply not have got to yet.
     */
    case "circle_first_finisher": {
      const who = personFrom(payload.who, showName);
      return {
        title,
        body: pick(
          who && name
            ? [
              `${who} is first to finish in ${name}`,
              `${who} is out of the gate first in ${name}`,
              `${who} got there first in ${name}`,
              `First one done in ${name}: ${who}`,
            ]
            : [
              "Someone finished first — tap to see",
              "Somebody is done already — tap to see",
            ],
          id,
        ),
      };
    }

    /**
     * Step 19. Everyone else is done and you are not.
     *
     * **States the fact and stops.** No "still time" tail: the fact is the
     * motivation, and a tail turns a friend's nudge into an app's. This is the
     * only push in the product addressed to the reader about themselves, which
     * is also why it names nobody and needs no block check.
     */
    case "last_one_left":
      return {
        title,
        body: pick(
          name
            ? [
              `You're the last one in ${name}`,
              `${name} is waiting on you`,
              `Everyone else is done in ${name}`,
              `Just you left in ${name}`,
            ]
            : [
              "A circle is waiting on you — tap to see",
              "You're the last one in a circle — tap to see",
              "Everyone else is done in a circle — tap to see",
            ],
          id,
        ),
      };

    /**
     * Step 19. The coalesced one, and the most frequent message in the app.
     *
     * **The verb varies and the shape does not.** This is the only body with
     * three grammatical forms — one name, two, many — and letting the sentence
     * structure move as well would give three ways to be wrong about plurals
     * instead of one.
     *
     * `{n}` counts people whose names are being withheld when `showName` is
     * off, which is deliberate: everyone counted is in a Circle the reader is
     * already in, so the number reveals nothing they could not learn by
     * opening the app.
     */
    case "circle_activity": {
      const raw = payload.names;
      const names = Array.isArray(raw)
        ? raw.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
        : [];

      // No names is not a case the trigger can produce — it always inserts at
      // least one — so this is the branch that keeps a future writer honest.
      if (names.length === 0) {
        return { title, body: "There's movement in one of your circles — tap to see" };
      }

      const verb = pick(["got started", "is off the mark", "has begun"], id);
      // The plural of every one of those, so the verb and the count cannot
      // disagree: "Ryan and 2 others is off the mark" is the bug this avoids.
      const plural = verb === "is off the mark" ? "are off the mark" : verb === "has begun" ? "have begun" : verb;

      if (!showName) {
        if (names.length === 1) return { title, body: "Someone got started — tap to see" };
        return { title, body: "A few people got started — tap to see" };
      }

      const where = name ? ` in ${name}` : "";
      if (names.length === 1) return { title, body: `${names[0]} ${verb}${where}` };
      if (names.length === 2) {
        return { title, body: `${names[0]} and ${names[1]} ${plural}${where}` };
      }
      return {
        title,
        body: `${names[0]} and ${names.length - 1} others ${plural}${where}`,
      };
    }

    // A type whose renderer has not landed yet — an enum value added by a
    // migration ahead of its copy. It should stay dull.
    default:
      return { title, body: "You have a new notification" };
  }
}
