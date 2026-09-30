// Calendar dates ("YYYY-MM-DD") shown as the viewer's locale, read in UTC so
// the date never shifts by a time zone.
function formatDay(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDate(value: string): string {
  return formatDay(value);
}

// Instants shown as a clock time in the org's time zone ("—" when unknown).
export function formatTime(value: string | null, timeZone: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone });
}

export function formatRange(start: string, end: string): string {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`;
}
