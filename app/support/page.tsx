import Link from "next/link"
import { LegalFooter } from "@/components/legal-footer"
import { CONTACT_EMAIL, RESPONSE_DAYS, RETENTION_DAYS } from "@/lib/legal"

export const metadata = {
  title: "Support — Solarity",
  description: "How to get your data, delete your account, and get help.",
}

/**
 * Step 20j. What the backend already does, written down.
 *
 * ## Content and a `mailto:`, not a contact form
 *
 * The plan budgeted a form. A form on a one-person product is a spam relay
 * needing its own Turnstile, its own rate limit and its own sending path, to
 * deliver mail to an inbox a `mailto:` reaches for free. If volume ever
 * justifies one it can be added without moving the page.
 *
 * ## Not decoration: every answer here is a feature nothing linked to
 *
 * Account deletion, the data export, photo retention, reporting and blocking
 * are all implemented and all reachable only by somebody who already knows
 * where to look. `export_user_data` in particular has existed since step 14 and
 * had exactly one caller, a link in Settings that nothing pointed at.
 *
 * ## Public, so it answers the question before signing up as well as after
 *
 * `/support` is in `PUBLIC_PREFIXES`. Half of what it explains — what happens
 * to a photo, what deletion leaves behind — is what somebody wants to read
 * *before* creating an account, and the other half is what somebody who cannot
 * sign in needs.
 */
function Answer({
  question,
  children,
}: {
  question: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{question}</h2>
      <div className="flex flex-col gap-2 text-sm opacity-80">{children}</div>
    </section>
  )
}

export default function SupportPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 p-6">
      <header className="flex flex-col gap-2 pt-8">
        <h1 className="text-2xl font-semibold tracking-tight">Support</h1>
        <p className="text-sm opacity-70">
          Solarity is run by one person. Write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>{" "}
          and you&apos;ll get an answer within {RESPONSE_DAYS} days, usually much
          sooner.
        </p>
      </header>

      <Answer question="How do I get my data?">
        <p>
          There&apos;s a <strong className="font-medium">Download your data</strong>{" "}
          link in{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>
          . It gives you one JSON file with your profile, your streaks and
          totals, every goal, every check-in and note, which days you completed,
          and the Circles you&apos;re in.
        </p>
        <p>
          A few things aren&apos;t in that file: your notifications, the devices
          you turned push on for, who you&apos;ve blocked, reports you filed, and
          your email address. Ask and you&apos;ll get them.
        </p>
      </Answer>

      <Answer question="How do I delete my account?">
        <p>
          In{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>
          , at the bottom. It happens immediately and cannot be undone.
        </p>
        <p>
          <strong className="font-medium">What stays:</strong> your check-in
          records, with your name and any note removed. They&apos;re part of your
          Circles&apos; shared history — the days a group completed together —
          and erasing them would silently rewrite other people&apos;s streaks. A
          report you filed or that was filed about you also survives, with the
          link to your account removed.
        </p>
        <p>
          Everything else goes: your profile, your picture, your notes, your
          photos, your notifications.
        </p>
      </Answer>

      <Answer question="What happens to photos I attach?">
        <p>
          They live in private storage and are only ever served through links
          that expire within the hour. The Circles that can see the goal can see
          its photo.
        </p>
        <p>
          <strong className="font-medium">
            After {RETENTION_DAYS.PHOTOS} days the image is deleted
          </strong>{" "}
          automatically. The check-in itself, and your streak, stay. Notifications
          and daily digests are cleared on the same schedule.
        </p>
      </Answer>

      <Answer question="Somebody posted something they shouldn't have">
        <p>
          Report it. There&apos;s a link under any check-in photo or note in a
          Circle you share, and on a profile. A report records what was reported,
          who reported it, and anything you typed.
        </p>
        <p>
          An administrator can read the specific thing reported — that note or
          that photo — even if it was never shared with them, because there is no
          way to judge a report without seeing it. They see nothing else. The
          person you reported isn&apos;t told who reported them.
        </p>
      </Answer>

      <Answer question="What's the difference between blocking and being removed?">
        <p>
          <strong className="font-medium">Blocking</strong> is something you do.
          It hides your profile from that person and theirs from you, both ways,
          and they aren&apos;t told. It does not remove either of you from a
          Circle you both joined. Undo it in Settings, which is the only route
          back — blocking hides the page the Block button was on.
        </p>
        <p>
          <strong className="font-medium">Being removed</strong> from a Circle is
          done by its owner or an admin. You stop seeing it, and you&apos;re told
          it happened.
        </p>
      </Answer>

      <Answer question="Why don't I get notifications on my iPhone?">
        <p>
          iOS only delivers notifications to a web app that has been added to the
          home screen. In Safari, tap Share, then{" "}
          <strong className="font-medium">Add to Home Screen</strong>, and open
          Solarity from that icon. Then turn notifications on in Settings.
        </p>
        <p>
          There is no way around this: a browser tab on iOS cannot receive push
          at all, whatever the app does.
        </p>
      </Answer>

      <Answer question="I can't sign in">
        <p>
          If you signed up with Google, use the Google button — there&apos;s no
          password on that account to reset.
        </p>
        <p>
          If you used an email address and password,{" "}
          <Link href="/auth/forgot-password" className="underline">
            ask for a reset link
          </Link>
          . If no email arrives, check your spam folder, and if it still
          hasn&apos;t come, write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Answer>

      <footer className="border-t pt-6 pb-10">
        <LegalFooter />
      </footer>
    </main>
  )
}
