import Link from "next/link"
import { PolicyPage, PolicySection } from "@/components/policy-page"
import { CONTACT_EMAIL, MINIMUM_AGE, TERMS_VERSION } from "@/lib/legal"

export const metadata = {
  title: "Terms — Solarity",
  description: "The rules for using Solarity.",
}

/**
 * **Versioned by `TERMS_VERSION`, and nothing records acceptance.** Google
 * sign-in is the only way in and it never shows a checkbox, so there is no
 * moment at which anyone agrees to anything. Saying so here is more useful than
 * a sentence claiming consent that was never collected.
 *
 * Not legal advice; have it reviewed before real users.
 */
export default function TermsPage() {
  return (
    <PolicyPage
      title="Terms"
      version={TERMS_VERSION}
      intro="Short, because Solarity is small. Using it means agreeing to these."
    >
      <PolicySection heading="What Solarity is">
        <p>
          A place to set daily goals and let a few friends see whether you kept
          them. Circles are invite-only and hold at most ten people.
        </p>
        <p className="opacity-70">
          It is run by one person, early in its life, and free. Expect it to
          change.
        </p>
      </PolicySection>

      <PolicySection heading="Who can use it">
        <p>
          You need to be <strong>{MINIMUM_AGE} or older</strong>. One account per
          person. Do not use someone else&apos;s account or let them use yours.
        </p>
      </PolicySection>

      <PolicySection heading="What you put in it">
        <p>
          Your goals, notes and photos stay yours. You give Solarity permission
          to store them and to show them to the Circles you chose, which is the
          only thing it does with them.
        </p>
        <p>
          <strong>Do not post</strong> anything illegal, anything that harasses
          another person, or a photo of someone who has not agreed to be in it.
          Anything sexual involving a minor will be reported.
        </p>
        <p className="opacity-70">
          Accounts that break these can be removed without notice. There are no
          automated content checks — it is a small app, and this runs on people
          telling me.
        </p>
      </PolicySection>

      <PolicySection heading="Reporting, and blocking">
        <p>
          You can <strong>report</strong> a photo, a note or a profile belonging
          to someone in one of your Circles. An administrator reads what was
          reported and records whether they reviewed, actioned or dismissed it.
          Reports are not anonymous to the administrator, and the person you
          reported is not told who reported them.
        </p>
        <p>
          You can <strong>block</strong> anyone. Blocking hides your profile from
          them and theirs from you. It does not remove either of you from a
          Circle you both joined, and it does not tell them. Undo it in settings.
        </p>
        <p className="opacity-70">
          Reporting is for content that breaks these terms. Filing reports about
          somebody you simply disagree with is itself a misuse of it — block them
          instead.
        </p>
      </PolicySection>

      <PolicySection heading="What you can expect from it">
        <p>
          <strong>No guarantees.</strong> Solarity is provided as it is, with no
          promise that it will be available, that a push notification will
          arrive, or that nothing will be lost. Do not use it as the only place
          something important is stored.
        </p>
        <p>
          <strong>Streaks are a feature, not a record.</strong> They can be
          affected by things outside your control, including changes to how a
          Circle works, and there is no compensation for a lost one.
        </p>
      </PolicySection>

      <PolicySection heading="Ending it">
        <p>
          You can stop at any time.{" "}
          <Link href="/settings" className="underline">
            Delete your account from settings
          </Link>
          ; it happens immediately and cannot be undone. See{" "}
          <Link href="/privacy" className="underline">
            Privacy
          </Link>{" "}
          for exactly what that removes and what it leaves. If you would rather
          write, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>{" "}
          and it will be done for you.
        </p>
        <p>
          Solarity can close an account that breaks these terms, and can shut
          down entirely. If it shuts down, you will be told with enough notice to
          export your data.
        </p>
      </PolicySection>

      <PolicySection heading="Changes">
        <p>
          These may change. The date at the top says when they last did, and a
          change that matters will be shown in the app before it takes effect.
        </p>
      </PolicySection>

      <PolicySection heading="Getting in touch">
        <p>
          Everything goes to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </PolicySection>
    </PolicyPage>
  )
}
