"use client";

import { useState, useTransition, type FormEvent } from "react";
import { submitFeedback } from "@/src/lib/platform/feedback/actions";
import { FEEDBACK_KINDS, type FeedbackKind } from "@/src/lib/platform/feedback/schemas";
import { Button } from "@/components/ui/button";

export default function FeedbackForm({ from }: { from: string | null }) {
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [isPending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!kind) {
      setError("Choose Idea, Problem or Praise.");
      return;
    }
    if (!message.trim()) {
      setError("Write a message of up to 2,000 characters.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await submitFeedback({ kind, rating, message, page: from });
      if (res.success) setSent(true);
      else setError(res.error);
    });
  };

  const back = from ?? "/";

  if (sent) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
        <p role="status" className="text-sm">
          Thanks — this goes straight to the Atllanta team.
        </p>
        <div>
          {/* A full load: the way back may be the legacy app outside the App Router. */}
          <a href={back} className="text-sm text-primary hover:underline">
            &larr; Back
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-lg border border-border bg-card p-4 sm:p-6">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">What is it?</legend>
        <div className="flex flex-wrap gap-2">
          {FEEDBACK_KINDS.map((k) => (
            <Button
              key={k.key}
              type="button"
              size="sm"
              variant={kind === k.key ? "default" : "outline"}
              aria-pressed={kind === k.key}
              onClick={() => setKind(k.key)}
            >
              {k.label}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">How would you rate Atllanta? (optional)</legend>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              aria-pressed={rating !== null && n <= rating}
              onClick={() => setRating(rating === n ? null : n)}
              className={`text-2xl leading-none ${rating !== null && n <= rating ? "text-amber-500" : "text-muted-foreground"}`}
            >
              ★
            </button>
          ))}
          {rating !== null ? (
            <button type="button" className="ml-2 text-xs text-muted-foreground hover:underline" onClick={() => setRating(null)}>
              Clear
            </button>
          ) : null}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        Tell us more
        <textarea
          required
          maxLength={2000}
          rows={6}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="rounded-md border border-border bg-field px-2 py-1.5 text-sm"
        />
        <span className="self-end text-xs text-muted-foreground">{message.length} / 2000</span>
      </label>

      <div aria-live="polite" className="min-h-5">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Sending…" : "Send feedback"}
        </Button>
        <a href={back} className="inline-flex items-center px-3 text-sm text-muted-foreground hover:underline">
          Cancel
        </a>
      </div>
    </form>
  );
}
