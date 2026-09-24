// Hand-written Zod schema for the recovery-token verification action
// (Phase 2 item 3). The token comes from the URL query string on
// /auth/confirm, so it is treated the same way any other untrusted client
// input is: trimmed, bounded, and shaped to what Supabase's token_hash values
// actually look like (URL-safe characters only).
import { z } from "zod";

export const recoveryTokenSchema = z.object({
  tokenHash: z
    .string()
    .trim()
    .min(1, "A reset token is required.")
    .max(512, "That reset link is invalid.")
    .regex(/^[A-Za-z0-9_-]+$/, "That reset link is invalid."),
});
export type RecoveryTokenInput = z.infer<typeof recoveryTokenSchema>;
