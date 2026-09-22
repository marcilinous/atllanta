// The single shape every Server Action returns (CLAUDE.md §6): callers always
// get { success: true, data } or { success: false, error, fieldErrors? }, so a
// screen never has to guess how a mutation failed.
//
// Anything a handler throws is logged server-side and reported to the client as
// one generic message — a raw error can carry connection strings, SQL or row
// contents, and none of that belongs in a browser. `ActionError` is the escape
// hatch for a message the user is meant to read ("This email is already a
// member"), optionally with per-field messages.

import { z } from "zod";
import type { ZodType } from "zod";

export type ActionResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

export const ACTION_ERROR = "Something went wrong. Please try again.";

export class ActionError extends Error {
  public readonly fieldErrors?: Record<string, string[]>;

  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message);
    this.name = "ActionError";
    this.fieldErrors = fieldErrors;
  }
}

export function ok<T>(data: T): ActionResponse<T> {
  return { success: true, data };
}

export function fail(
  error: string,
  fieldErrors?: Record<string, string[]>
): ActionResponse<never> {
  return fieldErrors ? { success: false, error, fieldErrors } : { success: false, error };
}

/**
 * Wraps a handler with Zod validation and the uniform response shape.
 *
 * @param schema   validates the raw input; its issues become `fieldErrors`.
 * @param handler  runs only on valid input.
 * @returns        a function to export as a Server Action.
 */
export function action<TInput, TOutput>(
  schema: ZodType<TInput>,
  handler: (input: TInput) => Promise<TOutput>
): (raw: unknown) => Promise<ActionResponse<TOutput>> {
  return async (raw: unknown): Promise<ActionResponse<TOutput>> => {
    const result = schema.safeParse(raw);
    if (!result.success) {
      const flattened = z.flattenError(result.error);
      const rawFieldErrors = flattened.fieldErrors as Record<string, string[] | undefined>;

      const cleaned: Record<string, string[]> = {};
      for (const [key, messages] of Object.entries(rawFieldErrors)) {
        if (messages && messages.length > 0) cleaned[key] = messages;
      }

      if (Object.keys(cleaned).length > 0) {
        return fail("Please check the highlighted fields.", cleaned);
      }
      return fail(flattened.formErrors?.[0] ?? "Invalid input.");
    }

    try {
      return ok(await handler(result.data));
    } catch (err) {
      if (err instanceof ActionError) return fail(err.message, err.fieldErrors);
      console.error("[action]", err);
      return fail(ACTION_ERROR);
    }
  };
}
