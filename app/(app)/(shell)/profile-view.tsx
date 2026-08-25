import type { Profile } from "@/app/actions/profile"

/**
 * Step 15b. What a profile looks like, wherever it is reached from.
 *
 * **One component for `/profile` and `/profile/[username]`**, because they are
 * the same screen with different subjects. The only difference either page
 * makes is the controls it puts beside this — Block and Report belong to
 * somebody else's profile and never to your own.
 *
 * **Identity is always here; the numbers are opt-in.** That split is the whole
 * of `visible_on_profile`, and it is enforced in `profile_by_username` rather
 * than here: a viewer who is not allowed the stats is handed nulls, so this
 * component cannot leak them by rendering carelessly.
 */

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-xs opacity-70">{label}</span>
    </div>
  )
}

export function ProfileView({
  profile,
  /** Signed on the server. The object key never reaches the browser. */
  avatarUrl,
}: {
  profile: Profile
  avatarUrl: string | null
}) {
  const name = profile.displayName?.trim() || profile.username

  return (
    <section aria-label={`${profile.username}'s profile`} className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          /*
            **A plain `<img>`, not `next/image`.** The source is a signed URL
            with an hour's TTL, so the optimiser would cache a URL that outlives
            it and then serve a 400 from its own cache. `checkin-photo.tsx` made
            the same call for the same reason.
          */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={`${profile.username}'s picture`}
            width={80}
            height={80}
            className="size-20 rounded-full object-cover"
          />
        ) : (
          // Initials, not a placeholder asset: nothing to ship, nothing to
          // load, and legible at every size this is drawn at.
          <span
            aria-hidden
            className="flex size-20 items-center justify-center rounded-full border text-2xl font-medium opacity-70"
          >
            {name.charAt(0).toUpperCase()}
          </span>
        )}

        <div className="flex flex-col gap-0.5">
          {/*
            **`username` is the heading, `display_name` is the subtitle.**
            `schema.md` is explicit: render the username anywhere one person is
            named to another, because `display_name` is cosmetic and **not
            unique**. On a page whose whole job is to say who someone is, the
            unique one leads.
          */}
          <h1 className="text-xl font-semibold">{profile.username}</h1>
          {profile.displayName ? (
            <p className="text-sm opacity-70">{profile.displayName}</p>
          ) : null}
          <p className="text-xs opacity-60">
            {/*
              **UTC-pinned**, like every other date in this app. `member_since`
              is a real instant rather than a check-in date, but formatting it
              in the viewer's zone would date somebody's join a day early for
              readers west of it and a day late for readers east — the same
              person's profile showing two dates.
            */}
            Joined{" "}
            {new Date(profile.memberSince).toLocaleDateString("en-GB", {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
          </p>
        </div>
      </div>

      {profile.statsVisible ? (
        <div className="flex flex-wrap gap-8">
          <Stat label="Current streak" value={profile.currentStreak ?? 0} />
          <Stat label="Longest streak" value={profile.longestStreak ?? 0} />
          <Stat label="Days completed" value={profile.totalDaysCompleted ?? 0} />
          <Stat label="Goals achieved" value={profile.totalGoalsAchieved ?? 0} />
        </div>
      ) : (
        // **Not four zeroes.** Zero is a true statement about a new account and
        // a false one about somebody who simply has not shared. The distinction
        // costs one sentence and is the difference between withholding and
        // lying.
        <p className="text-sm opacity-70">
          {profile.username} hasn&apos;t shared their stats.
        </p>
      )}
    </section>
  )
}
