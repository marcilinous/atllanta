import { supabaseAdmin, SUPABASE_URL } from "../lib/supabaseServer.js";

const GROQ_MODEL = "llama-3.3-70b-versatile";

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

  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: "query is required" });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: "GROQ_API_KEY not configured" });

  const sb = supabaseAdmin();
  const { data: membership } = await sb
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const orgId = membership?.organization_id;
  const role = membership?.role || "member";
  const today = new Date().toISOString().split("T")[0];

  const systemPrompt = `You are Atllanta AI, an HR assistant. You help with HR queries.
Available data: employees, attendance, leave_requests, jobs, candidates, interviews.
Current user role: ${role}. Org ID: ${orgId}. Today: ${today}.

For data queries, respond with JSON:
{"action": "query", "table": "...", "filters": {...}, "select": "...", "display": "text"}

For general questions, respond normally as text.

Tables available:
- users (full_name, email, role, status, department_id, date_of_joining)
- attendance (user_id, date, check_in, check_out, status, total_hours)
- leave_requests (user_id, leave_type_id, start_date, end_date, days, status)
- jobs (title, status, location, employment_type)
- candidates (full_name, email, source)
- job_applications (job_id, candidate_id, match_score, status)
- interviews (job_application_id, scheduled_at, status, round_name)

Only return data the user's role permits. Members can see their own data. Managers/admins can see team/org data.`;

  const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!groqResp.ok) {
    const err = await groqResp.text();
    return res.status(502).json({ error: "Groq API error", details: err });
  }

  const result = await groqResp.json();
  const text = result.choices?.[0]?.message?.content || "";

  let parsed = null;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
  } catch {}

  if (parsed?.action === "query" && parsed.table) {
    let q = sb.from(parsed.table).select(parsed.select || "*");
    if (orgId) q = q.eq("org_id", orgId);
    if (parsed.filters) {
      for (const [key, val] of Object.entries(parsed.filters)) {
        q = q.eq(key, val);
      }
    }
    q = q.limit(20);
    const { data, error } = await q;
    if (error) return res.status(200).json({ response: text, data: null, error: error.message });
    return res.status(200).json({ response: text, data, action: parsed });
  }

  return res.status(200).json({ response: text, data: null });
}
