import Link from "next/link"
import { reportQueue, type ReportStatus } from "@/app/actions/admin"

/**
 * Step 17. The report queue.
 *
 * **Oldest first, and that is decided in the RPC.** A queue people work through
 * is not a feed: the newest report is the least likely to be the one that has
 * been waiting.
 *
 * `?status=` rather than client state, matching `/circles/[id]`: server-read,
 * deep-linkable, and an unknown value falls back to `pending` rather than
 * rendering nothing.
 */

const TABS: { key: ReportStatus; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "reviewed", label: "Reviewed" },
  { key: "actioned", label: "Actioned" },
  { key: "dismissed", label: "Dismissed" },
]

const SAYS: Record<string, string> = {
  checkin_photo: "a check-in photo",
  checkin_note: "a check-in note",
  user_profile: "a profile",
  planet_avatar: "an avatar",
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const { status } = await searchParams
  const active = (TABS.find((t) => t.key === status)?.key ?? "pending") as ReportStatus
  const reports = await reportQueue(active)

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex gap-3 border-b text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin?status=${t.key}`}
            aria-current={active === t.key ? "page" : undefined}
            className={`px-1 pb-2 ${
              active === t.key ? "border-b-2 font-medium" : "opacity-70"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {reports.length === 0 ? (
        // An empty queue is the good outcome and should read like one.
        <p className="text-sm opacity-70">Nothing {active}.</p>
      ) : (
        <ul aria-label="Reports" className="flex flex-col gap-2">
          {reports.map((r) => (
            <li key={r.id} className="rounded border px-3 py-2 text-sm">
              <Link href={`/admin/reports/${r.id}`} className="flex flex-col gap-1">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span>
                    <strong>{r.reported_username ?? "a deleted account"}</strong>
                    {" · "}
                    {SAYS[r.content_type] ?? r.content_type}
                  </span>
                  <span className="text-xs opacity-60">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </span>

                {/* The reason, truncated. The full text is on the report page;
                    a queue is for choosing what to open. */}
                {r.reason ? (
                  <span className="line-clamp-2 text-xs opacity-70">{r.reason}</span>
                ) : (
                  <span className="text-xs opacity-50">No reason given</span>
                )}

                <span className="text-xs opacity-60">
                  Reported by {r.reporter_username ?? "a deleted account"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
