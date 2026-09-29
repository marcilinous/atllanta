import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { featureContext } from "@/src/lib/auth/permissions";
import { loadMyLeave } from "@/src/lib/hrms/leave/queries";
import LeaveRequestForm from "./leave-request-form";
import MyRequests from "./my-requests";

export default async function MyLeavePage() {
  if (!(await getSessionUser())) redirect("/login");
  // Both gates: the `me` module is on for the org and this person may see it.
  const ctx = await featureContext("me", "me", "view");
  if (!ctx) return <NotAvailable />;
  const data = await loadMyLeave(ctx);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Balance · {data.year}</h2>
        {data.balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leave balances have been set up for you this year.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {data.balances.map((b) => (
              <li key={b.leaveTypeId} className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">{b.name}</p>
                <p className="text-2xl font-semibold">{b.balance - b.pending}</p>
                <p className="text-xs text-muted-foreground">
                  {b.used} used{b.pending > 0 ? ` · ${b.pending} pending` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Request leave</h2>
        {data.types.length === 0 ? (
          <p className="text-sm text-muted-foreground">Your organisation has not set up any leave types yet.</p>
        ) : (
          <div className="max-w-xl rounded-lg border border-border bg-card p-4">
            <LeaveRequestForm types={data.types} balances={data.balances} />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">My requests</h2>
        <MyRequests requests={data.requests} />
      </section>
    </div>
  );
}

function NotAvailable() {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <h2 className="text-base font-semibold">Leave isn&rsquo;t available to you</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your organisation hasn&rsquo;t switched it on, or it&rsquo;s hidden for your role. Ask an owner or admin.
      </p>
    </div>
  );
}
