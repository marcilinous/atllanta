// POST /api/extract-candidate
// Takes raw resume text, uses AI (through lib/aiGateway.js) to extract
// structured candidate details.
// Body: { resume_text: "..." }
// Returns: { name, email, phone, summary }

import { resolveCaller, runAI } from "../../lib/aiGateway.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set. Add it in Vercel → Settings → Environment Variables (enable for Preview)." });
  }
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set on the server." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const caller = await resolveCaller(token);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.error });

  const { resume_text } = req.body || {};
  if (!resume_text || !resume_text.trim()) {
    return res.status(400).json({ error: "resume_text is required" });
  }

  const prompt = `Extract the candidate's contact details from this resume text. Return ONLY minified JSON, no markdown fences, in this exact shape:
{"name": "<full name>", "email": "<email or null>", "phone": "<phone with country code or null>", "summary": "<one sentence describing their profile>"}

If a field is not found, use null. For phone, include country code if visible (e.g. +91...). For name, use the most prominent name at the top of the resume.

RESUME TEXT:
${resume_text.slice(0, 4000)}`;

  const ai = await runAI({
    caller,
    feature: "candidate_extract",
    messages: [{ role: "user", content: prompt }],
    maxTokens: 300,
    temperature: 0.1,
  });
  if (!ai.ok) return res.status(ai.status).json(ai.body);

  let parsed;
  try {
    parsed = JSON.parse(ai.text.replace(/```json|```/g, "").trim());
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
