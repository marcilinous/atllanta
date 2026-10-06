"use client";

import { useState, useTransition } from "react";
import { getReceiptLink } from "@/src/lib/hrms/expenses/actions";
import { Button } from "@/components/ui/button";

export default function ReceiptButton({ expenseId }: { expenseId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const res = await getReceiptLink({ expenseId });
      if (res.success) {
        window.open(res.data.url, "_blank", "noopener,noreferrer");
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <div className="flex flex-col items-start">
      <Button type="button" size="sm" variant="ghost" onClick={handleClick} disabled={isPending}>
        {isPending ? "Opening…" : "View receipt"}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
