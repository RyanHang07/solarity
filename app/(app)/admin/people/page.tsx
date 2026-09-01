import { listAdmins } from "@/app/actions/admin"
import { RoleForm } from "./role-form"

/**
 * Step 17. Who can moderate.
 *
 * **The build plan's first position was that this screen should not exist.** A
 * UI that grants admin is the highest-value target in the product: one
 * compromised admin session becomes every admin session. It is here because it
 * was asked for, and the guards that make it defensible are in
 * `admin_set_role` rather than on this page — you cannot change your own role,
 * the last admin cannot be revoked, and every grant and revoke writes an audit
 * row naming who did it.
 *
 * The list is the reviewable part. A privilege whose holders you cannot
 * enumerate is one nobody can audit.
 */
export default async function AdminPeoplePage() {
  const admins = await listAdmins()

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Administrators" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Administrators</h2>
        <ul className="flex flex-col gap-2">
          {admins.map((a) => (
            <li
              key={a.user_id}
              className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
            >
              <span>
                {a.username}
                {a.display_name ? (
                  <span className="opacity-60"> · {a.display_name}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs opacity-60">
          {/*
            Says the two rules before somebody discovers them as refusals. Both
            are enforced in the database; this is the courtesy.
          */}
          An admin can read the content of any report. You can&apos;t change your
          own role, and the last administrator can&apos;t be removed.
        </p>
      </section>

      <RoleForm />
    </div>
  )
}
