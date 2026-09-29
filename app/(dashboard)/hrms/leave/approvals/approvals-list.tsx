"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideLeaveRequest } from "@/src/lib/hrms/leave/actions";
import type { ApprovalRow } from "@/src/lib/hrms/leave/queries";
import { Button } from "@/components/ui/button";
import { formatRange } from "../../format";

export default function ApprovalsList({ rows }: { rows: ApprovalRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [isPending, startTransition] = useTransition();

  const decide = (row: ApprovalRow, decision: "approve" | "reject") => {
    setPendingId(row.id);
    setError(null);
    startTransition(async () => {
      const res = await decideLeaveRequest({
        requestId: row.id,
        decision,
        comment: decision === "reject" ? comment : null,
      });
      if (res.success) {
        setSaved(`${decision === "approve" ? "Approved" : "Rejected"} leave for ${row.personName}.`);
        setRejectingId(null);
        setComment("");
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
                  <p className="text-sm">
                    {r.typeName} · {r.days} day(s) · {formatRange(r.startDate, r.endDate)}
                  </p>
                  {r.reason ? <p className="text-xs text-muted-foreground">{r.reason}</p> : null}
                  {r.hasDocument ? <p className="text-xs text-muted-foreground">Supporting document attached</p> : null}
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {rejectingId === r.id ? (
                    <>
                      <textarea
                        aria-label={`Reason for rejecting leave for ${r.personName}`}
                        maxLength={500}
                        rows={2}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        className="w-full min-w-56 rounded-md border border-border bg-field px-2 py-1 text-sm"
                      />
                      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => decide(r, "reject")}>
                        Reject
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setRejectingId(null);
                          setComment("");
                        }}
                      >
                        Back
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button type="button" size="sm" disabled={busy} onClick={() => decide(r, "approve")}>
                        Approve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setRejectingId(r.id);
                          setComment("");
                        }}
                      >
                        Reject…
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
