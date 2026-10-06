"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { withdrawExpense } from "@/src/lib/hrms/expenses/actions";
import type { MyClaimRow } from "@/src/lib/hrms/expenses/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney } from "../format";
import ReceiptButton from "./receipt-button";

const STATUS: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
  approved: { variant: "default", label: "Approved" },
  pending: { variant: "secondary", label: "Pending" },
  rejected: { variant: "destructive", label: "Rejected" },
  reimbursed: { variant: "outline", label: "Reimbursed" },
};

export default function MyClaims({ claims }: { claims: MyClaimRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const handleWithdraw = (id: string) => {
    setPendingId(id);
    startTransition(async () => {
      const res = await withdrawExpense({ expenseId: id });
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

  if (claims.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No claims yet.
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
        {claims.map((r) => {
          const status = STATUS[r.status] ?? { variant: "outline" as const, label: r.status };
          return (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">
                  {r.title} · {formatMoney(r.amount, r.currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(r.expenseDate)}
                  {r.categoryName ? ` · ${r.categoryName}` : null}
                </p>
                {r.description ? <p className="text-xs text-muted-foreground">{r.description}</p> : null}
                {r.reviewComment ? <p className="text-xs">Comment: {r.reviewComment}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={status.variant}>{status.label}</Badge>
                {r.hasReceipt ? <ReceiptButton expenseId={r.id} /> : null}
                {r.status === "pending" ? (
                  confirmId === r.id ? (
                    <>
                      <span className="text-sm">Withdraw this claim?</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={pendingId === r.id}
                        onClick={() => handleWithdraw(r.id)}
                      >
                        Yes, withdraw
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                        Keep it
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => setConfirmId(r.id)}>
                      Withdraw
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
