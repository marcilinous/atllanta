import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { featureContext } from "@/src/lib/auth/permissions";
import { loadMyAssets } from "@/src/lib/hrms/assets/queries";
import { formatDate } from "../format";
import { WarrantyBadge } from "./asset-badges";

export default async function MyAssetsPage() {
  if (!(await getSessionUser())) redirect("/login");
  // Self-service: what you hold is yours to see, like your own leave and
  // attendance. The database shows a non-admin only their own assets.
  const ctx = await featureContext("me", "me", "view");
  if (!ctx) return <NotAvailable />;
  const data = await loadMyAssets(ctx);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Assigned to you</h2>
      {data.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No company assets are assigned to you.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {data.rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">
                  {a.type}
                  {a.serialNumber ? ` · Serial ${a.serialNumber}` : null}
                  {a.assignedOn ? ` · Since ${formatDate(a.assignedOn)}` : null}
                </p>
              </div>
              <WarrantyBadge warrantyEnd={a.warrantyEnd} today={data.today} />
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Something missing or wrong? Tell an owner or admin. They keep the asset register.
      </p>
    </section>
  );
}

function NotAvailable() {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <h2 className="text-base font-semibold">Assets aren&rsquo;t available to you</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your organisation hasn&rsquo;t switched this on, or it&rsquo;s hidden for your role. Ask an owner or admin.
      </p>
    </div>
  );
}
