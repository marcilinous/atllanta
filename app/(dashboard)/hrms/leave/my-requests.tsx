"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelLeaveRequest } from "@/src/lib/hrms/leave/actions";
import type { MyRequestRow } from "@/src/lib/hrms/leave/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatRange } from "../format";

const STATUS: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
  approved: { variant: "default", label: "Approved" },
  pending: { variant: "secondary", label: "Pending" },
  rejected: { variant: "destructive", label: "Rejected" },
  cancelled: { variant: "outline", label: "Cancelled" },
};

export default function MyRequests({ requests }: { requests: MyRequestRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleCancel = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      const res = await cancelLeaveRequest({ requestId: id });
      if (res.success) {
        setError(null);
        setConfirmId(null);
        router.refresh();
      } else {
        setError(res.error);
      }
      setPendingId(null);
    });
  };

  if (requests.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No leave requests yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {requests.map((r) => {
          const status = STATUS[r.status] ?? { variant: "outline" as const, label: r.status };
          return (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">
                  {r.typeName} · {r.days} day(s)
                </p>
                <p className="text-xs text-muted-foreground">{formatRange(r.startDate, r.endDate)}</p>
                {r.reason ? <p className="text-xs text-muted-foreground">{r.reason}</p> : null}
                {r.reviewComment ? <p className="text-xs">Comment: {r.reviewComment}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.variant}>{status.label}</Badge>
                {r.status === "pending" ? (
                  confirmId === r.id ? (
                    <>
                      <span className="text-sm">Cancel this request?</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={pendingId === r.id}
                        onClick={() => handleCancel(r.id)}
                      >
                        Yes, cancel
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                        Keep it
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => setConfirmId(r.id)}>
                      Cancel
                    </Button>
                  )
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
