// POST /api/match
// Body: { application_id } OR { job_id, candidate_id }
// Scores a candidate's resume against the job's JD via Groq, stores the
// result on the application row, charges 1 credit to the owning org.
//
// Auth: expects the caller's Supabase access token in the Authorization
// header. The token is verified, then RLS-equivalent access is checked
// before the service-role client does the write.

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user?.id) return res.status(401).json({ error: "Invalid session" });

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({
      error: "GROQ_API_KEY is not set on the server.",
    });
  }

  const db = supabaseAdmin();
  const { application_id, job_id, candidate_id } = req.body || {};

  // Resolve or create the application row
  let app;
  if (application_id) {
    const { data } = await db
      .from("applications")
      .select("id, job_id, candidate_id")
      .eq("id", application_id)
      .single();
    app = data;
  } else if (job_id && candidate_id) {
    const { data } = await db
      .from("applications")
      .upsert(
        { job_id, candidate_id },
        { onConflict: "job_id,candidate_id" }
      )
      .select("id, job_id, candidate_id")
      .single();
    app = data;
  }
  if (!app) return res.status(404).json({ error: "Application not found" });

  // Load job + candidate + org, and verify the caller can access this client
  const { data: job } = await db
    .from("jobs")
    .select("id, title, jd_raw_text, description, client_id, clients(id, organization_id, name)")
    .eq("id", app.job_id)
    .single();
  const { data: candidate } = await db
    .from("candidates")
    .select("id, name, resume_raw_text")
    .eq("id", app.candidate_id)
    .single();

  if (!job || !candidate) {
    return res.status(404).json({ error: "Job or candidate not found" });
  }

  const orgId = job.clients.organization_id;
  const { data: membership } = await db
    .from("memberships")
    .select("id, role, client_id")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle();

  const allowed =
    membership &&
    (["agency_admin", "super_admin"].includes(membership.role) ||
      membership.client_id === job.client_id);
  if (!allowed) return res.status(403).json({ error: "No access to this client" });

  const jd = job.jd_raw_text || job.description || "";
  const resume = candidate.resume_raw_text || "";
  if (!jd.trim() || !resume.trim()) {
    return res.status(400).json({
      error: "Both the job's JD text and the candidate's resume text are required before matching.",
    });
  }

  // Check credits (soft_bill lets it go negative; hard_stop blocks)
  const { data: org } = await db
    .from("organizations")
    .select("id, credits_balance, credit_overage_mode")
    .eq("id", orgId)
    .single();
  if (org.credit_overage_mode === "hard_stop" && org.credits_balance <= 0) {
    return res.status(402).json({ error: "Out of credits. Top up to continue matching." });
  }

  // Call Groq
  const prompt = `You are an expert technical recruiter. Score how well this resume matches the job description.

JOB TITLE: ${job.title}

JOB DESCRIPTION:
${jd.slice(0, 6000)}

RESUME:
${resume.slice(0, 6000)}

Respond ONLY with minified JSON, no markdown fences, in this exact shape:
{"score": <0-100 number>, "summary": "<2-3 sentence assessment>", "strengths": ["..."], "gaps": ["..."]}`;

  const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!groqResp.ok) {
    const detail = await groqResp.text();
    return res.status(502).json({ error: "Groq request failed", detail });
  }

  const groqData = await groqResp.json();
  let parsed;
  try {
    const raw = (groqData.choices?.[0]?.message?.content || "")
      .replace(/```json|```/g, "")
      .trim();
    parsed = JSON.parse(raw);
  } catch {
    return res.status(502).json({ error: "Could not parse model response" });
  }

  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));

  // Persist result
  const { error: updateErr } = await db
    .from("applications")
    .update({
      match_score: score,
      match_summary: parsed.summary || "",
      match_raw_response: parsed,
      stage: "screened",
      updated_at: new Date().toISOString(),
    })
    .eq("id", app.id);
  if (updateErr) return res.status(500).json({ error: updateErr.message });

  // Charge 1 credit
  await db
    .from("organizations")
    .update({ credits_balance: org.credits_balance - 1 })
    .eq("id", orgId);
  await db.from("credit_ledger").insert({
    organization_id: orgId,
    action_type: "resume_match",
    credits_delta: -1,
    reference_id: app.id,
  });

  return res.status(200).json({
    application_id: app.id,
    score,
    summary: parsed.summary,
    strengths: parsed.strengths || [],
    gaps: parsed.gaps || [],
    credits_remaining: org.credits_balance - 1,
  });
}
