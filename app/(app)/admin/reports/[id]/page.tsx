import Link from "next/link"
import { notFound } from "next/navigation"
import { reportDetail } from "@/app/actions/admin"
import { ResolveForm } from "./resolve-form"

/**
 * Step 17. One report, and the thing it is about.
 *
 * **This is the only screen in the product that shows one person's private
 * content to another.** What makes that defensible is its narrowness: the RPC
 * returns the reported item and nothing else, so there is no way to reach a
 * second note, a different day, or anything nobody complained about. An admin
 * cannot browse from here.
 */

const SAYS: Record<string, string> = {
  checkin_photo: "Check-in photo",
  checkin_note: "Check-in note",
  user_profile: "Profile",
  planet_avatar: "Avatar",
}

export default async function AdminReportPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const report = await reportDetail(id)
  if (!report) notFound()

  const isCheckin =
    report.content_type === "checkin_photo" || report.content_type === "checkin_note"

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin" className="text-sm underline opacity-70">
        ← Back to reports
      </Link>

      <section aria-label="Report" className="flex flex-col gap-1 text-sm">
        <h2 className="text-lg font-semibold">
          {SAYS[report.content_type] ?? report.content_type}
        </h2>
        <p className="opacity-70">
          About{" "}
          {report.reported_username ? (
            // A link out, because deciding often needs the context the profile
            // gives — and it is a page any signed-in user can already open.
            <Link
              href={`/profile/${report.reported_username}`}
              className="underline"
            >
              {report.reported_username}
            </Link>
          ) : (
            "a deleted account"
          )}
          . Reported by {report.reporter_username ?? "a deleted account"} on{" "}
          {new Date(report.created_at).toLocaleString()}.
        </p>
        <p className="opacity-70">
          Status: <strong>{report.status}</strong>
          {report.reviewed_at
            ? ` · ${new Date(report.reviewed_at).toLocaleString()}`
            : null}
        </p>
      </section>

      <section aria-label="Reason" className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Why it was reported</h3>
        {report.reason ? (
          // `whitespace-pre-wrap`, because a reason is free text somebody typed
          // and line breaks are part of what they said.
          <p className="whitespace-pre-wrap rounded border px-3 py-2 text-sm">
            {report.reason}
          </p>
        ) : (
          <p className="text-sm opacity-60">No reason was given.</p>
        )}
      </section>

      <section aria-label="Reported content" className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">What was reported</h3>

        {isCheckin ? (
          <>
            <p className="text-xs opacity-60">
              Check-in on {report.checkin_date ?? "an unknown date"}.
            </p>

            {report.note ? (
              <p className="whitespace-pre-wrap rounded border px-3 py-2 text-sm">
                {report.note}
              </p>
            ) : null}

            {report.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={report.photoUrl}
                alt="The reported check-in photo"
                className="max-w-sm rounded border"
              />
            ) : null}

            {!report.note && !report.photoUrl ? (
              /*
                **Three different absences, one message, and that is deliberate.**
                The entry may have been deleted, the photo purged by the 90-day
                retention sweep, or the reference may not parse. A moderator can
                act the same way on all three — there is nothing to look at — and
                distinguishing them would be detail about our storage rather than
                about the report.
              */
              <p className="text-sm opacity-60">
                The reported content is no longer available. It may have been
                deleted, or the photo may have passed the 90-day retention
                window. The report can still be resolved.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm opacity-70">
            {/* A profile report points at the account itself, so the profile
                link above is the content. Nothing more to render here. */}
            The profile itself was reported. Open it above to review the
            username, display name and picture.
          </p>
        )}
      </section>

      <ResolveForm reportId={report.id} current={report.status} />
    </div>
  )
}
