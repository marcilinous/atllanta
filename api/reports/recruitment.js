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
    .select("organization_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership?.organization_id) {
    return res.status(403).json({ error: "No organization found" });
  }

  const { job_id } = req.query;

  let jobsQuery = sb
    .from("jobs")
    .select("id, title, status, created_at");

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
    (apps || []).forEach((a) => {
      stages[a.status] = (stages[a.status] || 0) + 1;
    });

    pipeline.push({
      job_id: job.id,
      title: job.title,
      status: job.status,
      total_applicants: apps?.length || 0,
      stages,
    });
  }

  return res.status(200).json({ pipeline });
}
