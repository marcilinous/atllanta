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
