"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignAsset, deleteAsset, returnAsset } from "@/src/lib/hrms/assets/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function AssetActions({
  assetId,
  status,
  holderName,
  people,
}: {
  assetId: string;
  status: string;
  holderName: string | null;
  people: { id: string; name: string; email: string | null }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedUser, setSelectedUser] = useState("");
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleAssign = () => {
    if (!selectedUser) {
      setError("Choose a person.");
      return;
    }
    startTransition(async () => {
      const res = await assignAsset({ assetId, userId: selectedUser, notes: note });
      if (res.success) {
        setError(null);
        setSelectedUser("");
        setNote("");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const handleReturn = () => {
    startTransition(async () => {
      const res = await returnAsset({ assetId });
      if (res.success) {
        setError(null);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const res = await deleteAsset({ assetId });
      if (res.success) {
        setError(null);
        router.push("/hrms/assets/register");
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {status === "available" || status === "maintenance" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asset-assign-person">Assign to</Label>
            <select
              id="asset-assign-person"
              className="h-9 w-full rounded-md border border-border bg-field px-2 text-sm"
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
            >
              <option value="">Choose a person</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.email ? ` (${p.email})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asset-assign-note">Note (optional)</Label>
            <textarea
              id="asset-assign-note"
              rows={2}
              maxLength={500}
              className="w-full rounded-md border border-border bg-field px-3 py-2 text-sm"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <Button type="button" disabled={isPending} onClick={handleAssign} className="self-start">
            {isPending ? "Assigning…" : "Assign"}
          </Button>
        </div>
      ) : null}

      {status === "assigned" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm">Held by {holderName ?? "someone"}</p>
          <Button type="button" variant="outline" disabled={isPending} onClick={handleReturn}>
            {isPending ? "Returning…" : "Mark returned"}
          </Button>
        </div>
      ) : null}

      {status !== "assigned" ? (
        confirmDelete ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm">Delete this asset and its history? This can&rsquo;t be undone.</span>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="destructive" disabled={isPending} onClick={handleDelete}>
                {isPending ? "Deleting…" : "Yes, delete"}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="self-start text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            Delete asset
          </Button>
        )
      ) : null}
    </div>
  );
}
