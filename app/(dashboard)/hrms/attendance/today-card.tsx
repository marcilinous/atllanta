"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkIn, checkOut } from "@/src/lib/hrms/attendance/actions";
import type { AttendanceDay } from "@/src/lib/hrms/attendance/queries";
import { Button } from "@/components/ui/button";
import { formatTime } from "../format";

// Browser location when it gives one within 8 seconds; null otherwise. The
// database geofence decides whether a missing location is acceptable.
function getLocation(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => resolve(null), 8100);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

export default function TodayCard({ today, timeZone }: { today: AttendanceDay | null; timeZone: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const act = (kind: "in" | "out") => {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const loc = await getLocation();
      const payload = { lat: loc?.lat ?? null, lng: loc?.lng ?? null };
      const res = kind === "in" ? await checkIn(payload) : await checkOut(payload);
      if (res.success) {
        setSaved(kind === "in" ? "Checked in." : "Checked out.");
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const open = today?.checkIn && !today.checkOut;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        {!today ? (
          <p className="text-sm">You haven&rsquo;t checked in yet.</p>
        ) : open ? (
          <p className="text-sm">Checked in at {formatTime(today.checkIn, timeZone)}</p>
        ) : (
          <>
            <p className="text-sm">
              In {formatTime(today.checkIn, timeZone)} · Out {formatTime(today.checkOut, timeZone)} ·{" "}
              {today.totalHours ?? 0} h
            </p>
            <p className="text-xs text-muted-foreground">You&rsquo;re done for today.</p>
          </>
        )}
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
      </div>
      {!today ? (
        <Button type="button" disabled={isPending} onClick={() => act("in")}>
          {isPending ? "Checking in…" : "Check in"}
        </Button>
      ) : open ? (
        <Button type="button" disabled={isPending} onClick={() => act("out")}>
          {isPending ? "Checking out…" : "Check out"}
        </Button>
      ) : null}
    </div>
  );
}
