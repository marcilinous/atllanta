"use client";

import { useState, useTransition, type FormEvent } from "react";
import { createCompany } from "@/src/lib/platform/signup/actions";
import type { SignupModuleKey } from "@/src/lib/platform/signup/schemas";
import { Button } from "@/components/ui/button";

const inputClass = "rounded-md border border-border bg-field px-2 py-1.5 text-sm";

type Props = {
  modules: { key: SignupModuleKey; label: string }[];
  timeZones: string[];
  currencies: string[];
};

export default function StartForm({ modules, timeZones, currencies }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [timeZone, setTimeZone] = useState<string>(timeZones[0] ?? "");
  const [currency, setCurrency] = useState<string>(currencies[0] ?? "");
  const [chosen, setChosen] = useState<SignupModuleKey[]>(modules.map((m) => m.key));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isPending, startTransition] = useTransition();

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      setFieldErrors({ name: ["Company name must be at least 2 characters."] });
      return;
    }
    setFieldErrors({});
    setStep(2);
  };

  const toggle = (key: SignupModuleKey) =>
    setChosen((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (chosen.length === 0) {
      setError("Choose at least one module.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await createCompany({ name, timeZone, currency, modules: chosen });
      if (res.success) {
        // A full load: the app is the legacy shell outside the App Router.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/");
        return;
      }
      setError(res.error);
      setFieldErrors(res.fieldErrors ?? {});
      if (res.fieldErrors?.name || res.fieldErrors?.timeZone || res.fieldErrors?.currency) setStep(1);
    });
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-6">
      <p className="text-xs text-muted-foreground">Step {step} of 2</p>
      <div aria-live="polite" className="min-h-5">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      {step === 1 ? (
        <form onSubmit={next} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            Company name
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? "name-error" : undefined}
              className={inputClass}
            />
            {fieldErrors.name ? (
              <span id="name-error" className="text-xs text-destructive">
                {fieldErrors.name[0]}
              </span>
            ) : null}
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1 text-sm">
              Time zone
              <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)} className={inputClass}>
                {timeZones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Currency
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <Button type="submit">Next</Button>
          </div>
        </form>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Modules for {name.trim()}</legend>
            <p className="text-xs text-muted-foreground">
              You can change these later in Admin &rarr; Modules &amp; roles.
            </p>
            {modules.map((m) => (
              <label key={m.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={chosen.includes(m.key)} onChange={() => toggle(m.key)} />
                {m.label}
              </label>
            ))}
          </fieldset>
          <div className="flex gap-2">
            <Button type="submit" disabled={isPending || chosen.length === 0}>
              {isPending ? "Creating…" : "Create company"}
            </Button>
            <Button type="button" variant="ghost" disabled={isPending} onClick={() => setStep(1)}>
              Back
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
