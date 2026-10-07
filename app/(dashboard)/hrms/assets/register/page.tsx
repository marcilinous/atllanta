import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/src/lib/supabase/server";
import { assetAdminContext, loadRegister } from "@/src/lib/hrms/assets/queries";
import { ASSET_STATUSES, ASSET_TYPES, registerFilterSchema } from "@/src/lib/hrms/assets/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "../../format";
import { StatusBadge, WarrantyBadge } from "../asset-badges";
import AssetForm from "../asset-form";

const selectClass = "h-9 rounded-md border border-border bg-field px-2 text-sm";
const STATUS_LABELS: Record<string, string> = {
  available: "Available",
  assigned: "Assigned",
  maintenance: "Maintenance",
  retired: "Retired",
};

export default async function AssetRegisterPage({ searchParams }: PageProps<"/hrms/assets/register">) {
  if (!(await getSessionUser())) redirect("/login");
  // Both gates for People, owners and admins only — the people the database
  // lets see the whole register.
  const ctx = await assetAdminContext();
  if (!ctx) return <NotAvailable />;

  const filter = registerFilterSchema.parse(await searchParams);
  const data = await loadRegister(ctx, filter);
  const filtered = Boolean(filter.q || filter.type || filter.status);

  const cards = [
    { label: "Total", value: data.totals.total },
    { label: "Assigned", value: data.totals.assigned },
    { label: "Available", value: data.totals.available },
    { label: "Maintenance", value: data.totals.maintenance },
  ];

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="sr-only">Totals</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {cards.map((c) => (
            <li key={c.label} className="rounded-lg border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">{c.label}</p>
              <p className="text-2xl font-semibold">{c.value}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Register</h2>
        <form method="get" className="flex flex-wrap items-end gap-2" role="search">
          <label className="sr-only" htmlFor="asset-search">
            Search
          </label>
          <Input
            id="asset-search"
            name="q"
            defaultValue={filter.q}
            placeholder="Name, serial or person"
            className="w-56"
          />
          <label className="sr-only" htmlFor="asset-filter-type">
            Type
          </label>
          <select id="asset-filter-type" name="type" defaultValue={filter.type} className={selectClass}>
            <option value="">All types</option>
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="asset-filter-status">
            Status
          </label>
          <select id="asset-filter-status" name="status" defaultValue={filter.status} className={selectClass}>
            <option value="">All statuses</option>
            {ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline" size="sm">
            Filter
          </Button>
          {filtered ? (
            <Link href="/hrms/assets/register" className="text-sm text-primary hover:underline">
              Clear
            </Link>
          ) : null}
        </form>

        {data.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {filtered ? "No assets match. Try other filters." : "No assets yet. Add one below to start the register."}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Serial</th>
                  <th className="px-4 py-2 font-medium">Held by</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Warranty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((a) => (
                  <tr key={a.id}>
                    <td className="px-4 py-2">
                      <Link href={`/hrms/assets/register/${a.id}`} className="font-medium text-primary hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{a.type}</td>
                    <td className="px-4 py-2 text-muted-foreground">{a.serialNumber ?? "—"}</td>
                    <td className="px-4 py-2">
                      {a.holderName ? (
                        <>
                          {a.holderName}
                          {a.assignedOn ? (
                            <span className="block text-xs text-muted-foreground">since {formatDate(a.assignedOn)}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={a.status} />
                    </td>
                    <td className="px-4 py-2">
                      <WarrantyBadge warrantyEnd={a.warrantyEnd} today={data.today} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Add an asset</h2>
        <div className="max-w-xl rounded-lg border border-border bg-card p-4">
          <AssetForm mode="create" currency={data.currency} />
        </div>
      </section>
    </div>
  );
}

function NotAvailable() {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <h2 className="text-base font-semibold">The asset register is for owners and admins</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You can see the assets assigned to you under My assets.
      </p>
    </div>
  );
}
