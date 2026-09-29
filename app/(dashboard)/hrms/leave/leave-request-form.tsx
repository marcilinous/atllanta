"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyForLeave } from "@/src/lib/hrms/leave/actions";
import { leaveDays, countCalendarDays } from "@/src/lib/hrms/leave/days";
import type { LeaveTypeOption, BalanceRow } from "@/src/lib/hrms/leave/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LeaveRequestForm({ types, balances }: { types: LeaveTypeOption[]; balances: BalanceRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const selected = useMemo(() => types.find((t) => t.id === leaveTypeId), [types, leaveTypeId]);
  const effectiveEnd = halfDay ? startDate : endDate;
  // A preview only — the server works the days out again and uses its own.
  const days = startDate && effectiveEnd ? leaveDays(startDate, effectiveEnd, halfDay) : 0;
  const calendar = startDate && effectiveEnd ? countCalendarDays(startDate, effectiveEnd) : 0;
  const balance = balances.find((b) => b.leaveTypeId === leaveTypeId);
  const available = balance ? balance.balance - balance.pending : null;

  const fe = (key: string) => fieldErrors[key]?.[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaved(null);
    if (!formRef.current) return;

    const fd = new FormData(formRef.current);
    // A disabled input is not submitted, so send the end date and the flag explicitly.
    fd.set("endDate", effectiveEnd);
    fd.set("halfDay", halfDay ? "true" : "false");

    startTransition(async () => {
      const res = await applyForLeave(fd);
      if (res.success) {
        setSaved(`Requested ${res.data.days} day(s). Your approver has been told.`);
        setLeaveTypeId("");
        setStartDate("");
        setEndDate("");
        setHalfDay(false);
        setReason("");
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
        <Label htmlFor="leave-type">Leave type</Label>
        <select
          id="leave-type"
          name="leaveTypeId"
          required
          value={leaveTypeId}
          onChange={(e) => setLeaveTypeId(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-field px-2 text-sm"
        >
          <option value="">Choose…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.requiresDocument ? " (document required)" : ""}
            </option>
          ))}
        </select>
        {available !== null ? <p className="text-xs text-muted-foreground">{available} day(s) available</p> : null}
        {fe("leaveTypeId") ? <p className="text-xs text-destructive">{fe("leaveTypeId")}</p> : null}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="leave-start">From</Label>
          <Input
            id="leave-start"
            type="date"
            name="startDate"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          {fe("startDate") ? <p className="text-xs text-destructive">{fe("startDate")}</p> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="leave-end">To</Label>
          <Input
            id="leave-end"
            type="date"
            name="endDate"
            required={!halfDay}
            disabled={halfDay}
            min={startDate || undefined}
            value={effectiveEnd}
            onChange={(e) => setEndDate(e.target.value)}
          />
          {fe("endDate") ? <p className="text-xs text-destructive">{fe("endDate")}</p> : null}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="leave-half"
          type="checkbox"
          checked={halfDay}
          onChange={(e) => setHalfDay(e.target.checked)}
          className="size-4 accent-[var(--primary)]"
        />
        <Label htmlFor="leave-half">Half day</Label>
      </div>

      <p aria-live="polite" className="text-sm">
        {days > 0 ? (
          <>
            <strong>{days}</strong> working day(s)
            {calendar > Math.ceil(days) ? (
              <span className="text-muted-foreground"> · {calendar - Math.ceil(days)} weekend day(s) not counted</span>
            ) : null}
          </>
        ) : startDate && effectiveEnd ? (
          "There are no working days in these dates."
        ) : null}
      </p>

      {selected?.requiresDocument ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="leave-doc">Supporting document</Label>
          <input
            id="leave-doc"
            name="document"
            type="file"
            required
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
            className="text-sm"
          />
          <p className="text-xs text-muted-foreground">PDF or photo, up to 4 MB.</p>
          {fe("document") ? <p className="text-xs text-destructive">{fe("document")}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="leave-reason">Reason (optional)</Label>
        <textarea
          id="leave-reason"
          name="reason"
          maxLength={500}
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-md border border-border bg-field px-3 py-2 text-sm"
        />
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

      <Button type="submit" disabled={isPending || days <= 0} className="self-start">
        {isPending ? "Sending…" : "Request leave"}
      </Button>
    </form>
  );
}
