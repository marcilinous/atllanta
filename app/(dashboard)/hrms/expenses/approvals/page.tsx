import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { featureContext } from "@/src/lib/auth/permissions";
import { loadExpenseApprovals } from "@/src/lib/hrms/expenses/queries";
import ReviewList from "./review-list";

export default async function ExpenseApprovalsPage() {
  if (!(await getSessionUser())) redirect("/login");
  // Both gates, with the approve permission (managers, admins and owners by
  // default; a custom role can grant or narrow it).
  const ctx = await featureContext("finance", "finance", "approve");
  if (!ctx) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <h2 className="text-base font-semibold">Approvals are for managers and admins</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your claims are under My expenses.</p>
      </div>
    );
  }
  const data = await loadExpenseApprovals(ctx);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold">Waiting for your decision</h2>
          <p className="text-sm text-muted-foreground">
            Claims from the people you look after. You never see your own claims here, and an owner&rsquo;s or
            admin&rsquo;s claim goes to an admin or another owner.
          </p>
        </div>
        <ReviewList rows={data.pending} mode="decide" />
      </section>

      {data.canReimburse ? (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-semibold">To reimburse</h2>
            <p className="text-sm text-muted-foreground">
              Approved claims waiting to be paid. Mark one reimbursed once the money has gone out.
            </p>
          </div>
          <ReviewList rows={data.toReimburse} mode="reimburse" />
        </section>
      ) : null}
    </div>
  );
}
