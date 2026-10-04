import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { featureContext } from "@/src/lib/auth/permissions";
import { loadAttendanceApprovals } from "@/src/lib/hrms/attendance/queries";
import CorrectionApprovals from "./correction-approvals";
import { formatTime } from "../../format";

export default async function AttendanceApprovalsPage() {
  if (!(await getSessionUser())) redirect("/login");
  // Both gates, with the approve permission (managers, admins and owners by
  // default; a custom role can grant or narrow it).
  const ctx = await featureContext("me", "me", "approve");
  if (!ctx) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-base font-semibold">Approvals are for managers and admins</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your attendance is under My attendance.</p>
      </div>
    );
  }
  const data = await loadAttendanceApprovals(ctx);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Corrections waiting for you</h2>
          <p className="text-sm text-muted-foreground">
            Approving applies the corrected times to that day. You never see your own requests here, and an
            owner&rsquo;s or admin&rsquo;s goes to an admin or another owner.
          </p>
        </div>
        <CorrectionApprovals rows={data.pending} timeZone={data.timeZone} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Checked in today</h2>
        {data.teamToday.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nobody has checked in yet today.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {data.teamToday.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground">
                  In {formatTime(p.checkIn, data.timeZone)} · Out {formatTime(p.checkOut, data.timeZone)}
                  {p.status !== "present" ? ` · ${p.status}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
