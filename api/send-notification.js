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

  const { user_id, title, body, module, entity_type, entity_id, channel } = req.body || {};
  if (!user_id || !title || !module) {
    return res.status(400).json({ error: "user_id, title, and module are required" });
  }

  const sb = supabaseAdmin();

  const { data: membership } = await sb
    .from("memberships")
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership?.organization_id) {
    return res.status(403).json({ error: "No organization found" });
  }

  const { data: notif, error } = await sb.from("notifications").insert({
    org_id: membership.organization_id,
    user_id,
    title,
    body: body || null,
    module,
    entity_type: entity_type || null,
    entity_id: entity_id || null,
    channel: channel || "in_app",
    status: "unread",
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });

  if (channel === "email") {
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const { data: recipient } = await sb.from("users").select("email").eq("id", user_id).single();
      if (recipient?.email) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: "Atllanta <notifications@atllanta.com>",
            to: [recipient.email],
            subject: title,
            text: body || title,
          }),
        }).catch(() => {});
      }
    }
  }

  return res.status(200).json({ notification: notif });
}
