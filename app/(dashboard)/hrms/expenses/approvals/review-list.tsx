"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { decideExpense, reimburseExpense } from "@/src/lib/hrms/expenses/actions";
import type { ReviewRow } from "@/src/lib/hrms/expenses/queries";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "../../format";
import ReceiptButton from "../receipt-button";

export default function ReviewList({ rows, mode }: { rows: ReviewRow[]; mode: "decide" | "reimburse" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [isPending, startTransition] = useTransition();

  const decide = (row: ReviewRow, decision: "approve" | "reject") => {
    setPendingId(row.id);
    setError(null);
    startTransition(async () => {
      const res = await decideExpense({
        expenseId: row.id,
        decision,
        comment: decision === "reject" ? comment : null,
      });
      if (res.success) {
        setSaved(`${decision === "approve" ? "Approved" : "Rejected"} ${row.personName}'s claim.`);
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

  const reimburse = (row: ReviewRow) => {
    setPendingId(row.id);
    setError(null);
    startTransition(async () => {
      const res = await reimburseExpense({ expenseId: row.id });
      if (res.success) {
        setSaved(`Marked ${row.personName}'s claim reimbursed.`);
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
          {mode === "decide" ? "Nothing waiting for you." : "No approved claims waiting to be paid."}
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
                    {r.title} · {formatMoney(r.amount, r.currency)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(r.expenseDate)}
                    {r.categoryName ? ` · ${r.categoryName}` : null}
                  </p>
                  {r.description ? <p className="text-xs text-muted-foreground">{r.description}</p> : null}
                  {r.hasReceipt ? <ReceiptButton expenseId={r.id} /> : null}
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {mode === "reimburse" ? (
                    <Button type="button" size="sm" disabled={busy} onClick={() => reimburse(r)}>
                      Mark reimbursed
                    </Button>
                  ) : rejectingId === r.id ? (
                    <>
                      <textarea
                        aria-label={`Reason for rejecting ${r.personName}'s claim`}
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
