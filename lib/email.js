// Shared email delivery (Resend) + the account set-password invitation.
//
// Onboarding never generates or hands back a password. Instead we create the
// auth login, then email a Supabase-minted one-time link that lands on
// /reset-password where the person sets their own password. The link is the
// only credential and it expires — nothing sensitive is ever returned by an
// API response.

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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

// Mint a one-time set-password link for `email` and email it. The account must
// already exist (we create it first so it can anchor membership/profile). Works
// for a brand-new hire (isNew) and for re-issuing access to an existing login.
// Returns { sent: true } or { error }.
export async function sendPasswordSetupEmail(db, { email, baseUrl, orgName, isNew }) {
  const redirectTo = `${baseUrl}/reset-password`;

  // 'recovery' fits both cases: the account exists (we just created it), and the
  // link lands on /reset-password, which is built for the PASSWORD_RECOVERY flow.
  const { data, error } = await db.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  if (error) return { error: error.message };

  const link = data?.properties?.action_link;
  if (!link) return { error: "Could not generate a set-password link" };

  const org = orgName || "your team";
  const subject = isNew ? `You're invited to ${org} on Atllanta` : "Set your Atllanta password";
  const heading = isNew ? `Welcome to ${org}` : "Set your password";
  const intro = isNew
    ? `You've been added to ${esc(org)} on Atllanta. Set your password to sign in and get started.`
    : `Use the button below to set a new password for your Atllanta account.`;

  const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#1A1D23;line-height:1.6">
    <h2 style="color:#1A1D23">${esc(heading)}</h2>
    <p style="color:#4B5060">${intro}</p>
    <p style="margin:24px 0">
      <a href="${esc(link)}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600">Set your password</a>
    </p>
    <p style="font-size:13px;color:#9CA0AB">This link can be used once and expires soon. If you didn't expect this, you can ignore this email.</p>
    <hr style="border:none;border-top:1px solid #E2E4E9;margin:24px 0">
    <p style="font-size:12px;color:#9CA0AB">Atllanta</p>
  </div>`;

  const sent = await sendEmail({ to: email, subject, html });
  if (sent.error) return { error: sent.error };
  return { sent: true };
}
