"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestCorrection } from "@/src/lib/hrms/attendance/actions";
import type { AttendanceDay } from "@/src/lib/hrms/attendance/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatTime } from "../format";

const inputClass = "rounded-md border border-border bg-field px-2 py-1 text-sm";

/** "HH:MM" (24h) of an instant in the org's time zone; "" when unknown. */
function timeInZone(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    new Date(iso)
  );
}

/** The instant that reads `hhmm` on `day` in `timeZone`, as ISO. */
function zonedInstant(day: string, hhmm: string, timeZone: string): string {
  const guess = Date.parse(`${day}T${hhmm}:00Z`);
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(guess))) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const asZoned = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(guess - (asZoned - guess)).toISOString();
}

type Errors = { checkIn?: string; checkOut?: string; reason?: string };

export default function MyDays({ days, timeZone }: { days: AttendanceDay[]; timeZone: string }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState({ checkIn: "", checkOut: "", reason: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const openForm = (d: AttendanceDay) => {
    setOpenId(d.id);
    setForm({ checkIn: timeInZone(d.checkIn, timeZone), checkOut: timeInZone(d.checkOut, timeZone), reason: "" });
    setErrors({});
    setError(null);
    setSaved(null);
  };

  const submit = (e: FormEvent, d: AttendanceDay) => {
    e.preventDefault();
    const requestedCheckIn =
      form.checkIn && form.checkIn !== timeInZone(d.checkIn, timeZone) ? zonedInstant(d.date, form.checkIn, timeZone) : null;
    const requestedCheckOut =
      form.checkOut && form.checkOut !== timeInZone(d.checkOut, timeZone)
        ? zonedInstant(d.date, form.checkOut, timeZone)
        : null;
    if (!requestedCheckIn && !requestedCheckOut) {
      setErrors({ checkIn: "Change at least one time." });
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await requestCorrection({ attendanceId: d.id, reason: form.reason, requestedCheckIn, requestedCheckOut });
      if (res.success) {
        setOpenId(null);
        setErrors({});
        setSaved("Correction sent to your manager.");
        router.refresh();
      } else {
        setError(res.error);
        setErrors({
          checkIn: res.fieldErrors?.requestedCheckIn?.[0],
          checkOut: res.fieldErrors?.requestedCheckOut?.[0],
          reason: res.fieldErrors?.reason?.[0],
        });
      }
    });
  };

  if (days.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No attendance in the last 30 days.
      </p>
    );
  }

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
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {days.map((d) => (
          <li key={d.id} className="flex flex-col gap-3 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{formatDate(d.date)}</p>
                <p className="text-xs text-muted-foreground">
                  In {formatTime(d.checkIn, timeZone)} · Out {formatTime(d.checkOut, timeZone)}
                  {d.totalHours != null ? ` · ${d.totalHours} h` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={d.status === "present" ? "secondary" : "outline"}>{d.status}</Badge>
                {d.pendingCorrection ? (
                  <span className="text-xs text-muted-foreground">Correction pending</span>
                ) : openId === d.id ? null : (
                  <Button type="button" size="sm" variant="outline" onClick={() => openForm(d)}>
                    Request a correction
                  </Button>
                )}
              </div>
            </div>

            {openId === d.id ? (
              <form onSubmit={(e) => submit(e, d)} className="flex flex-col gap-3 rounded-md border border-border p-3">
                <div className="flex flex-wrap gap-4">
                  <label className="flex flex-col gap-1 text-sm">
                    Correct check-in
                    <input
                      type="time"
                      value={form.checkIn}
                      onChange={(e) => setForm({ ...form, checkIn: e.target.value })}
                      aria-invalid={errors.checkIn ? true : undefined}
                      aria-describedby={errors.checkIn ? `${d.id}-in-error` : undefined}
                      className={inputClass}
                    />
                    {errors.checkIn ? (
                      <span id={`${d.id}-in-error`} className="text-xs text-destructive">
                        {errors.checkIn}
                      </span>
                    ) : null}
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Correct check-out
                    <input
                      type="time"
                      value={form.checkOut}
                      onChange={(e) => setForm({ ...form, checkOut: e.target.value })}
                      aria-invalid={errors.checkOut ? true : undefined}
                      aria-describedby={errors.checkOut ? `${d.id}-out-error` : undefined}
                      className={inputClass}
                    />
                    {errors.checkOut ? (
                      <span id={`${d.id}-out-error`} className="text-xs text-destructive">
                        {errors.checkOut}
                      </span>
                    ) : null}
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  Reason
                  <textarea
                    required
                    maxLength={500}
                    rows={2}
                    value={form.reason}
                    onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    aria-invalid={errors.reason ? true : undefined}
                    aria-describedby={errors.reason ? `${d.id}-reason-error` : undefined}
                    className={inputClass}
                  />
                  {errors.reason ? (
                    <span id={`${d.id}-reason-error`} className="text-xs text-destructive">
                      {errors.reason}
                    </span>
                  ) : null}
                </label>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={isPending}>
                    {isPending ? "Sending…" : "Send request"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setOpenId(null)}>
                    Back
                  </Button>
                </div>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
