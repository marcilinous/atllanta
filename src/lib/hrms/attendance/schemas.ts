// Zod input schemas for the attendance Server Actions, and the small pure
// helpers they share. The org, the person and "now" never come from input.
//
// No `server-only` import: tests import this file directly.
import { z } from "zod";

// Browser location, when it gives one. Optional: an org without active work
// locations accepts a check-in without it; with them, the database's
// geofence trigger requires it and checks it.
const coordinate = (min: number, max: number) => z.number().finite().min(min).max(max);
export const locationSchema = z.object({
  lat: coordinate(-90, 90).nullish(),
  lng: coordinate(-180, 180).nullish(),
});
export type LocationInput = z.infer<typeof locationSchema>;

const isoInstant = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)) && /T/.test(v), "Enter a valid date and time.");

export const requestCorrectionSchema = z
  .object({
    attendanceId: z.uuid("Choose a day."),
    reason: z.string().trim().min(1, "Say why the times need correcting.").max(500, "Reason must be 500 characters or fewer."),
    requestedCheckIn: isoInstant.nullish(),
    requestedCheckOut: isoInstant.nullish(),
  })
  .refine((v) => v.requestedCheckIn || v.requestedCheckOut, {
    message: "Give at least one corrected time.",
    path: ["requestedCheckIn"],
  })
  .refine(
    (v) => !(v.requestedCheckIn && v.requestedCheckOut) || Date.parse(v.requestedCheckOut!) > Date.parse(v.requestedCheckIn!),
    { message: "The check-out must be after the check-in.", path: ["requestedCheckOut"] }
  );
export type RequestCorrectionInput = z.infer<typeof requestCorrectionSchema>;

export const decideCorrectionSchema = z.object({
  regularizationId: z.uuid("Choose a request."),
  decision: z.enum(["approve", "reject"]),
});

/** "YYYY-MM-DD" for `at` in the given IANA time zone (the org's "today"). */
export function dayIn(timeZone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** Hours between two instants, 2 decimals, never negative. */
export function hoursBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round(((to.getTime() - from.getTime()) / 3_600_000) * 100) / 100);
}

/** A corrected time belongs to the attendance day (±1 day, for night shifts and time zones). */
export function onOrNearDay(instant: string, day: string): boolean {
  const t = Date.parse(instant);
  const d = Date.parse(`${day}T00:00:00Z`);
  return !Number.isNaN(t) && !Number.isNaN(d) && t >= d - 86_400_000 && t < d + 2 * 86_400_000;
}
