// Server-side Supabase client (service role) for Vercel functions.
// SUPABASE_URL has a safe default (project URL is public); the service role
// key MUST come from the environment and is never shipped to the browser.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://nburswxjpukntgdwuyme.supabase.co";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function supabaseAdmin() {
  if (!SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it in Vercel → Project → Settings → Environment Variables."
    );
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export { SUPABASE_URL };
