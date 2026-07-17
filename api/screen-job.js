// POST /api/screen-job
// Batch-scores candidates for a given job.
// Body: { job_id, mode: "unscored" | "all", application_ids?: string[] }
// Returns: { results: [{ application_id, candidate_name, score, error? }], credits_used }

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
    return res.status(500).json({ error: "GROQ_API_KEY is not set." });
  }

  const db = supabaseAdmin();
  const { job_id, mode, application_ids } = req.body || {};
  if (!job_id) return res.status(400).json({ error: "job_id is required" });

  const { data: job } = await db
    .from("jobs")
    .select("id, title, jd_raw_text, description, client_id, clients(id, organization_id)")
    .eq("id", job_id)
    .single();

  if (!job) return res.status(404).json({ error: "Job not found" });

  const orgId = job.clients.organization_id;
  const { data: membership } = await db
    .from("memberships")
    .select("id, role, client_id")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle();

  const allowed = membership &&
    (["agency_admin", "super_admin"].includes(membership.role) ||
      membership.client_id === job.client_id);
  if (!allowed) return res.status(403).json({ error: "No access to this client" });

  const jd = job.jd_raw_text || job.description || "";
  if (!jd.trim()) {
    return res.status(400).json({ error: "This job has no JD text to score against." });
  }

  let appsQuery = db
    .from("applications")
    .select("id, candidate_id, match_score")
    .eq("job_id", job_id);

  if (Array.isArray(application_ids) && application_ids.length) {
    appsQuery = appsQuery.in("id", application_ids);
  } else if (mode !== "all") {
    appsQuery = appsQuery.is("match_score", null);
  }

  const { data: apps } = await appsQuery;
  if (!apps?.length) {
    return res.status(200).json({ results: [], credits_used: 0, message: "No candidates to screen" });
  }

  const candIds = apps.map((a) => a.candidate_id);
  const { data: candidates } = await db
    .from("candidates")
    .select("id, name, resume_raw_text")
    .in("id", candIds);

  const candMap = {};
  (candidates || []).forEach((c) => { candMap[c.id] = c; });

  const { data: org } = await db
    .from("organizations")
    .select("id, credits_balance, credit_overage_mode")
    .eq("id", orgId)
    .single();

  const results = [];
  let creditsUsed = 0;
  let creditsRemaining = org.credits_balance;

  for (const app of apps) {
    const cand = candMap[app.candidate_id];
    if (!cand?.resume_raw_text?.trim()) {
      results.push({ application_id: app.id, candidate_name: cand?.name || "Unknown", score: null, error: "No resume text" });
      continue;
    }

    if (org.credit_overage_mode === "hard_stop" && creditsRemaining <= 0) {
      results.push({ application_id: app.id, candidate_name: cand.name, score: null, error: "Out of credits" });
      continue;
    }

    const prompt = `You are an expert technical recruiter. Score how well this resume matches the job description.

JOB TITLE: ${job.title}

JOB DESCRIPTION:
${jd.slice(0, 6000)}

RESUME:
${cand.resume_raw_text.slice(0, 6000)}

Respond ONLY with minified JSON, no markdown fences, in this exact shape:
{"score": <0-100 number>, "summary": "<2-3 sentence assessment>", "strengths": ["..."], "gaps": ["..."]}`;

    try {
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
        results.push({ application_id: app.id, candidate_name: cand.name, score: null, error: "Groq API error" });
        continue;
      }

      const groqData = await groqResp.json();
      const raw = (groqData.choices?.[0]?.message?.content || "")
        .replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(raw);
      const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));

      await db.from("applications").update({
        match_score: score,
        match_summary: parsed.summary || "",
        match_raw_response: parsed,
        stage: "screened",
        updated_at: new Date().toISOString(),
      }).eq("id", app.id);

      creditsRemaining -= 1;
      creditsUsed += 1;
      await db.from("organizations").update({ credits_balance: creditsRemaining }).eq("id", orgId);
      await db.from("credit_ledger").insert({
        organization_id: orgId,
        action_type: "resume_match",
        credits_delta: -1,
        reference_id: app.id,
      });

      results.push({ application_id: app.id, candidate_name: cand.name, score, summary: parsed.summary });
    } catch (err) {
      results.push({ application_id: app.id, candidate_name: cand.name, score: null, error: "Parse error" });
    }
  }

  return res.status(200).json({ results, credits_used: creditsUsed, credits_remaining: creditsRemaining });
}
