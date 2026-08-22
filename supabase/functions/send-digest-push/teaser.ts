// The words a push notification says. Split out of index.ts in 10g so they can
// be unit-tested: index.ts imports Deno and npm specifiers, this imports
// nothing, and copy is exactly the kind of thing that breaks quietly.
//
// The full inventory, both surfaces, lives in docs/notification-copy.md.

export type Teaser = { title: string; body: string }

/**
 * Whether the body may name the Circle.
 *
 * **This is a per-account setting, read from `users.push_shows_circle_name`.**
 * A Circle name on a lock screen is readable by anyone holding the phone,
 * outside every access control the app has, and for some Circles the name is
 * the sensitive part. Default is on, because the alternative — the state this
 * function shipped with — is four notifications that read identically and
 * cannot be told apart.
 */
export function teaser(
  type: string,
  payload: Record<string, unknown>,
  showName: boolean,
): Teaser {
  const raw = payload.circle_name
  // A name only when we have one *and* may use it. Migration 73 backfilled
  // every row and a CHECK requires it, so the fallback is for a future type
  // that forgets, not for today — and it degrades to the old wording rather
  // than printing "undefined" on someone's lock screen.
  const name = showName && typeof raw === "string" && raw.trim() ? raw.trim() : null

  const title = "Solarity";

  switch (type) {
    case "digest": {
      const done = Number(payload.completed_count ?? 0);
      const total = Number(payload.member_count ?? 0);

      // "Tap to see" is gone from these. It was doing the work the Circle name
      // now does: supplying a reason to open something otherwise
      // unidentifiable. Without a name it still has that job.
      if (done === 0) {
        return {
          title,
          body: name
            ? `${name}: nobody checked in yesterday`
            : "Nobody checked in yesterday — tap to see",
        };
      }
      if (done === total) {
        return {
          title,
          body: name
            ? `${name}: everyone checked in yesterday`
            : "Everyone checked in yesterday — tap to see",
        };
      }
      return {
        title,
        body: name
          ? `${name}: ${done} of ${total} checked in yesterday`
          : `${done} of ${total} checked in yesterday — tap to see`,
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

    // A type whose renderer has not landed yet — an enum value added by a
    // migration ahead of its copy. It should stay dull.
    default:
      return { title, body: "You have a new notification" };
  }
}
