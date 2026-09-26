"use client";

import { useState, useTransition } from "react";
import { setFeatureRule } from "@/src/lib/settings/actions";
import {
  ACCESS_FEATURES,
  ACCESS_ROLES,
  type AccessFeatureKey,
  type AccessRoleKey,
} from "@/src/lib/settings/catalogue";
import type { AccessData } from "@/src/lib/settings/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Rules = Record<string, Record<string, boolean>>;
type PersonValue = "default" | "visible" | "hidden";

/** Sets (or, with `undefined`, clears) one rule, dropping a subject left with no rules. */
function withRule(rules: Rules, subject: string, feature: string, allowed: boolean | undefined): Rules {
  const forSubject = { ...(rules[subject] ?? {}) };
  if (allowed === undefined) delete forSubject[feature];
  else forSubject[feature] = allowed;
  const next = { ...rules, [subject]: forSubject };
  if (Object.keys(forSubject).length === 0) delete next[subject];
  return next;
}

export default function AccessEditor({ data }: { data: AccessData }) {
  const [roleRules, setRoleRules] = useState<Rules>(data.roleRules);
  const [userRules, setUserRules] = useState<Rules>(data.userRules);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const report = (ok: boolean, message?: string) => {
    setError(ok ? null : (message ?? "Could not save that change."));
    setSaved(ok ? "Saved" : null);
  };

  const handleRoleToggle = (roleKey: AccessRoleKey, featureKey: AccessFeatureKey, checked: boolean) => {
    const before = roleRules;
    // No row = visible; a hidden feature is stored as allowed = false.
    setRoleRules(withRule(before, roleKey, featureKey, checked ? undefined : false));
    startTransition(async () => {
      const res = await setFeatureRule({
        subjectType: "role",
        subjectKey: roleKey,
        featureKey,
        value: checked ? "visible" : "hidden",
      });
      if (!res.success) setRoleRules(before);
      report(res.success, res.success ? undefined : res.error);
    });
  };

  const handlePersonChange = (userId: string, featureKey: AccessFeatureKey, value: PersonValue) => {
    const before = userRules;
    setUserRules(withRule(before, userId, featureKey, value === "default" ? undefined : value === "visible"));
    startTransition(async () => {
      const res = await setFeatureRule({ subjectType: "user", subjectKey: userId, featureKey, value });
      if (!res.success) setUserRules(before);
      report(res.success, res.success ? undefined : res.error);
    });
  };

  const selectedPerson = data.people.find((p) => p.id === selectedUserId) ?? null;
  const personRules = userRules[selectedUserId] ?? {};

  return (
    <div className="flex flex-col gap-6">
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

      <Card>
        <CardHeader>
          <CardTitle>By role</CardTitle>
          <CardDescription>
            Owners and admins always see everything. Ticked = visible. Changes apply on the person&rsquo;s next page
            load.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-2 text-left font-medium">Feature</th>
                {ACCESS_ROLES.map((role) => (
                  <th key={role.key} className="px-2 py-2 text-center font-medium">
                    {role.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ACCESS_FEATURES.map((feature) => (
                <tr key={feature.key}>
                  <td className="px-2 py-2">{feature.label}</td>
                  {ACCESS_ROLES.map((role) => (
                    <td key={role.key} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        aria-label={`${feature.label} for ${role.label}`}
                        checked={roleRules[role.key]?.[feature.key] !== false}
                        disabled={isPending}
                        onChange={(e) => handleRoleToggle(role.key, feature.key, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per person</CardTitle>
          <CardDescription>Override what one person sees, beyond their role.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {data.people.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No one to configure — owners and admins always see everything.
            </p>
          ) : (
            <select
              className="h-9 w-full max-w-xs rounded-md border border-border bg-field px-2 text-sm"
              aria-label="Person"
              value={selectedUserId}
              onChange={(e) => {
                setSelectedUserId(e.target.value);
                setSaved(null);
                setError(null);
              }}
            >
              <option value="">Select a person…</option>
              {data.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.role}
                </option>
              ))}
            </select>
          )}

          {selectedPerson ? (
            <div className="divide-y divide-border">
              {ACCESS_FEATURES.map((feature) => {
                const value: PersonValue =
                  feature.key in personRules ? (personRules[feature.key] ? "visible" : "hidden") : "default";
                return (
                  <div key={feature.key} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm">{feature.label}</span>
                    <select
                      className="h-8 rounded-md border border-border bg-field px-2 text-xs"
                      aria-label={`${feature.label} for ${selectedPerson.name}`}
                      value={value}
                      disabled={isPending}
                      onChange={(e) =>
                        handlePersonChange(selectedPerson.id, feature.key, e.target.value as PersonValue)
                      }
                    >
                      <option value="default">Default (role)</option>
                      <option value="visible">Always visible</option>
                      <option value="hidden">Hidden</option>
                    </select>
                  </div>
                );
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
