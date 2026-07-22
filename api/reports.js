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

  const { type, start_date, end_date, leave_type_id, status, job_id, user_id, department_id } = req.query;

  if (type === "attendance") {
    if (!start_date || !end_date) return res.status(400).json({ error: "start_date and end_date required" });

    let query = sb
      .from("attendance")
      .select("*, user:user_id(full_name, email)")
      .gte("date", start_date)
      .lte("date", end_date)
      .order("date", { ascending: false });

    const isMember = ["member", "client_member"].includes(membership.role);
    if (isMember) query = query.eq("user_id", user.id);
    else if (user_id) query = query.eq("user_id", user_id);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const withHours = data.filter((r) => r.total_hours);
    const summary = {
      total_records: data.length,
      present: data.filter((r) => r.status === "present").length,
      absent: data.filter((r) => r.status === "absent").length,
      late: data.filter((r) => r.status === "late").length,
      half_day: data.filter((r) => r.status === "half_day").length,
      on_leave: data.filter((r) => r.status === "on_leave").length,
      avg_hours: withHours.length > 0
        ? (data.reduce((s, r) => s + (parseFloat(r.total_hours) || 0), 0) / withHours.length).toFixed(1)
        : "0",
    };
    return res.status(200).json({ records: data, summary });

  } else if (type === "leave") {
    if (!start_date || !end_date) return res.status(400).json({ error: "start_date and end_date required" });

    let query = sb
      .from("leave_requests")
      .select("*, requester:user_id(full_name, email), leave_type:leave_type_id(name, code)")
      .gte("start_date", start_date)
      .lte("end_date", end_date)
      .order("created_at", { ascending: false });

    if (["member", "client_member"].includes(membership.role)) query = query.eq("user_id", user.id);
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

  } else if (type === "recruitment") {
    let jobsQuery = sb.from("jobs").select("id, title, status, created_at");
    if (job_id) jobsQuery = jobsQuery.eq("id", job_id);
    else jobsQuery = jobsQuery.in("status", ["open", "on_hold"]);

    const { data: jobs, error: jobsErr } = await jobsQuery;
    if (jobsErr) return res.status(500).json({ error: jobsErr.message });

    const pipeline = [];
    for (const job of jobs || []) {
      const { data: apps } = await sb
        .from("job_applications")
        .select("status")
        .eq("job_id", job.id);

      const stages = {};
      (apps || []).forEach((a) => { stages[a.status] = (stages[a.status] || 0) + 1; });

      pipeline.push({
        job_id: job.id,
        title: job.title,
        status: job.status,
        total_applicants: apps?.length || 0,
        stages,
      });
    }
    return res.status(200).json({ pipeline });

  } else {
    return res.status(400).json({ error: "type query param required: attendance, leave, or recruitment" });
  }
}
