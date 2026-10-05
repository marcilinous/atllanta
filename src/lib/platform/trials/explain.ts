// The platform functions' own refusals, and nothing else, reach the screen.
// Any other database message (RLS, constraint names) becomes the generic error.
// No `server-only`: tests import it.
const OWN_MESSAGES = [
  /^Only the Atllanta platform owner can do that$/,
  /^Company not found$/,
  /^Extend by 7, 14 or 30 days$/,
  /^Only a company on a trial can be extended$/,
  /^This would pass the \d+-day extension limit$/,
];

export function explainPlatformError(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === "object"; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") {
      const message = String((e as { message?: unknown }).message ?? "");
      if ((code === "42501" || code === "22023") && OWN_MESSAGES.some((re) => re.test(message))) return message;
      return null;
    }
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}
