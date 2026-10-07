import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser } from "@/src/lib/supabase/server";
import { assetAdminContext, loadAsset } from "@/src/lib/hrms/assets/queries";
import { formatDate, formatMoney } from "../../../format";
import { StatusBadge, WarrantyBadge } from "../../asset-badges";
import AssetActions from "../../asset-actions";
import AssetForm from "../../asset-form";

export default async function AssetPage({ params }: PageProps<"/hrms/assets/register/[assetId]">) {
  if (!(await getSessionUser())) redirect("/login");
  // Both gates for People, owners and admins only.
  const ctx = await assetAdminContext();
  if (!ctx) return <Missing title="The asset register is for owners and admins" />;

  const { assetId } = await params;
  const id = z.uuid().safeParse(assetId);
  const data = id.success ? await loadAsset(ctx, id.data) : null;
  if (!data) return <Missing title="That asset wasn’t found" />;
  const { asset } = data;

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Type", value: asset.type },
    { label: "Serial", value: asset.serialNumber ?? "—" },
    { label: "Status", value: <StatusBadge status={asset.status} /> },
    {
      label: "Held by",
      value: asset.holderName
        ? `${asset.holderName}${asset.assignedOn ? ` since ${formatDate(asset.assignedOn)}` : ""}`
        : "—",
    },
    {
      label: "Purchased",
      value: asset.purchaseDate
        ? `${formatDate(asset.purchaseDate)}${asset.purchaseCost != null ? ` · ${formatMoney(asset.purchaseCost, data.currency)}` : ""}`
        : asset.purchaseCost != null
          ? formatMoney(asset.purchaseCost, data.currency)
          : "—",
    },
    {
      label: "Warranty",
      value: (
        <span className="inline-flex items-center gap-2">
          {asset.warrantyEnd ? formatDate(asset.warrantyEnd) : null}
          <WarrantyBadge warrantyEnd={asset.warrantyEnd} today={data.today} />
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <Link href="/hrms/assets/register" className="text-sm text-primary hover:underline">
          &larr; Register
        </Link>
        <h2 className="text-xl font-semibold">{asset.name}</h2>
      </div>

      <section className="grid gap-6 md:grid-cols-2">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-border bg-card p-4 text-sm">
          {facts.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
          {asset.notes ? (
            <div className="contents">
              <dt className="text-muted-foreground">Notes</dt>
              <dd className="whitespace-pre-line">{asset.notes}</dd>
            </div>
          ) : null}
        </dl>
        <div className="rounded-lg border border-border bg-card p-4">
          <AssetActions
            assetId={asset.id}
            status={asset.status}
            holderName={asset.holderName}
            people={data.people}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">History</h2>
        {data.history.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Never assigned yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {data.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="flex flex-col gap-0.5">
                  <p className="font-medium">{h.personName}</p>
                  {h.assignedByName ? (
                    <p className="text-xs text-muted-foreground">Assigned by {h.assignedByName}</p>
                  ) : null}
                  {h.notes ? <p className="text-xs text-muted-foreground">{h.notes}</p> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDate(h.assignedOn)} &rarr; {h.returnedOn ? formatDate(h.returnedOn) : "now"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Edit details</h2>
        <div className="max-w-xl rounded-lg border border-border bg-card p-4">
          <AssetForm mode="edit" currency={data.currency} asset={asset} />
        </div>
      </section>
    </div>
  );
}

function Missing({ title }: { title: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-8 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm">
        <Link href="/hrms/assets" className="text-primary hover:underline">
          Back to Assets
        </Link>
      </p>
    </div>
  );
}
