// POST /api/screen-job
// Batch-scores candidates for a given job.
// Body: { job_id, mode: "unscored" | "all", application_ids?: string[], method: "ai" | "python" }
// method=ai  → Groq LLM scoring (costs 1 credit per candidate)
// method=python → keyword + TF-IDF algorithmic scoring (free)
// Returns: { results: [{ application_id, candidate_name, score, error? }], credits_used }

import { supabaseAdmin, SUPABASE_URL } from "../lib/supabaseServer.js";

const GROQ_MODEL = "llama-3.3-70b-versatile";

// ── Algorithmic (Python-style) matching ─────────────────────────────

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","is","it","as","be","was","are","were","been","being","have",
  "has","had","do","does","did","will","would","shall","should","may","might",
  "can","could","that","this","these","those","i","you","he","she","we","they",
  "me","him","her","us","them","my","your","his","its","our","their","not","no",
  "so","if","then","than","too","very","just","about","up","out","into","over",
  "after","before","between","under","above","such","each","which","what","who",
  "how","when","where","while","all","any","both","few","more","most","other",
  "some","only","own","same","also","new","one","two","per","etc","via",
]);

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function termFrequency(tokens) {
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const len = tokens.length || 1;
  for (const k in tf) tf[k] /= len;
  return tf;
}

function cosineSimilarity(tfA, tfB, idf) {
  const allTerms = new Set([...Object.keys(tfA), ...Object.keys(tfB)]);
  let dot = 0, magA = 0, magB = 0;
  for (const t of allTerms) {
    const w = idf[t] || 1;
    const a = (tfA[t] || 0) * w;
    const b = (tfB[t] || 0) * w;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function keywordScore(jdTokens, resumeTokens) {
  const jdSet = new Set(jdTokens);
  const resumeSet = new Set(resumeTokens);
  if (jdSet.size === 0) return 0;
  let matched = 0;
  for (const t of jdSet) {
    if (resumeSet.has(t)) matched++;
  }
  return matched / jdSet.size;
}

function algorithmicMatch(jdText, resumeText) {
  const jdTokens = tokenize(jdText);
  const resumeTokens = tokenize(resumeText);

  if (!jdTokens.length || !resumeTokens.length) return { score: 0, summary: "Insufficient text for matching" };

  const docCount = 2;
  const allTokens = new Set([...jdTokens, ...resumeTokens]);
  const idf = {};
  for (const t of allTokens) {
    const df = (jdTokens.includes(t) ? 1 : 0) + (resumeTokens.includes(t) ? 1 : 0);
    idf[t] = Math.log((docCount + 1) / (df + 1)) + 1;
  }

  const tfJd = termFrequency(jdTokens);
  const tfResume = termFrequency(resumeTokens);

  const tfidfScore = cosineSimilarity(tfJd, tfResume, idf);
  const kwScore = keywordScore(jdTokens, resumeTokens);

  const combined = Math.round(Math.max(0, Math.min(100, (kwScore * 40 + tfidfScore * 60) * 100)));

  const jdSet = new Set(jdTokens);
  const resumeSet = new Set(resumeTokens);
  const matched = [...jdSet].filter((t) => resumeSet.has(t));
  const missing = [...jdSet].filter((t) => !resumeSet.has(t));

  const summary = `Keyword overlap: ${Math.round(kwScore * 100)}% (${matched.length}/${jdSet.size} terms). TF-IDF similarity: ${Math.round(tfidfScore * 100)}%.`;

  return {
    score: combined,
    summary,
    strengths: matched.slice(0, 8),
    gaps: missing.slice(0, 8),
  };
}

// ── Auth helper ─────────────────────────────────────────────────────

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

// ── Handler ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user?.id) return res.status(401).json({ error: "Invalid session" });

  const db = supabaseAdmin();
  const { job_id, mode, application_ids, method } = req.body || {};
  if (!job_id) return res.status(400).json({ error: "job_id is required" });

  const useAI = method !== "python";

  if (useAI && !process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set." });
  }

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

    if (useAI) {
      // ── AI matching (Groq) ──────────────────────────────────────
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
    } else {
      // ── Algorithmic matching (free) ─────────────────────────────
      try {
        const result = algorithmicMatch(jd, cand.resume_raw_text);
        const score = result.score;

        await db.from("applications").update({
          match_score: score,
          match_summary: result.summary || "",
          match_raw_response: result,
          stage: "screened",
          updated_at: new Date().toISOString(),
        }).eq("id", app.id);

        results.push({ application_id: app.id, candidate_name: cand.name, score, summary: result.summary });
      } catch (err) {
        results.push({ application_id: app.id, candidate_name: cand.name, score: null, error: "Matching error" });
      }
    }
  }

  return res.status(200).json({ results, credits_used: creditsUsed, credits_remaining: creditsRemaining, method: useAI ? "ai" : "python" });
}
