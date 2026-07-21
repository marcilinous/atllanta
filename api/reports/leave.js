import { supabaseAdmin, SUPABASE_URL } from "../../lib/supabaseServer.js";

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
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET" });

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

  const orgId = membership.organization_id;
  const { start_date, end_date, leave_type_id, status } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: "start_date and end_date required" });
  }

  let query = sb
    .from("leave_requests")
    .select("*, requester:user_id(full_name, email), leave_type:leave_type_id(name, code)")
    .gte("start_date", start_date)
    .lte("end_date", end_date)
    .order("created_at", { ascending: false });

  if (membership.role === "member") {
    query = query.eq("user_id", user.id);
  }
  if (leave_type_id) query = query.eq("leave_type_id", leave_type_id);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const summary = {
    total_requests: data.length,
    total_days: data.reduce((s, r) => s + (parseFloat(r.days) || 0), 0),
    pending: data.filter((r) => r.status === "pending").length,
    approved: data.filter((r) => r.status === "approved").length,
    rejected: data.filter((r) => r.status === "rejected").length,
  };

  return res.status(200).json({ records: data, summary });
}
