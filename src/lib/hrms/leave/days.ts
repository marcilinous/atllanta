// How many days a leave request costs — the legacy rule from
// public/views/leave/apply.js, computed on the server so the browser's number
// is never trusted:
//   - Monday–Friday count; Saturday and Sunday do not. Holidays are not
//     excluded (the legacy app never did; changing that is a product decision).
//   - A half day on a single date is 0.5; a half day across a range is the
//     working days minus 0.5, never less than 0.5.
// Dates are calendar dates ("YYYY-MM-DD") handled in UTC, so the server's
// time zone cannot shift a day.
//
// No `server-only` import: tests import this file directly.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses "YYYY-MM-DD" to a UTC date, or null if it is not a real calendar date. */
export function parseDay(value: string): Date | null {
  if (!DATE_RE.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return null;
  return d;
}

/** Monday–Friday days from start to end inclusive; 0 if end is before start. */
export function countWorkingDays(start: string, end: string): number {
  const s = parseDay(start);
  const e = parseDay(end);
  if (!s || !e || e < s) return 0;
  let count = 0;
  for (const d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) count++;
  }
  return count;
}

/** Calendar days from start to end inclusive; 0 if end is before start. */
export function countCalendarDays(start: string, end: string): number {
  const s = parseDay(start);
  const e = parseDay(end);
  if (!s || !e || e < s) return 0;
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
}

/** The days a request costs, per the legacy rule above. */
export function leaveDays(start: string, end: string, halfDay: boolean): number {
  const working = countWorkingDays(start, end);
  if (!halfDay) return working;
  if (start === end) return working > 0 ? 0.5 : 0;
  return working > 0 ? Math.max(0.5, working - 0.5) : 0;
}
