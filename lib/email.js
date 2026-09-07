// Shared email delivery + the account set-password invitation.
//
// Onboarding never generates or hands back a password. Instead we create the
// auth login, then email a one-time link that lands on /reset-password where
// the person sets their own password. The link is the only credential and it
// expires — nothing sensitive is ever returned by an API response.
//
// The invitation is sent through Supabase's built-in auth email (the same
// mechanism the forgot-password flow uses), so no custom sending domain or
// Resend account is required. The Resend helper below stays available for
// richer transactional mail once a verified domain is configured.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, ANON_KEY } from "./supabaseServer.js";

// Base URL of the current deployment, from the incoming request.
export function baseUrlFromReq(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (host) return `${proto}://${host}`;
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
}

// Low-level send. Returns { id } on success or { error } — never throws.
export async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { error: "RESEND_API_KEY not configured" };

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Atllanta <notifications@atllanta.app>",
      to,
      subject,
      html,
    }),
  });
  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) return { error: result?.message || "Email send failed", details: result };
  return { id: result.id };
}

// Anon client — resetPasswordForEmail is a public auth call, exactly like the
// browser forgot-password flow, so Supabase's built-in email delivers it.
const authClient = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Email a one-time set-password link for `email`. The account must already
// exist (we create it first so it can anchor membership/profile). Supabase
// sends the recovery email via its built-in mailer and the invitee lands on
// /reset-password to set their own password — no custom domain / Resend needed.
// `orgName`/`isNew` don't change Supabase's fixed template but are kept for API
// stability. Returns { sent: true } or { error }.
//
// Note: Supabase's built-in mailer is rate-limited (a few messages/hour on the
// free tier); a large bulk import can exceed it, in which case the member is
// still provisioned and an admin can re-send later via Reset pw.
export async function sendPasswordSetupEmail(db, { email, baseUrl } = {}) {
  const redirectTo = `${baseUrl}/reset-password`;
  const { error } = await authClient.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return { error: error.message };
  return { sent: true };
}
