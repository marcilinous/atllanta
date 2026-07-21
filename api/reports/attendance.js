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
  const { start_date, end_date, department_id, user_id } = req.query;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: "start_date and end_date required" });
  }

  let query = sb
    .from("attendance")
    .select("*, user:user_id(full_name, email)")
    .gte("date", start_date)
    .lte("date", end_date)
    .order("date", { ascending: false });

  if (membership.role === "member") {
    query = query.eq("user_id", user.id);
  } else if (user_id) {
    query = query.eq("user_id", user_id);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const summary = {
    total_records: data.length,
    present: data.filter((r) => r.status === "present").length,
    absent: data.filter((r) => r.status === "absent").length,
    late: data.filter((r) => r.status === "late").length,
    half_day: data.filter((r) => r.status === "half_day").length,
    on_leave: data.filter((r) => r.status === "on_leave").length,
    avg_hours:
      data.length > 0
        ? (
            data.reduce((s, r) => s + (parseFloat(r.total_hours) || 0), 0) /
            data.filter((r) => r.total_hours).length
          ).toFixed(1)
        : "0",
  };

  return res.status(200).json({ records: data, summary });
}
