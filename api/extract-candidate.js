// POST /api/extract-candidate
// Takes raw resume text, uses Groq to extract structured candidate details.
// Body: { resume_text: "..." }
// Returns: { name, email, phone, summary }

import { SUPABASE_URL } from "../lib/supabaseServer.js";

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
