/**
 * One-off check that the Brevo SMTP credentials work.
 *
 * Deliberately does not involve Supabase. If this succeeds, the credentials
 * and the verified sender are correct, and any remaining problem is Supabase
 * configuration. If it fails, the error names which of the two is wrong.
 *
 *   npm i -D nodemailer
 *   node --env-file=.env.local scripts/test-email.mjs you@example.com
 *
 * Requires in .env.local (server-only, never NEXT_PUBLIC_):
 *   BREVO_SMTP_LOGIN=xxxxxx@smtp-brevo.com
 *   BREVO_SMTP_KEY=<the SMTP key, not an API key>
 *   BREVO_SENDER=<the address verified in Brevo>
 *
 * Safe to delete once email is known good. The same three variables are
 * needed again for the support contact form.
 */
import nodemailer from "nodemailer"

// Recipient from the command line locally, or from the environment in CI,
// where the monthly heartbeat workflow has no argument to pass.
const to = process.argv[2] || process.env.BREVO_ALERT_TO || process.env.BREVO_SENDER
if (!to) {
  console.error("Usage: node --env-file=.env.local scripts/test-email.mjs you@example.com")
  process.exit(1)
}

const { BREVO_SMTP_LOGIN, BREVO_SMTP_KEY, BREVO_SENDER } = process.env
const missing = Object.entries({ BREVO_SMTP_LOGIN, BREVO_SMTP_KEY, BREVO_SENDER })
  .filter(([, v]) => !v)
  .map(([k]) => k)

if (missing.length) {
  console.error("Missing from .env.local:", missing.join(", "))
  process.exit(1)
}

if (!BREVO_SMTP_LOGIN.endsWith("@smtp-brevo.com")) {
  console.error(
    `BREVO_SMTP_LOGIN is "${BREVO_SMTP_LOGIN}".\n` +
      "That should be the generated login from Settings > SMTP & API, which ends\n" +
      "in @smtp-brevo.com. Your Brevo account email will not authenticate.",
  )
  process.exit(1)
}

const transport = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false, // STARTTLS is negotiated on 587
  auth: { user: BREVO_SMTP_LOGIN, pass: BREVO_SMTP_KEY },
})

try {
  await transport.verify()
  console.log("Authenticated with smtp-relay.brevo.com")
} catch (err) {
  console.error("\nAuthentication failed.")
  console.error(err.message)
  console.error(
    "\nAlmost always one of:\n" +
      "  - an API key used where an SMTP key is required (they sit side by side)\n" +
      "  - the Brevo account email used instead of the @smtp-brevo.com login\n" +
      "  - a key that expired, including the 90-day inactivity expiry",
  )
  process.exit(1)
}

try {
  const info = await transport.sendMail({
    from: `"Solarity" <${BREVO_SENDER}>`,
    to,
    subject: "Solarity SMTP test",
    text: "If you are reading this, Brevo SMTP works. Check whether it landed in spam.",
  })
  console.log("Accepted by Brevo. Message id:", info.messageId)
  console.log("\nNow check two places:")
  console.log("  1. The inbox, and the spam folder. Both matter.")
  console.log("  2. Brevo > Transactional > Logs, for delivered vs blocked.")
} catch (err) {
  console.error("\nAccepted authentication but refused the message.")
  console.error(err.message)
  console.error(
    "\nUsually the sender: BREVO_SENDER must exactly match an address verified\n" +
      "under Settings > Senders, Domains, IPs.",
  )
  process.exit(1)
}
