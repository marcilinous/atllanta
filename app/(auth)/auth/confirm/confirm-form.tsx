"use client";

import { useState, useTransition } from "react";
import { verifyRecovery } from "@/src/lib/auth/actions";

export default function ConfirmForm({ tokenHash }: { tokenHash: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleContinue = () => {
    setError(null);
    startTransition(async () => {
      const result = await verifyRecovery({ tokenHash });
      if (result.success) {
        // Full navigation, not next/navigation's router: /reset-password is
        // the legacy static page served through a rewrite, outside the app
        // router tree.
        window.location.assign(result.data.next);
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={handleContinue}
        disabled={isPending}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
      >
        {isPending ? "Checking…" : "Continue to reset password"}
      </button>
      {error ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <a href="/login" className="text-sm text-primary hover:underline">
            Back to sign in
          </a>
        </div>
      ) : null}
    </div>
  );
}
