// Server-side verification for a password-recovery link (Phase 2 item 3).
//
// The reset email links to /auth/confirm?token_hash=...&type=recovery. GET on
// that page must stay side-effect free — Outlook Safe Links and similar
// scanners prefetch GET URLs and would burn the one-time token — so
// verification only ever runs from a Server Action fired by a button press.
// verifyOtp writes the recovery session to cookies as a side effect; the
// caller then does a full navigation to RECOVERY_REDIRECT, the legacy
// set-new-password screen, which reads that same cookie session.
//
// No "use server", no "server-only", no next/* imports: this module is
// plain, injectable logic (client passed in, same as src/lib/events/publish.ts)
// so it can be unit tested directly with node:test against a fake client.
import { ActionError } from "../actions.ts";

export const RECOVERY_REDIRECT = "/reset-password";

export const RECOVERY_LINK_INVALID =
  "This reset link is invalid or has expired. Request a new one from the sign-in page.";

/** Structural, not the real SupabaseClient type — a test fake fits this too. */
export interface RecoveryClient {
  auth: {
    verifyOtp(params: {
      type: "recovery";
      token_hash: string;
    }): PromiseLike<{ error: unknown }>;
  };
}

export async function verifyRecoveryToken(
  client: RecoveryClient,
  tokenHash: string
): Promise<{ next: typeof RECOVERY_REDIRECT }> {
  const { error } = await client.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) {
    // Never surface the raw error or the token: a stale/reused token_hash is
    // an expected outcome (link already used, link expired), not a crash to
    // log with detail attached.
    throw new ActionError(RECOVERY_LINK_INVALID);
  }
  return { next: RECOVERY_REDIRECT };
}
