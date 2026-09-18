// POST /api/match
// Body: { application_id } OR { job_id, candidate_id }
// Scores a candidate's resume against the job's JD with AI and stores the result
// on the application row. AI usage is checked and recorded by lib/aiGateway.js.

import { resolveCaller, runAI } from "../lib/aiGateway.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set on the server." });
  }
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set on the server." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const caller = await resolveCaller(token);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.error });

  const db = caller.db;
  const { application_id, job_id, candidate_id } = req.body || {};

  // Resolve the job first, so ownership is checked before anything is written.
  let app = null;
  let jobId = job_id;
  let candidateId = candidate_id;
  if (application_id) {
    const { data, error } = await db
      .from("job_applications")
      .select("id, job_id, candidate_id")
      .eq("id", application_id)
      .maybeSingle();
    if (error) return res.status(503).json({ error: "Could not load data — please try again" });
    app = data;
    if (!app) return res.status(404).json({ error: "Application not found" });
    jobId = app.job_id;
    candidateId = app.candidate_id;
  } else if (!(job_id && candidate_id)) {
    return res.status(400).json({ error: "application_id, or job_id and candidate_id, are required" });
  }

  const { data: job, error: jobError } = await db
    .from("jobs")
    .select("id, title, jd_raw_text, description, org_id")
    .eq("id", jobId)
    .maybeSingle();
  if (jobError) return res.status(503).json({ error: "Could not load data — please try again" });
  if (!job) return res.status(404).json({ error: "Job or candidate not found" });
  if (job.org_id !== caller.orgId) return res.status(403).json({ error: "No access to this job" });

  const { data: candidate, error: candidateError } = await db
    .from("candidates")
    .select("id, full_name, name, resume_text, resume_raw_text, org_id")
    .eq("id", candidateId)
    .maybeSingle();
  if (candidateError) return res.status(503).json({ error: "Could not load data — please try again" });
  if (!candidate) return res.status(404).json({ error: "Job or candidate not found" });
  if (candidate.org_id !== caller.orgId) return res.status(403).json({ error: "No access to this candidate" });

  if (!app) {
    const { data, error: upsertErr } = await db
      .from("job_applications")
      .upsert({ job_id: jobId, candidate_id: candidateId }, { onConflict: "job_id,candidate_id" })
      .select("id, job_id, candidate_id")
      .single();
    if (upsertErr) return res.status(500).json({ error: "Could not create the application — please try again" });
    app = data;
    if (!app) return res.status(500).json({ error: "Could not create the application" });
  }

  const jd = job.jd_raw_text || job.description || "";
  const resume = candidate.resume_text || candidate.resume_raw_text || "";
  if (!jd.trim() || !resume.trim()) {
    return res.status(400).json({
      error: "Both the job's JD text and the candidate's resume text are required before matching.",
    });
  }

  const prompt = `You are an expert technical recruiter. Score how well this resume matches the job description.

JOB TITLE: ${job.title}

JOB DESCRIPTION:
${jd.slice(0, 6000)}

RESUME:
${resume.slice(0, 6000)}

Respond ONLY with minified JSON, no markdown fences, in this exact shape:
{"score": <0-100 number>, "summary": "<2-3 sentence assessment>", "strengths": ["..."], "gaps": ["..."]}`;

  const ai = await runAI({
    caller,
    feature: "match",
    messages: [{ role: "user", content: prompt }],
    maxTokens: 600,
    temperature: 0.2,
    metadata: { application_id: app.id, job_id: job.id },
  });
  if (!ai.ok) return res.status(ai.status).json(ai.body);

  let parsed;
  try {
    parsed = JSON.parse(ai.text.replace(/```json|```/g, "").trim());
  } catch {
    return res.status(502).json({ error: "Could not parse model response" });
  }

  const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));

  const { error: updateErr } = await db
    .from("job_applications")
    .update({
      match_score: score,
      match_summary: parsed.summary || "",
      match_raw_response: parsed,
      status: "screened",
      updated_at: new Date().toISOString(),
    })
    .eq("id", app.id);
  if (updateErr) return res.status(500).json({ error: "Could not save the match — please try again" });

  return res.status(200).json({
    application_id: app.id,
    score,
    summary: parsed.summary,
    strengths: parsed.strengths || [],
    gaps: parsed.gaps || [],
    tokens_used: ai.usage.total,
  });
}
