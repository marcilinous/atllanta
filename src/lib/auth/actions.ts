"use server";

// Verifies a password-recovery token on a button press (see
// src/lib/auth/recovery.ts for why this must never run on GET). action()
// catches every throw, including ActionError, so this never calls
// next/navigation's redirect() — a caught NEXT_REDIRECT would just look like
// a normal ActionError.fail to `action()`. The client navigates instead,
// once it sees { success: true, data: { next } }.

import { action } from "../actions";
import { getSupabaseServerClient } from "../supabase/server";
import { recoveryTokenSchema } from "./schemas";
import { verifyRecoveryToken } from "./recovery";

export const verifyRecovery = action(recoveryTokenSchema, async ({ tokenHash }) =>
  verifyRecoveryToken(await getSupabaseServerClient(), tokenHash)
);
