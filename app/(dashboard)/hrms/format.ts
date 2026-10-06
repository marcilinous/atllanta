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

// Money in the org's currency ("INR 450.50" if the code is unknown to Intl).
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatRange(start: string, end: string): string {
  return start === end ? formatDay(start) : `${formatDay(start)} – ${formatDay(end)}`;
}
