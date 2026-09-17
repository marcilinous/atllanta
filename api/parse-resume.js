// POST /api/parse-resume
// Accepts a resume file (PDF or DOCX) as base64 JSON payload, extracts text.
// Body: { filename: "resume.pdf", data: "<base64 string>" }
// Returns: { text: "<extracted text>" }
//
// POST /api/parse-resume?action=parse-jd
// Parses a job description via Groq and extracts structured skills.
// Body: { description: "...", job_id?: "..." }
// Returns: { parsed_skills: { must_have, nice_to_have, ... } }

import { resolveCaller, runAI } from "../lib/aiGateway.js";

function getExtension(filename) {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set. Add it in Vercel → Settings → Environment Variables (enable for Preview)." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const caller = await resolveCaller(token);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.error });

  const action = req.query?.action;
  if (action === "parse-jd") return handleParseJD(req, res, caller);

  const { filename, data } = req.body || {};
  if (!filename || !data) {
    return res.status(400).json({ error: "filename and data (base64) are required" });
  }

  const ext = getExtension(filename);
  if (!["pdf", "docx", "doc"].includes(ext)) {
    return res.status(400).json({ error: "Only PDF and DOCX files are supported" });
  }

  const buffer = Buffer.from(data, "base64");

  const MAX_SIZE = 3 * 1024 * 1024;
  if (buffer.length > MAX_SIZE) {
    return res.status(400).json({ error: "File too large (max 3 MB)" });
  }

  let text = "";

  try {
    if (ext === "pdf") {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(buffer));
      text = (result.text || []).join("\n");
    } else {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || "";
    }
  } catch (err) {
    return res.status(422).json({
      error: "Could not extract text from this file. It may be scanned or corrupted.",
      detail: err?.message || String(err),
    });
  }

  text = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) {
    return res.status(422).json({
      error: "No text found in this file. It may be a scanned image — try pasting the text instead.",
    });
  }

  return res.status(200).json({ text });
}

async function handleParseJD(req, res, caller) {
  const { description, job_id } = req.body || {};
  if (!description) return res.status(400).json({ error: "description is required" });

  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: "GROQ_API_KEY not configured" });

  // Only parse into a job the caller's organisation owns.
  if (job_id) {
    const { data: job } = await caller.db.from("jobs").select("id, org_id").eq("id", job_id).maybeSingle();
    if (!job) return res.status(404).json({ error: "Job not found" });
    if (job.org_id !== caller.orgId) return res.status(403).json({ error: "No access to this job" });
  }

  const prompt = `Extract skills from this job description. Return JSON only:
{
  "must_have": ["skill1", "skill2"],
  "nice_to_have": ["skill3", "skill4"],
  "experience_min": 2,
  "experience_max": 5,
  "education": ["degree1"]
}

Job Description:
${description.slice(0, 4000)}`;

  const ai = await runAI({
    caller,
    feature: "jd_parse",
    messages: [
      { role: "system", content: "You extract structured skills from job descriptions. Return valid JSON only, no markdown." },
      { role: "user", content: prompt },
    ],
    maxTokens: 1024,
    temperature: 0.1,
    metadata: job_id ? { job_id } : {},
  });
  if (!ai.ok) return res.status(ai.status).json(ai.body);

  let parsed;
  try {
    const jsonMatch = ai.text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : ai.text);
  } catch {
    return res.status(200).json({ raw: ai.text, parsed_skills: null });
  }

  if (job_id) {
    await caller.db.from("jobs").update({ parsed_skills: parsed }).eq("id", job_id);
  }

  return res.status(200).json({ parsed_skills: parsed });
}
