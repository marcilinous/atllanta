import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { featureContext } from "@/src/lib/auth/permissions";
import { loadLeaveApprovals } from "@/src/lib/hrms/leave/queries";
import ApprovalsList from "./approvals-list";

export default async function LeaveApprovalsPage() {
  if (!(await getSessionUser())) redirect("/login");
  // Both gates, with the approve permission (managers, admins and owners by
  // default; a custom role can grant or narrow it).
  const ctx = await featureContext("me", "me", "approve");
  if (!ctx) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-base font-semibold">Approvals are for managers and admins</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your leave requests are under My leave.</p>
      </div>
    );
  }
  const rows = await loadLeaveApprovals(ctx);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">Waiting for your decision</h2>
        <p className="text-sm text-muted-foreground">
          Leave from the people you look after. You never see your own requests here, and an owner&rsquo;s or
          admin&rsquo;s leave goes to an admin or another owner.
        </p>
      </div>
      <ApprovalsList rows={rows} />
    </section>
  );
}
