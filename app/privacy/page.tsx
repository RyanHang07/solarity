import Link from "next/link"
import { PolicyPage, PolicySection } from "@/components/policy-page"
import {
  CONTACT_EMAIL,
  MINIMUM_AGE,
  PRIVACY_VERSION,
  PROCESSORS,
  RETENTION_DAYS,
} from "@/lib/legal"

export const metadata = {
  title: "Privacy — Solarity",
  description: "What Solarity collects, who can see it, and how long it is kept.",
}

/**
 * **Required before anyone outside the test accounts can sign in.** Google's
 * OAuth consent screen will not publish without a reachable privacy URL.
 *
 * **Every claim here is checkable against the code.** Retention numbers come
 * from `lib/legal.ts`, which annotates each with the job that enforces it; the
 * sharing rules are `circle_roster` and `checkin_photos_select`; the deletion
 * behaviour is `delete-account`. Written from `architecture/security.md` rather
 * than from a template, because a policy that describes a different product is
 * worse than none.
 *
 * **It describes only what is built**, and that is a rule this page has already
 * had to honour twice. It used to say to write in for deletion, because the
 * `delete-account` Edge Function was deployed with nothing able to call it. 14e
 * shipped the control, so the sentence became a link **in the same change** —
 * a policy describing a slower path than the product offers is drift in the
 * direction that costs trust. The email route is kept as an alternative, not
 * as the only one.
 *
 * Not legal advice; have it reviewed before real users.
 */
export default function PrivacyPage() {
  return (
    <PolicyPage
      title="Privacy"
      version={PRIVACY_VERSION}
      intro="Solarity is a goal tracker you share with a few friends. This describes exactly what it stores, who can see it, and when it goes away."
    >
      <PolicySection heading="Who runs this">
        <p>
          Solarity is run by one person, not a company. Questions, requests, or
          anything about your data:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <p className="opacity-70">
          You must be {MINIMUM_AGE} or older to use Solarity.
        </p>
      </PolicySection>

      <PolicySection heading="What is collected">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong>From signing in.</strong> If you use Google, your email
            address and the name on your Google account. Solarity never sees your
            Google password.
          </li>
          <li>
            <strong>Your profile.</strong> A username, an optional display name,
            and your timezone — which the app needs to know when your day ends.
          </li>
          <li>
            <strong>Your goals and check-ins.</strong> Goal titles, categories,
            the dates you checked in, and any note or photo you attached.
          </li>
          <li>
            <strong>Your Circles.</strong> Which Circles you belong to, your role
            in each, and when you joined.
          </li>
          <li>
            <strong>Notifications.</strong> If you turn on push, the address your
            browser gives us to reach that device, and a label for it.
          </li>
        </ul>
        <p className="opacity-70">
          There is no analytics, no advertising, and no tracking across other
          sites. Solarity does not sell anything about you.
        </p>
      </PolicySection>

      <PolicySection heading="Who can see it">
        <p>
          <strong>Only people in a Circle you joined.</strong> Circles are
          invite-only and capped at ten people. Nothing you write is public, and
          there is no way to browse other users.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Circle members see your username, whether you checked in today, and
            your streak.
          </li>
          <li>
            <strong>Notes are private unless you share them.</strong> There is a
            tick box on each note, and it is off by default. Un-sharing takes
            effect immediately and applies to notes you already wrote.
          </li>
          <li>
            <strong>Photos are visible by default</strong> to the Circles that
            can see the goal. A photo is the proof, so it is shared where the
            goal is.
          </li>
          <li>
            <strong>Hiding a goal hides its title, note and photo</strong> in
            that Circle, while still counting it toward your day. You can hide a
            goal in one Circle, in all of them, or none.
          </li>
        </ul>
      </PolicySection>

      <PolicySection heading="How long it is kept">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong>Photos: {RETENTION_DAYS.PHOTOS} days.</strong> Then the image
            is deleted automatically. The check-in itself, and your streak, stay.
          </li>
          <li>
            <strong>Notifications and daily digests: {RETENTION_DAYS.ACTIVITY}{" "}
            days.</strong>
          </li>
          <li>
            <strong>Goals, check-ins and streaks: until you delete them</strong>{" "}
            or delete your account.
          </li>
        </ul>
      </PolicySection>

      <PolicySection heading="Getting your data, and getting rid of it">
        <p>
          <strong>Export.</strong> Everything Solarity holds about you is
          downloadable as one JSON file from{" "}
          <Link href="/settings" className="underline">
            your settings
          </Link>
          .
        </p>
        <p>
          <strong>Deletion.</strong>{" "}
          <Link href="/settings" className="underline">
            Delete your account from settings
          </Link>
          . It happens immediately and cannot be undone. If you would rather
          write, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>{" "}
          from the address on your account and it will be done for you.
        </p>
        <p>
          <strong>One thing deletion does not do.</strong> Your check-in records
          stay, with your name and any note removed from them. They are part of
          other members&apos; shared history — the days a Circle completed
          together — and erasing them would silently rewrite other people&apos;s
          streaks. Your photos, your notes and your account are gone.
        </p>
      </PolicySection>

      <PolicySection heading="Who else touches it">
        <p>
          Solarity runs on other people&apos;s infrastructure. These providers
          process data on its behalf:
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {PROCESSORS.map((p) => (
            <li key={p.name}>
              <strong>{p.name}</strong> — {p.role}
            </li>
          ))}
        </ul>
      </PolicySection>

      <PolicySection heading="Security">
        <p>
          Check-in photos live in private storage and are served through links
          that expire within the hour. Every rule about who can read what is
          enforced by the database itself rather than by the app, so a bug in a
          screen cannot show someone a goal they were not meant to see.
        </p>
        <p className="opacity-70">
          No system is perfect, and this one is early. If you find something
          wrong, please write.
        </p>
      </PolicySection>

      <PolicySection heading="Changes">
        <p>
          If this changes in a way that matters, the date at the top changes and
          you will be told in the app before it takes effect.
        </p>
      </PolicySection>
    </PolicyPage>
  )
}
