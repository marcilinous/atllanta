import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { featureContext } from "@/src/lib/auth/permissions";
import { loadMyExpenses } from "@/src/lib/hrms/expenses/queries";
import { orgTimeZone } from "@/src/lib/hrms/attendance/queries";
import { dayIn } from "@/src/lib/hrms/attendance/schemas";
import { formatMoney } from "../format";
import ExpenseForm from "./expense-form";
import MyClaims from "./my-claims";

export default async function MyExpensesPage() {
  if (!(await getSessionUser())) redirect("/login");
  // Both gates: the Finance module is on for the org and this person may see it.
  const ctx = await featureContext("finance", "finance", "view");
  if (!ctx) return <NotAvailable />;
  const [data, timeZone] = await Promise.all([loadMyExpenses(ctx), orgTimeZone(ctx)]);
  const canSubmit = (await featureContext("finance", "finance", "create")) !== null;

  const cards = [
    { label: "Pending", total: data.totals.pending },
    { label: "Approved", total: data.totals.approved },
    { label: "Reimbursed", total: data.totals.reimbursed },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">My totals</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {cards.map((c) => (
            <li key={c.label} className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">{c.label}</p>
              <p className="text-2xl font-semibold">{formatMoney(c.total.amount, data.currency)}</p>
              <p className="text-xs text-muted-foreground">
                {c.total.count} claim{c.total.count === 1 ? "" : "s"}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {canSubmit ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">New claim</h2>
          <div className="max-w-xl rounded-lg border border-border bg-card p-4">
            <ExpenseForm categories={data.categories} currency={data.currency} today={dayIn(timeZone)} />
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">My claims</h2>
        <MyClaims claims={data.claims} />
      </section>
    </div>
  );
}

function NotAvailable() {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <h2 className="text-base font-semibold">Expenses aren&rsquo;t available to you</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your organisation hasn&rsquo;t switched Finance on, or it&rsquo;s hidden for your role. Ask an owner or admin.
      </p>
    </div>
  );
}
