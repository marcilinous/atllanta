"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideCorrection } from "@/src/lib/hrms/attendance/actions";
import type { CorrectionApprovalRow } from "@/src/lib/hrms/attendance/queries";
import { Button } from "@/components/ui/button";
import { formatDate, formatTime } from "../../format";

export default function CorrectionApprovals({ rows, timeZone }: { rows: CorrectionApprovalRow[]; timeZone: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const decide = (row: CorrectionApprovalRow, decision: "approve" | "reject") => {
    setPendingId(row.id);
    setError(null);
    startTransition(async () => {
      const res = await decideCorrection({ regularizationId: row.id, decision });
      if (res.success) {
        setSaved(`${decision === "approve" ? "Approved" : "Rejected"} the correction for ${row.personName}.`);
        router.refresh();
      } else {
        setError(res.error);
        setSaved(null);
      }
      setPendingId(null);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div aria-live="polite" className="min-h-5">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : saved ? (
          <p role="status" className="text-xs text-muted-foreground">
            {saved}
          </p>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nothing waiting for you.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((r) => {
            const busy = pendingId === r.id || isPending;
            return (
              <li key={r.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">{r.personName}</p>
                  <p className="text-sm">{formatDate(r.date)}</p>
                  <p className="text-xs text-muted-foreground">
                    Recorded: in {formatTime(r.checkIn, timeZone)} &middot; out {formatTime(r.checkOut, timeZone)}
                  </p>
                  <p className="text-xs">
                    Asked for: in {formatTime(r.requestedCheckIn ?? r.checkIn, timeZone)} &middot; out{" "}
                    {formatTime(r.requestedCheckOut ?? r.checkOut, timeZone)}
                  </p>
                  {r.reason ? <p className="text-xs text-muted-foreground">{r.reason}</p> : null}
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  <Button type="button" size="sm" disabled={busy} onClick={() => decide(r, "approve")}>
                    Approve
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => decide(r, "reject")}>
                    Reject
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
