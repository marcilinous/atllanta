"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { submitExpense } from "@/src/lib/hrms/expenses/actions";
import type { CategoryOption } from "@/src/lib/hrms/expenses/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ExpenseForm({
  categories,
  currency,
  today,
}: {
  categories: CategoryOption[];
  currency: string;
  today: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const fe = (key: string) => fieldErrors[key]?.[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaved(null);
    if (!formRef.current) return;

    const fd = new FormData(formRef.current);

    startTransition(async () => {
      const res = await submitExpense(fd);
      if (res.success) {
        setSaved("Claim submitted. Your approver has been told.");
        formRef.current?.reset();
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
        <Label htmlFor="expense-title">What was it for?</Label>
        <Input id="expense-title" name="title" required maxLength={200} />
        {fe("title") ? <p className="text-xs text-destructive">{fe("title")}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expense-amount">Amount ({currency})</Label>
          <Input id="expense-amount" name="amount" type="text" inputMode="decimal" required placeholder="0.00" />
          {fe("amount") ? <p className="text-xs text-destructive">{fe("amount")}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="expense-date">Date</Label>
          <Input id="expense-date" type="date" name="expenseDate" required max={today} defaultValue={today} />
          {fe("expenseDate") ? <p className="text-xs text-destructive">{fe("expenseDate")}</p> : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="expense-category">Category</Label>
        <select
          id="expense-category"
          name="categoryId"
          className="h-9 w-full rounded-md border border-border bg-field px-2 text-sm"
        >
          <option value="">No category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
        {categories.length === 0 ? (
          <p className="text-xs text-muted-foreground">Your company hasn&rsquo;t set up expense categories yet.</p>
        ) : null}
        {fe("categoryId") ? <p className="text-xs text-destructive">{fe("categoryId")}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="expense-note">Note (optional)</Label>
        <textarea
          id="expense-note"
          name="description"
          maxLength={1000}
          rows={2}
          className="w-full rounded-md border border-border bg-field px-3 py-2 text-sm"
        />
        {fe("description") ? <p className="text-xs text-destructive">{fe("description")}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="expense-receipt">Receipt (optional)</Label>
        <input
          id="expense-receipt"
          name="receipt"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
          className="text-sm"
        />
        <p className="text-xs text-muted-foreground">PDF or photo, up to 4 MB.</p>
        {fe("receipt") ? <p className="text-xs text-destructive">{fe("receipt")}</p> : null}
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
        {isPending ? "Sending…" : "Submit claim"}
      </Button>
    </form>
  );
}
