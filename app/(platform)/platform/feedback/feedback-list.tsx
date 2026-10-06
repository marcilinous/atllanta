"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { markFeedbackRead } from "@/src/lib/platform/feedback/actions";
import { FEEDBACK_KINDS, type FeedbackRow } from "@/src/lib/platform/feedback/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const LABEL: Record<string, string> = { idea: "Idea", problem: "Problem", praise: "Praise" };
const VARIANT: Record<string, "default" | "secondary" | "destructive"> = { idea: "secondary", problem: "destructive", praise: "default" };

function href(onlyUnread: boolean, kind: string | null) {
  const q = new URLSearchParams();
  if (onlyUnread) q.set("unread", "1");
  if (kind) q.set("kind", kind);
  const s = q.toString();
  return s ? `/platform/feedback?${s}` : "/platform/feedback";
}

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs ${active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`;

export default function FeedbackList({ items, onlyUnread, kind }: { items: FeedbackRow[]; onlyUnread: boolean; kind: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = (f: FeedbackRow) => {
    setBusyId(f.id);
    setError(null);
    startTransition(async () => {
      const res = await markFeedbackRead({ id: f.id, read: !f.readAt });
      if (res.success) router.refresh();
      else setError(res.error);
      setBusyId(null);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link className={chip(!onlyUnread)} href={href(false, kind)}>All</Link>
        <Link className={chip(onlyUnread)} href={href(true, kind)}>Unread</Link>
        <span className="mx-1 text-border">|</span>
        <Link className={chip(!kind)} href={href(onlyUnread, null)}>All types</Link>
        {FEEDBACK_KINDS.map((k) => (
          <Link key={k.key} className={chip(kind === k.key)} href={href(onlyUnread, k.key)}>
            {k.label}
          </Link>
        ))}
      </div>
      <div aria-live="polite" className="min-h-5">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No feedback here yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {items.map((f) => (
            <li key={f.id} className={`flex flex-col gap-2 px-4 py-3 ${f.readAt ? "" : "bg-primary/5"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={VARIANT[f.kind]}>{LABEL[f.kind]}</Badge>
                {f.rating ? (
                  <span className="text-sm" aria-label={`${f.rating} out of 5 stars`}>
                    {"★".repeat(f.rating)}
                    <span className="text-muted-foreground">{"★".repeat(5 - f.rating)}</span>
                  </span>
                ) : null}
                {!f.readAt ? <Badge variant="outline">Unread</Badge> : null}
                <span className="ml-auto text-xs text-muted-foreground">{new Date(f.createdAt).toLocaleString()}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{f.message}</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  {f.userName ?? "Unknown person"}
                  {f.userEmail ? ` · ${f.userEmail}` : ""}
                  {f.orgName ? ` · ${f.orgName}` : ""}
                  {f.role ? ` · ${f.role}` : ""}
                  {f.page ? ` · from ${f.page}` : ""}
                </p>
                <Button type="button" size="sm" variant="ghost" disabled={busyId === f.id || isPending} onClick={() => toggle(f)}>
                  {f.readAt ? "Mark unread" : "Mark read"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
