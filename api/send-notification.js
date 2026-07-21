import { supabaseAdmin, SUPABASE_URL } from "../lib/supabaseServer.js";

async function getUserFromToken(token) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (!resp.ok) return null;
  return resp.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: "Invalid token" });

  const sb = supabaseAdmin();
  const { data: membership } = await sb
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership?.organization_id) {
    return res.status(403).json({ error: "No organization found" });
  }

  const isAdmin = ["owner", "admin", "super_admin", "agency_admin"].includes(membership.role);
  if (!isAdmin) return res.status(403).json({ error: "Admin access required" });

  const { to, subject, body, channel, user_id, module, entity_type, entity_id } = req.body || {};

  if (channel === "email" || (!channel && to)) {
    if (!to || !subject) return res.status(400).json({ error: "to and subject required for email" });

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

    const emailResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "Atllanta <notifications@atllanta.app>",
        to,
        subject: `[Atllanta] ${subject}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#1A1D23">${subject}</h2>
          <div style="color:#6B7080">${body || ''}</div>
          <hr style="border:none;border-top:1px solid #E2E4E9;margin:24px 0">
          <p style="font-size:12px;color:#9CA0AB">Atllanta Business OS</p>
        </div>`,
      }),
    });

    const emailResult = await emailResp.json();
    if (!emailResp.ok) return res.status(502).json({ error: "Email send failed", details: emailResult });
    return res.status(200).json({ sent: true, id: emailResult.id });
  }

  if (channel === "in_app" || !channel) {
    if (!user_id || !subject) return res.status(400).json({ error: "user_id and subject required" });

    const { error } = await sb.from("notifications").insert({
      org_id: membership.organization_id,
      user_id,
      title: subject,
      body: body || null,
      module: module || "system",
      entity_type: entity_type || null,
      entity_id: entity_id || null,
      channel: "in_app",
      status: "unread",
    });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ sent: true });
  }

  return res.status(400).json({ error: "Unsupported channel. Use 'email' or 'in_app'." });
}
