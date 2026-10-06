// The feedback functions' own refusals, and nothing else, reach the screen.
// No `server-only`: tests import it.
const OWN_MESSAGES = [
  /^Sign in to send feedback$/,
  /^Choose Idea, Problem or Praise$/,
  /^Rating must be 1 to 5 stars$/,
  /^Write a message of up to 2,000 characters$/,
  /^You've sent a lot of feedback today — please try again tomorrow$/,
  /^Only the Atllanta platform owner can do that$/,
  /^Feedback not found$/,
];

export function explainFeedbackError(err: unknown): string | null {
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
