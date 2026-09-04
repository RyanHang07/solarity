import Link from "next/link"
import { PolicyPage, PolicySection } from "@/components/policy-page"
import {
  CONTACT_EMAIL,
  CONTROLLER_NAME,
  DATA_REGION,
  EXPORT_CONTENTS,
  MINIMUM_AGE,
  PRIVACY_VERSION,
  PROCESSORS,
  RESPONSE_DAYS,
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
          Solarity is run by <strong>{CONTROLLER_NAME}</strong>, one person, not
          a company. That means there is no support team standing between you
          and whoever holds your data: it is the same person either way.
          Questions, requests, or anything about your data:{" "}
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
          {/*
            **Rewritten 4 Sept.** This described Google as the only way in,
            which stopped being true at step 20. A policy that names one of two
            sign-in methods understates what is collected from the other, and
            the other is the one with a password in it.
          */}
          <li>
            <strong>From signing in.</strong> Your email address, either way. If
            you use Google, also the name on your Google account — and Solarity
            never sees your Google password. If you sign up with a password
            instead, it is stored scrambled by Supabase in a form that cannot be
            turned back into what you typed, and nobody here can read it.
          </li>
          <li>
            <strong>Your profile.</strong> A username, an optional display name,
            an optional picture, and your timezone — which the app needs to know
            when your day ends.
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
            browser gives us to reach that device, and a label for it.{" "}
            {/*
              **The push service is a recipient and was not named.** The
              endpoint belongs to Apple, Google or Mozilla depending on the
              browser, and sending a notification means contacting it. Nothing
              here chooses it and nothing is configured — the browser hands the
              address over — but "who else touches it" is exactly the question
              this page exists to answer.
            */}
            <span className="opacity-70">
              That address belongs to your browser&apos;s own push service —
              Apple, Google or Mozilla — so sending you a notification means
              contacting them.
            </span>
          </li>
          <li>
            <strong>Your IP address.</strong> Every site sees one. Solarity does
            not store it in its database, but the hosting provider records it
            with the request, and opening an invite link counts an attempt
            against it so a stranger cannot guess their way into a Circle.
          </li>
        </ul>
        {/*
          **"It sends you no email today" was true until step 20 and is not
          now.** Confirmation links, password resets and the resend button all
          send mail. The correction matters twice: the claim itself was wrong,
          and the sentence built on it — that there is no way to reach you —
          was the reasoning behind advice on `/terms` about exporting your data
          rather than expecting notice. Both are fixed in the same commit,
          which is the rule this page sets for itself.
        */}
        <p className="opacity-70">
          There is no analytics, no advertising, and no tracking across other
          sites. Solarity does not sell anything about you. The only email it
          sends is about your account — confirming your address and resetting
          your password — and there is no mailing list to be on.
        </p>
      </PolicySection>

      {/*
        **The lawful-basis section, without the phrase "lawful basis".** GDPR
        asks why each kind of data is processed and under which ground. Written
        as three reasons in plain words, because a person deciding whether to
        trust this needs the answer more than a regulator needs the vocabulary,
        and the vocabulary is recoverable from the wording: a service you asked
        for is contract, a switch you turned on is consent, and stopping abuse
        is legitimate interests.
      */}
      <PolicySection heading="Why it is collected">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong>To run the thing you signed up for.</strong> Your profile,
            goals, check-ins and Circles exist because the app cannot show you
            your streak or show your Circle your day without them. This is most
            of it.
          </li>
          <li>
            <strong>Because you switched it on.</strong> Push notifications and
            showing your streaks on your profile are both off until you turn
            them on, and turning them off again stops the processing.
          </li>
          <li>
            <strong>To keep it from being abused.</strong> Counting invite
            attempts against an IP address, and keeping reports, exist so a
            stranger cannot guess their way into a Circle and so there is a
            record when somebody posts something they should not have.
          </li>
        </ul>
        <p className="opacity-70">
          Nothing here is processed for advertising, profiling or any automated
          decision about you. There is no such system to opt out of.
        </p>
      </PolicySection>

      <PolicySection heading="Who can see it">
        <p>
          <strong>Nothing here is public.</strong> Every page needs an account,
          and nothing is readable by search engines or by anyone signed out.
        </p>
        <p>
          <strong>Your profile is visible to anyone with an account.</strong>{" "}
          That is your username, your display name, your picture and the month
          you joined. Anyone signed in who knows or guesses your username can
          open it — usernames are how people find each other, so they are not
          secret.
        </p>
        <p>
          <strong>Your streaks and totals are off by default.</strong> They
          appear on your profile only if you turn them on in settings, and you
          can turn them off again at any time.
        </p>
        <p>
          <strong>Everything else is limited to Circles you joined.</strong>{" "}
          Circles are invite-only and capped at ten people.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Circle members see your username, your picture, whether you checked
            in today, and your streak.
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
          <li>
            <strong>Blocking</strong> hides your profile from someone and theirs
            from you. It does not remove either of you from a Circle you both
            joined, and they are not told.
          </li>
        </ul>
      </PolicySection>

      <PolicySection heading="Reports, and what a moderator can see">
        <p>
          You can report a check-in photo, a check-in note, or a profile
          belonging to someone in one of your Circles. A report records what was
          reported, who reported it, and anything you typed.
        </p>
        <p>
          <strong>
            An administrator can read the specific thing that was reported
          </strong>{" "}
          — that note or that photo — even if it was never shared with them,
          because there is no way to judge a report without seeing what it is
          about. They see nothing else: not your other goals, not your other
          days, and nothing nobody reported.
        </p>
        <p>
          Administrators can mark a report reviewed, actioned or dismissed. The
          dashboard cannot delete your content or suspend your account; anything
          of that kind is done by hand and would be a separate decision.
        </p>
        <p className="opacity-70">
          {/*
            Named plainly rather than left to inference. "An administrator" in a
            product run by one person means that person, and someone deciding
            whether to trust it deserves to know the scale.
          */}
          Solarity is run by one person, so today that administrator is{" "}
          {CONTACT_EMAIL}. Every grant or removal of that access is recorded.
        </p>
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
          <li>
            <strong>Your picture: until you replace or remove it.</strong> It has
            no expiry date, unlike a check-in photo.
          </li>
          <li>
            <strong>Reports, and the record of who was given moderator access:
            kept.</strong> Nothing deletes these on a schedule. A report is the
            only account of why something was actioned, and a record that
            expired would be no record at all.
          </li>
        </ul>
      </PolicySection>

      <PolicySection heading="Getting your data, and getting rid of it">
        <p>
          <strong>Export.</strong> One JSON file, from{" "}
          <Link href="/settings" className="underline">
            your settings
          </Link>
          . It contains:
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {EXPORT_CONTENTS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="opacity-70">
          {/*
            Named rather than left as "and some other things". A person checking
            whether they got everything can only do that against a list, and the
            gap is small enough to state plainly.
          */}
          Not in the file: your notifications, the devices you turned push on
          for, who you have blocked, reports you filed, your notification
          settings, your sun colour, when you accepted these terms, and your
          email address. Write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>{" "}
          for any of those and you will get them.
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
          <strong>What deletion removes.</strong> Your account, your profile,
          your picture, your notes, your photos, your notifications and the
          devices you turned push on for. The picture and the photos are deleted
          from storage, not just unlinked.
        </p>
        <p>
          <strong>Two things deletion does not do.</strong> Your check-in records
          stay, with your name and any note removed from them. They are part of
          other members&apos; shared history — the days a Circle completed
          together — and erasing them would silently rewrite other people&apos;s
          streaks.
        </p>
        <p>
          And <strong>a report keeps its shape without your name in it.</strong>{" "}
          If you reported something, or were reported, the report survives with
          the link to your account removed, as does the record of any moderator
          access that was granted or taken away. Both are accounts of a decision
          somebody made, and a decision with no record is not reviewable.
        </p>
      </PolicySection>

      {/*
        **The rights list, written as things you can do rather than as
        articles.** Two of the six are buttons in this app, which is the part
        worth leading with: a rights section that reads as a legal formality
        buries the fact that deletion is one click away. The response window is
        a real commitment made by one person; see `RESPONSE_DAYS`.
      */}
      <PolicySection heading="What you can ask for">
        <p>
          Wherever you live, you can do all of these. Where you live may also
          give you a legal right to them, and the answer is the same either way.
        </p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            <strong>See it, and take a copy.</strong> The export above, plus
            anything it leaves out on request.
          </li>
          <li>
            <strong>Correct it.</strong> Your username, display name, picture and
            timezone are all editable in settings. Anything else, write.
          </li>
          <li>
            <strong>Delete it.</strong> One button in settings. The section above
            says exactly what stays and why.
          </li>
          <li>
            <strong>Object to something, or ask that it stop.</strong> Including
            the parts you did not switch on, like counting invite attempts.
          </li>
          <li>
            <strong>Complain to a regulator</strong> in your country, without
            asking here first.
          </li>
        </ul>
        <p>
          Anything that is not a button gets an answer within{" "}
          <strong>{RESPONSE_DAYS} days</strong>, usually much sooner. Write from
          the address on your account so it is clear who is asking:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
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
        <p>
          <strong>Where it is.</strong> All of it is stored and processed in{" "}
          {DATA_REGION}. If you are in the UK or the EU, using Solarity means
          your data goes there.
        </p>
      </PolicySection>

      {/*
        **Cookies, because their absence was conspicuous.** Every one of these
        is functional: the Supabase session cookies, `today-gate`'s two, and the
        dismissal cookie for the install nudge. None is a tracker, which is why
        there is no banner, and saying so is shorter than the banner would be.
      */}
      <PolicySection heading="Cookies">
        <p>
          Only the ones the app needs. They keep you signed in, remember whether
          you have already seen today&apos;s check-in screen, and remember that
          you dismissed a prompt.
        </p>
        <p className="opacity-70">
          There are no advertising or analytics cookies, and nothing here follows
          you to another site. That is also why Solarity has no cookie banner:
          there is nothing to consent to.
        </p>
      </PolicySection>

      <PolicySection heading="Security">
        <p>
          Check-in photos and profile pictures both live in private storage and
          are served through links that expire within the hour. Every rule about
          who can read what is enforced by the database itself rather than by the
          app, so a bug in a screen cannot show someone a goal they were not
          meant to see.
        </p>
        {/*
          **A breach paragraph, which was the one structural gap.** GDPR asks
          for notification to the supervisory authority within 72 hours and to
          affected people without undue delay where the risk is high. A security
          section that describes only the defences reads as though nothing could
          go wrong, and the promise here has to be one a single person can
          actually keep: email is the only channel, and it now exists.
        */}
        <p>
          <strong>If something goes wrong.</strong> If data is exposed in a way
          that puts you at risk, you will be emailed at the address on your
          account as soon as the scope is understood, and the relevant regulator
          told within 72 hours of it being discovered. That is a commitment from
          one person, not a team with a rota, which is exactly why it is written
          down here.
        </p>
        <p className="opacity-70">
          No system is perfect, and this one is early. If you find something
          wrong, please write.
        </p>
      </PolicySection>

      <PolicySection heading="Changes">
        <p>
          If this changes in a way that matters, the date at the top changes.
        </p>
        <p className="opacity-70">
          {/*
            **The conclusion survived two rewrites; the reasoning did not.**
            It first promised notice in the app before a change took effect,
            which nothing implemented. It was then corrected to "does not send
            email" — which step 20 falsified, and which had been offered as the
            *reason* the date was the notice.

            The reason now is narrower and actually true: transactional mail
            exists, an announcement channel does not. Broadcasting to every
            account would be a thing to build, not a switch to flip. Recorded
            because a policy that overstates its own machinery is the exact
            failure this page is meant to avoid, and it has now been made in
            both directions.
          */}
          It will not email you about a change. Solarity can send mail about
          your own account, but there is no announcement list and nothing that
          writes to everyone, so the honest version is that the date is the
          notice. If that ever changes, this paragraph changes with it.
        </p>
      </PolicySection>
    </PolicyPage>
  )
}
