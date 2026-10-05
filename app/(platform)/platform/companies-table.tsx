"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { activateOrg, extendTrial, pauseOrg } from "@/src/lib/platform/trials/actions";
import type { PlatformOrg } from "@/src/lib/platform/trials/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const DAYS = [7, 14, 30] as const;

function statusBadge(o: PlatformOrg) {
  if (o.state === "paused") return <Badge variant="destructive">Paused</Badge>;
  if (o.state === "trial_ended") return <Badge variant="destructive">Trial ended</Badge>;
  if (o.paymentStatus === "trial") return <Badge variant="secondary">Trial</Badge>;
  if (o.paymentStatus === "past_due") return <Badge variant="outline">Past due</Badge>;
  return <Badge>Active</Badge>;
}

function daysLeft(o: PlatformOrg, now: string): string {
  if (o.paymentStatus !== "trial" || !o.trialEndsAt) return "—";
  const d = Math.ceil((Date.parse(o.trialEndsAt) - Date.parse(now)) / 86_400_000);
  if (d > 0) return `${d} day${d === 1 ? "" : "s"} left`;
  if (d === 0) return "ends today";
  return `ended ${-d} day${d === -1 ? "" : "s"} ago`;
}

function formatEnd(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export default function CompaniesTable({ orgs, now }: { orgs: PlatformOrg[]; now: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPauseId, setConfirmPauseId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const run = (o: PlatformOrg, label: string, call: () => Promise<{ success: boolean; error?: string }>) => {
    setBusyId(o.id);
    setError(null);
    startTransition(async () => {
      const res = await call();
      if (res.success) {
        setSaved(`${label}: ${o.name}.`);
        setConfirmPauseId(null);
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong.");
        setSaved(null);
      }
      setBusyId(null);
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
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {orgs.map((o) => {
          const busy = busyId === o.id || isPending;
          return (
            <li key={o.id} className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{o.name}</span>
                  {statusBadge(o)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {o.people} {o.people === 1 ? "person" : "people"} · plan {o.planTier}
                  {o.paymentStatus === "trial"
                    ? ` · trial ends ${formatEnd(o.trialEndsAt)} (${daysLeft(o, now)}) · extended ${o.trialExtendedDays} of ${o.maxTrialExtensionDays} days`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {o.paymentStatus !== "active" ? (
                  <Button type="button" size="sm" disabled={busy} onClick={() => run(o, "Activated", () => activateOrg({ orgId: o.id }))}>
                    Activate
                  </Button>
                ) : null}
                {o.paymentStatus === "trial"
                  ? DAYS.map((d) => (
                      <Button
                        key={d}
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || o.trialExtendedDays + d > o.maxTrialExtensionDays}
                        onClick={() => run(o, `Extended by ${d} days`, () => extendTrial({ orgId: o.id, days: d }))}
                      >
                        +{d} days
                      </Button>
                    ))
                  : null}
                {o.paymentStatus !== "cancelled" ? (
                  confirmPauseId === o.id ? (
                    <>
                      <span className="text-sm">Pause {o.name}?</span>
                      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => run(o, "Paused", () => pauseOrg({ orgId: o.id }))}>
                        Yes, pause
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmPauseId(null)}>
                        Keep it
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmPauseId(o.id)}>
                      Pause…
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
