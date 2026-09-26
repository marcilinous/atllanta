"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createCustomRole, updateCustomRole, deleteCustomRole } from "@/src/lib/settings/actions";
import {
  MODULE_KEYS,
  PERMISSIONS,
  MODULE_LABELS,
  PERMISSION_LABELS,
  type ModuleKey,
  type Permission,
} from "@/src/lib/settings/catalogue";
import type { CustomRoleSummary } from "@/src/lib/settings/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Grants = Partial<Record<ModuleKey, Permission[]>>;

function without(grants: Grants, key: ModuleKey): Grants {
  const next = { ...grants };
  delete next[key];
  return next;
}

export default function RoleForm({ role }: { role?: CustomRoleSummary }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [grants, setGrants] = useState<Grants>(() => {
    const init: Grants = {};
    for (const g of role?.grants ?? []) init[g.moduleKey] = [...g.permissions];
    return init;
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggleDefault = (key: ModuleKey) => {
    setGrants((prev) => (prev[key]?.length ? without(prev, key) : { ...prev, [key]: ["view"] }));
  };

  const togglePermission = (key: ModuleKey, permission: Permission, checked: boolean) => {
    setGrants((prev) => {
      const current = prev[key] ?? [];
      let next: Permission[];
      if (checked) {
        // Anything beyond View needs View (the server refuses it otherwise).
        next = [...current, permission, "view"];
      } else if (permission === "view") {
        next = [];
      } else {
        next = current.filter((p) => p !== permission);
      }
      const ordered = PERMISSIONS.filter((p) => next.includes(p));
      return ordered.length === 0 ? without(prev, key) : { ...prev, [key]: ordered };
    });
  };

  const handleResult = (res: { success: true } | { success: false; error: string; fieldErrors?: Record<string, string[]> }) => {
    if (res.success) {
      router.push("/settings/roles");
      router.refresh();
    } else {
      setError(res.error);
      setFieldErrors(res.fieldErrors ?? {});
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const grantList = MODULE_KEYS.filter((k) => grants[k]?.length).map((k) => ({
      moduleKey: k,
      permissions: grants[k]!,
    }));
    const payload = { name, description: description.trim() || null, grants: grantList };

    startTransition(async () => {
      handleResult(role ? await updateCustomRole({ roleId: role.id, ...payload }) : await createCustomRole(payload));
    });
  };

  const handleDelete = () => {
    if (!role) return;
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      handleResult(await deleteCustomRole({ roleId: role.id }));
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex max-w-md flex-col gap-2">
        <Label htmlFor="role-name">Name</Label>
        <Input
          id="role-name"
          maxLength={60}
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={fieldErrors.name ? true : undefined}
          aria-describedby={fieldErrors.name ? "role-name-error" : undefined}
        />
        {fieldErrors.name?.[0] ? (
          <p id="role-name-error" className="text-xs text-destructive">
            {fieldErrors.name[0]}
          </p>
        ) : null}
      </div>

      <div className="flex max-w-md flex-col gap-2">
        <Label htmlFor="role-description">Description</Label>
        <textarea
          id="role-description"
          maxLength={200}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-md border border-border bg-field px-3 py-2 text-sm"
        />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Module permissions</h2>
        <p className="text-xs text-muted-foreground">
          A module you leave on &ldquo;Base role default&rdquo; uses what the person&rsquo;s system role allows.
          Ticking any box replaces that default for this module. Modules the organisation has switched off stay off
          either way.
        </p>
        {fieldErrors.grants?.[0] ? <p className="text-xs text-destructive">{fieldErrors.grants[0]}</p> : null}
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="p-2 text-left font-medium">Module</th>
                <th className="p-2 text-center font-medium">Base role default</th>
                {PERMISSIONS.map((perm) => (
                  <th key={perm} className="p-2 text-center font-medium">
                    {PERMISSION_LABELS[perm]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {MODULE_KEYS.map((key) => {
                const moduleLabel = MODULE_LABELS[key].label;
                const moduleGrants = grants[key];
                return (
                  <tr key={key}>
                    <td className="p-2">{moduleLabel}</td>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={!moduleGrants?.length}
                        onChange={() => toggleDefault(key)}
                        aria-label={`${moduleLabel}: Base role default`}
                      />
                    </td>
                    {PERMISSIONS.map((perm) => (
                      <td key={perm} className="p-2 text-center">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--primary)]"
                          checked={moduleGrants?.includes(perm) ?? false}
                          onChange={(e) => togglePermission(key, perm, e.target.checked)}
                          aria-label={`${moduleLabel}: ${PERMISSION_LABELS[perm]}`}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : role ? "Save changes" : "Create role"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push("/settings/roles")}>
          Cancel
        </Button>

        {role ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {confirmDelete ? (
              <>
                <p className="text-sm">Delete this role? People who have it go back to their base role.</p>
                <Button type="button" variant="destructive" disabled={isPending} onClick={handleDelete}>
                  Delete role
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
                Delete role
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </form>
  );
}
