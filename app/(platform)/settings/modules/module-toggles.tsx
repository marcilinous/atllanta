"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setModuleEnabled } from "@/src/lib/settings/actions";
import { MODULE_LABELS, type ModuleKey } from "@/src/lib/settings/catalogue";
import type { ModuleRow } from "@/src/lib/settings/queries";
import { Badge } from "@/components/ui/badge";

export default function ModuleToggles({ modules }: { modules: ModuleRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Partial<Record<ModuleKey, boolean>>>(() =>
    Object.fromEntries(modules.map((m) => [m.moduleKey, m.isEnabled]))
  );
  const [pendingKey, setPendingKey] = useState<ModuleKey | null>(null);

  const handleToggle = (moduleKey: ModuleKey) => {
    const next = !enabled[moduleKey];
    setEnabled((prev) => ({ ...prev, [moduleKey]: next }));
    setPendingKey(moduleKey);
    setError(null);

    startTransition(async () => {
      const res = await setModuleEnabled({ moduleKey, enabled: next });
      if (!res.success) {
        setEnabled((prev) => ({ ...prev, [moduleKey]: !next }));
        setError(res.error);
      } else {
        router.refresh();
      }
      setPendingKey(null);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {modules.map((m) => {
          const { label, description } = MODULE_LABELS[m.moduleKey];
          const on = enabled[m.moduleKey] === true;
          return (
            <li key={m.moduleKey} className="flex items-center justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Badge variant={on ? "default" : "outline"}>{on ? "On" : "Off"}</Badge>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={label}
                  disabled={pendingKey === m.moduleKey || isPending}
                  onClick={() => handleToggle(m.moduleKey)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    on ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`block size-5 rounded-full bg-background shadow transition-transform ${
                      on ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
