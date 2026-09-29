"use client";

import { useState, useTransition, type ChangeEvent } from "react";
import { setMemberCustomRole } from "@/src/lib/settings/actions";
import type { MemberRow, MembersData } from "@/src/lib/settings/queries";
import { Badge } from "@/components/ui/badge";

export default function MembersTable({ data }: { data: MembersData }) {
  const [assigned, setAssigned] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(data.members.map((m) => [m.id, m.customRoleId]))
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Mirrors the server's rules (setMemberCustomRole): nobody changes their own
  // role, and only an owner changes an owner's.
  const lockReason = (m: MemberRow): string | null => {
    if (m.isSelf) return "You can't change your own role.";
    if (m.role === "owner" && data.callerRole !== "owner") return "Only an owner can change an owner's role.";
    return null;
  };

  const handleChange = (m: MemberRow) => (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value || null;
    const before = assigned[m.id] ?? null;
    setAssigned((prev) => ({ ...prev, [m.id]: next }));
    setPendingId(m.id);
    startTransition(async () => {
      const res = await setMemberCustomRole({ userId: m.id, customRoleId: next });
      if (!res.success) {
        setAssigned((prev) => ({ ...prev, [m.id]: before }));
        setError(res.error);
        setSaved(null);
      } else {
        setError(null);
        setSaved(`Saved for ${m.name}`);
      }
      setPendingId(null);
    });
  };

  return (
    <div className="flex flex-col gap-4">
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

      {data.customRoles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          No custom roles yet. Create one under Roles, then assign it here.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="p-3 text-left font-medium">Person</th>
              <th className="p-3 text-left font-medium">Built-in role</th>
              <th className="p-3 text-left font-medium">Custom role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.members.map((m) => {
              const reason = lockReason(m);
              return (
                <tr key={m.id}>
                  <td className="p-3">
                    <div className="font-medium">
                      {m.name}
                      {m.isSelf ? <span className="text-muted-foreground"> (you)</span> : null}
                    </div>
                    {m.email ? <div className="text-xs text-muted-foreground">{m.email}</div> : null}
                  </td>
                  <td className="p-3">
                    <Badge variant="outline">{m.role.charAt(0).toUpperCase() + m.role.slice(1)}</Badge>
                  </td>
                  <td className="p-3">
                    <select
                      aria-label={`Custom role for ${m.name}`}
                      className="h-8 w-full max-w-xs rounded-md border border-border bg-field px-2 text-sm disabled:opacity-50"
                      value={assigned[m.id] ?? ""}
                      disabled={reason !== null || pendingId === m.id}
                      onChange={handleChange(m)}
                    >
                      <option value="">None (built-in role only)</option>
                      {data.customRoles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    {reason ? <p className="mt-1 text-xs text-muted-foreground">{reason}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
