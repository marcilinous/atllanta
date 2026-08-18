// POST /api/parse-resume
// Accepts a resume file (PDF or DOCX) as base64 JSON payload, extracts text.
// Body: { filename: "resume.pdf", data: "<base64 string>" }
// Returns: { text: "<extracted text>" }
//
// POST /api/parse-resume?action=parse-jd
// Parses a job description via Groq and extracts structured skills.
// Body: { description: "...", job_id?: "..." }
// Returns: { parsed_skills: { must_have, nice_to_have, ... } }

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
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user?.id) return res.status(401).json({ error: "Invalid session" });

  const action = req.query?.action;
  if (action === "parse-jd") return handleParseJD(req, res);
  if (action === "extract-candidate") return handleExtractCandidate(req, res);

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

// Extract structured candidate contact details from raw resume text via Groq.
// Body: { resume_text: "..." } → { name, email, phone, summary }
async function handleExtractCandidate(req, res) {
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set on the server." });
  }

  const { resume_text } = req.body || {};
  if (!resume_text || !resume_text.trim()) {
    return res.status(400).json({ error: "resume_text is required" });
  }

  const prompt = `Extract the candidate's contact details from this resume text. Return ONLY minified JSON, no markdown fences, in this exact shape:
{"name": "<full name>", "email": "<email or null>", "phone": "<phone with country code or null>", "summary": "<one sentence describing their profile>"}

If a field is not found, use null. For phone, include country code if visible (e.g. +91...). For name, use the most prominent name at the top of the resume.

RESUME TEXT:
${resume_text.slice(0, 4000)}`;

  const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.1,
      max_tokens: 300,
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

  return res.status(200).json({
    name: parsed.name || null,
    email: parsed.email || null,
    phone: parsed.phone || null,
    summary: parsed.summary || null,
  });
}

async function handleParseJD(req, res) {
  const { description, job_id } = req.body || {};
  if (!description) return res.status(400).json({ error: "description is required" });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: "GROQ_API_KEY not configured" });

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

  const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: "You extract structured skills from job descriptions. Return valid JSON only, no markdown." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    }),
  });

  if (!groqResp.ok) {
    const err = await groqResp.text();
    return res.status(502).json({ error: "Groq API error", details: err });
  }

  const result = await groqResp.json();
  const text = result.choices?.[0]?.message?.content || "";

  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch {
    return res.status(200).json({ raw: text, parsed_skills: null });
  }

  if (job_id) {
    const sb = supabaseAdmin();
    await sb.from("jobs").update({ parsed_skills: parsed }).eq("id", job_id);
  }

  return res.status(200).json({ parsed_skills: parsed });
}
