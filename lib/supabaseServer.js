// Server-side Supabase client (service role) for Vercel functions.
// SUPABASE_URL has a safe default (project URL is public); the service role
// key MUST come from the environment and is never shipped to the browser.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://nburswxjpukntgdwuyme.supabase.co";

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// The anon key is public (RLS enforces all access). Env override optional.
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5idXJzd3hqcHVrbnRnZHd1eW1lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxODAzNzMsImV4cCI6MjA5OTc1NjM3M30.CwKJJbJ_OESmiDbs2i54egTTDUo4Om6CFUaR4G5DAwY";

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

// A client scoped to the calling user's identity: queries run under the
// user's Row Level Security, so they can only ever read what that user is
// permitted to see. Use this — never supabaseAdmin — for user-facing reads
// like the AI assistant.
export function supabaseAsUser(accessToken) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export { SUPABASE_URL, ANON_KEY };
