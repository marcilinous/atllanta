"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAsset, updateAsset } from "@/src/lib/hrms/assets/actions";
import { ASSET_TYPES, EDITABLE_STATUSES } from "@/src/lib/hrms/assets/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Asset = {
  id: string;
  name: string;
  type: string;
  serialNumber: string | null;
  status: string;
  purchaseDate: string | null;
  purchaseCost: number | null;
  warrantyEnd: string | null;
  notes: string | null;
};

const STATUS_LABELS: Record<(typeof EDITABLE_STATUSES)[number], string> = {
  available: "Available",
  maintenance: "Maintenance",
  retired: "Retired",
};

const selectClass = "h-9 w-full rounded-md border border-border bg-field px-2 text-sm";

export default function AssetForm({
  mode,
  currency,
  asset,
}: {
  mode: "create" | "edit";
  currency: string;
  asset?: Asset;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const fe = (key: string) => fieldErrors[key]?.[0];
  const editing = mode === "edit" && asset ? asset : null;
  const held = editing?.status === "assigned";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaved(null);
    if (!formRef.current) return;
    const fd = new FormData(formRef.current);
    const text = (key: string) => String(fd.get(key) ?? "");
    const fields = {
      name: text("name"),
      type: text("type") as (typeof ASSET_TYPES)[number],
      serialNumber: text("serialNumber"),
      purchaseDate: text("purchaseDate"),
      purchaseCost: text("purchaseCost"),
      warrantyEnd: text("warrantyEnd"),
      notes: text("notes"),
    };

    startTransition(async () => {
      const res = editing
        ? await updateAsset({
            ...fields,
            assetId: editing.id,
            // A held asset keeps its status on the server; any editable value satisfies the schema.
            status: (held ? "available" : text("status")) as (typeof EDITABLE_STATUSES)[number],
          })
        : await createAsset(fields);

      if (res.success) {
        setSaved(editing ? "Saved." : "Asset added.");
        if (!editing) formRef.current?.reset();
        router.refresh();
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    });
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="asset-name">Name</Label>
        <Input id="asset-name" name="name" required maxLength={200} defaultValue={editing?.name ?? ""} />
        {fe("name") ? <p className="text-xs text-destructive">{fe("name")}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asset-type">Type</Label>
          <select id="asset-type" name="type" className={selectClass} defaultValue={editing?.type ?? "Laptop"}>
            {ASSET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {fe("type") ? <p className="text-xs text-destructive">{fe("type")}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asset-serial">Serial number (optional)</Label>
          <Input id="asset-serial" name="serialNumber" maxLength={100} defaultValue={editing?.serialNumber ?? ""} />
          {fe("serialNumber") ? <p className="text-xs text-destructive">{fe("serialNumber")}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asset-purchase-date">Purchase date (optional)</Label>
          <Input id="asset-purchase-date" name="purchaseDate" type="date" defaultValue={editing?.purchaseDate ?? ""} />
          {fe("purchaseDate") ? <p className="text-xs text-destructive">{fe("purchaseDate")}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asset-purchase-cost">Purchase cost ({currency}, optional)</Label>
          <Input
            id="asset-purchase-cost"
            name="purchaseCost"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            defaultValue={editing?.purchaseCost != null ? String(editing.purchaseCost) : ""}
          />
          {fe("purchaseCost") ? <p className="text-xs text-destructive">{fe("purchaseCost")}</p> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="asset-warranty-end">Warranty ends (optional)</Label>
          <Input id="asset-warranty-end" name="warrantyEnd" type="date" defaultValue={editing?.warrantyEnd ?? ""} />
          {fe("warrantyEnd") ? <p className="text-xs text-destructive">{fe("warrantyEnd")}</p> : null}
        </div>
        {editing ? (
          <div className="flex flex-col gap-1.5">
            {held ? (
              <p className="mt-6 text-xs text-muted-foreground">
                Assigned assets stay assigned until they are marked returned.
              </p>
            ) : (
              <>
                <Label htmlFor="asset-status">Status</Label>
                <select id="asset-status" name="status" className={selectClass} defaultValue={editing.status}>
                  {EDITABLE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
                {fe("status") ? <p className="text-xs text-destructive">{fe("status")}</p> : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="asset-notes">Notes (optional)</Label>
        <textarea
          id="asset-notes"
          name="notes"
          maxLength={1000}
          rows={2}
          defaultValue={editing?.notes ?? ""}
          className="w-full rounded-md border border-border bg-field px-3 py-2 text-sm"
        />
        {fe("notes") ? <p className="text-xs text-destructive">{fe("notes")}</p> : null}
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-muted-foreground">
          {saved}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending} className="self-start">
        {editing ? (isPending ? "Saving…" : "Save changes") : isPending ? "Adding…" : "Add asset"}
      </Button>
    </form>
  );
}
