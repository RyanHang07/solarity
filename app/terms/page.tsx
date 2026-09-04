import Link from "next/link"
import { PolicyPage, PolicySection } from "@/components/policy-page"
import {
  CONTACT_EMAIL,
  CONTROLLER_NAME,
  MINIMUM_AGE,
  TERMS_VERSION,
} from "@/lib/legal"

export const metadata = {
  title: "Terms — Solarity",
  description: "The rules for using Solarity.",
}

/**
 * **Versioned by `TERMS_VERSION`, and acceptance is recorded.** Migration 105
 * added the columns, step 20c added `/onboarding/terms`, and `acceptTerms`
 * writes the date and the version against the account. This comment claimed
 * the opposite until 4 September — written when Google sign-in was the only way
 * in and there was no checkbox anywhere — which made it the oldest untrue
 * sentence about this page, sitting directly above the page.
 *
 * **What is still not built**, so nobody assumes it from the above: the gate
 * checks that a date exists and never compares versions, so moving
 * `TERMS_VERSION` re-prompts nobody. Fine for a clarification, not enough for a
 * substantive change to the deal.
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
          It is run by {CONTROLLER_NAME}, one person, early in its life, and
          free. Expect it to change. There is no company behind it, which is
          worth knowing before you rely on it for anything.
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
          to store them and to show them to the Circles you chose. It does
          nothing else with them, with one exception: if somebody reports a note
          or a photo, an administrator can read that one thing in order to judge
          the report.
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
          down entirely. If it shuts down, the notice will be on this site, and
          the export in your settings keeps working for as long as the site is
          up.
        </p>
        <p className="opacity-70">
          {/*
            **Twice wrong, in opposite directions.** It first promised you would
            "be told with enough notice", which no mechanism could keep. That
            was corrected to "sends you no email" — true when written, false
            from step 20, which added confirmation and password-reset mail.

            The distinction that survives both is the one worth stating: the app
            can send *transactional* mail and has no announcement channel. So
            the advice stands, and the reason for it is now accurate.
          */}
          The only email Solarity sends is about your own account — confirming
          your address, resetting your password. There is no announcement list
          and no way to be told about a change here, so if that matters to you,
          export your data now and again rather than relying on being warned.
        </p>
      </PolicySection>

      <PolicySection heading="Changes">
        <p>
          These may change. The date at the top says when they last did, and
          continuing to use Solarity after that date is what agreement to the
          new version looks like.
        </p>
        <p className="opacity-70">
          {/*
            **This paragraph said the opposite until step 20c**, and it was
            true when it was written: Google sign-in shows no checkbox, so
            nothing recorded acceptance and `TERMS_VERSION` was a dated constant
            with no writer. Migration 105 gave it one and 20c gave it a screen,
            so the honest sentence is now the other one. The rule from the legal
            pass, applied to itself: when the code changes what happens to
            somebody's data, the page changes in the same commit.
          */}
          Solarity records the date you agreed and which version you agreed to,
          against your account, and nothing else. If you signed in before there
          was anything to agree to, you were asked once.
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
