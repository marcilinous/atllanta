// POST /api/screen-job
// Batch-scores candidates for a given job.
// Body: { job_id, mode: "unscored" | "all", application_ids?: string[], method: "ai" | "python" }
// method=ai  → AI scoring through lib/aiGateway.js (uses AI tokens; max 50 candidates per request)
// method=python → keyword + TF-IDF algorithmic scoring (free)
// Returns: { results: [{ application_id, candidate_name, score, error? }], tokens_used, processed, remaining, method }

import { resolveCaller, runAI } from "../lib/aiGateway.js";

const AI_BATCH_LIMIT = 50;

// ── Algorithmic matching engine ─────────────────────────────────────

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
  "using","used","work","working","worked","based","including","like","well",
  "able","need","needs","required","preferred","must","strong","good","great",
  "ensure","responsible","role","team","company","looking","candidate","position",
  "experience","years","year","knowledge","understanding","ability","skills",
  "please","apply","join","offer","provide","support","develop","manage",
]);

const SKILL_TERMS = new Set([
  "javascript","typescript","python","java","c++","c#","ruby","go","golang","rust",
  "swift","kotlin","scala","php","perl","r","matlab","sql","nosql","graphql",
  "react","angular","vue","svelte","next.js","nuxt","remix","gatsby",
  "node.js","express","fastify","django","flask","spring","rails","laravel",
  "aws","azure","gcp","docker","kubernetes","terraform","jenkins","ci/cd",
  "mongodb","postgresql","mysql","redis","elasticsearch","cassandra","dynamodb",
  "git","linux","nginx","apache","rest","api","microservices","serverless",
  "html","css","sass","tailwind","bootstrap","figma","sketch",
  "machine learning","deep learning","nlp","computer vision","tensorflow",
  "pytorch","pandas","numpy","scikit-learn","data science","data engineering",
  "agile","scrum","kanban","devops","sre","tdd","bdd",
  "react native","flutter","ios","android","mobile",
  "blockchain","web3","solidity","smart contracts",
  "cybersecurity","penetration testing","encryption",
  "tableau","power bi","looker","analytics","etl","airflow","spark","hadoop",
  "salesforce","sap","erp","crm","jira","confluence",
  "communication","leadership","problem-solving","teamwork","mentoring",
]);

function stem(word) {
  if (word.length < 4) return word;
  return word
    .replace(/ies$/, "y")
    .replace(/ies$/, "y")
    .replace(/(ed|ing|tion|ment|ness|able|ible|ful|less|ous|ive|ize|ise|ity|al|er|or|ist|ent|ant)$/, "")
    .replace(/s$/, "");
}

function tokenize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\-\/]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function extractBigrams(text) {
  const lower = (text || "").toLowerCase();
  const found = [];
  for (const skill of SKILL_TERMS) {
    if (skill.includes(" ") && lower.includes(skill)) {
      found.push(skill);
    }
  }
  return found;
}

function extractSkills(tokens, bigrams) {
  const skills = new Set(bigrams);
  for (const t of tokens) {
    if (SKILL_TERMS.has(t)) skills.add(t);
  }
  return skills;
}

function extractYearsRequired(text) {
  const matches = (text || "").match(/(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)/gi) || [];
  let maxYears = 0;
  for (const m of matches) {
    const n = parseInt(m);
    if (n > maxYears) maxYears = n;
  }
  return maxYears;
}

function extractYearsFromResume(text) {
  const dates = [];
  const yearPattern = /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{4})|(\d{4})\s*[-–]\s*(?:(\d{4})|present|current)/gi;
  let m;
  while ((m = yearPattern.exec(text || "")) !== null) {
    const y = parseInt(m[1] || m[2] || m[3]);
    if (y >= 1990 && y <= 2030) dates.push(y);
  }
  if (dates.length < 2) return 0;
  return Math.max(...dates) - Math.min(...dates);
}

function algorithmicMatch(jdText, resumeText) {
  const jdTokens = tokenize(jdText);
  const resumeTokens = tokenize(resumeText);

  if (!jdTokens.length || !resumeTokens.length) {
    return { score: 0, summary: "Insufficient text for matching" };
  }

  const jdBigrams = extractBigrams(jdText);
  const resumeBigrams = extractBigrams(resumeText);

  const jdSkills = extractSkills(jdTokens, jdBigrams);
  const resumeSkills = extractSkills(resumeTokens, resumeBigrams);

  // 1. Skill match (45% weight) — most important signal
  let skillScore = 0;
  const matchedSkills = [];
  const missingSkills = [];
  if (jdSkills.size > 0) {
    for (const s of jdSkills) {
      if (resumeSkills.has(s)) {
        matchedSkills.push(s);
      } else {
        const stemmed = stem(s);
        const found = [...resumeSkills].some((rs) => stem(rs) === stemmed);
        if (found) matchedSkills.push(s);
        else missingSkills.push(s);
      }
    }
    skillScore = matchedSkills.length / jdSkills.size;
  }

  // 2. Keyword overlap with stemming (25% weight)
  const jdStems = new Set(jdTokens.map(stem));
  const resumeStems = new Set(resumeTokens.map(stem));
  const matchedStems = [...jdStems].filter((s) => resumeStems.has(s));
  const keywordScore = jdStems.size > 0 ? matchedStems.length / jdStems.size : 0;

  // 3. Experience match (15% weight)
  const requiredYears = extractYearsRequired(jdText);
  const candidateYears = extractYearsFromResume(resumeText);
  let expScore = 1;
  if (requiredYears > 0) {
    if (candidateYears >= requiredYears) expScore = 1;
    else if (candidateYears >= requiredYears * 0.7) expScore = 0.7;
    else if (candidateYears > 0) expScore = 0.4;
    else expScore = 0.2;
  }

  // 4. Education/certification signals (15% weight)
  const lower = resumeText.toLowerCase();
  const eduPatterns = [
    /\b(b\.?tech|b\.?e\.?|bachelor|b\.?sc|bca|mca)\b/,
    /\b(m\.?tech|m\.?e\.?|master|m\.?sc|mba|m\.?s\.?)\b/,
    /\b(ph\.?d|doctorate)\b/,
    /\b(certified|certification|certificate)\b/,
    /\b(aws certified|pmp|scrum master|cissp|cka|ckad)\b/i,
  ];
  const jdLower = jdText.toLowerCase();
  let eduScore = 0.5;
  const jdWantsEdu = eduPatterns.some((p) => p.test(jdLower));
  if (jdWantsEdu) {
    const resumeHasEdu = eduPatterns.some((p) => p.test(lower));
    eduScore = resumeHasEdu ? 1 : 0.2;
  } else {
    const resumeHasEdu = eduPatterns.some((p) => p.test(lower));
    eduScore = resumeHasEdu ? 0.7 : 0.5;
  }

  // Weighted combination
  const raw = (skillScore * 45 + keywordScore * 25 + expScore * 15 + eduScore * 15);
  const score = Math.round(Math.max(0, Math.min(100, raw)));

  // Build summary
  const parts = [];
  if (jdSkills.size > 0) parts.push(`Skills: ${matchedSkills.length}/${jdSkills.size} matched`);
  if (requiredYears > 0) parts.push(`Experience: ${candidateYears || "?"}yr (${requiredYears}yr required)`);
  parts.push(`Keyword overlap: ${Math.round(keywordScore * 100)}%`);
  const summary = parts.join(". ") + ".";

  return {
    score,
    summary,
    strengths: matchedSkills.slice(0, 10),
    gaps: missingSkills.slice(0, 10),
  };
}

// ── Handler ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set. Configure it in Vercel → Settings → Environment Variables." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const caller = await resolveCaller(token);
  if (!caller.ok) return res.status(caller.status).json({ error: caller.error });

  const db = caller.db;
  const { job_id, mode, application_ids, method } = req.body || {};
  if (!job_id) return res.status(400).json({ error: "job_id is required" });

  const useAI = method !== "python";

  if (useAI && !process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set. Configure it in Vercel → Settings → Environment Variables." });
  }

  const { data: job } = await db
    .from("jobs")
    .select("id, title, jd_raw_text, description, org_id")
    .eq("id", job_id)
    .single();

  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.org_id !== caller.orgId) return res.status(403).json({ error: "No access to this job" });

  const jd = job.jd_raw_text || job.description || "";
  if (!jd.trim()) {
    return res.status(400).json({ error: "This job has no JD text to score against." });
  }

  let appsQuery = db
    .from("job_applications")
    .select("id, candidate_id, match_score")
    .eq("job_id", job_id);

  if (Array.isArray(application_ids) && application_ids.length) {
    appsQuery = appsQuery.in("id", application_ids);
  } else if (mode !== "all") {
    appsQuery = appsQuery.is("match_score", null);
  }

  const { data: allApps } = await appsQuery;
  if (!allApps?.length) {
    return res.status(200).json({ results: [], tokens_used: 0, processed: 0, remaining: 0, method: useAI ? "ai" : "python", message: "No candidates to screen" });
  }

  const apps = useAI ? allApps.slice(0, AI_BATCH_LIMIT) : allApps;
  const remaining = allApps.length - apps.length;

  const candIds = apps.map((a) => a.candidate_id);
  const { data: candidates } = await db
    .from("candidates")
    .select("id, full_name, name, resume_text, resume_raw_text")
    .in("id", candIds);

  const candMap = {};
  (candidates || []).forEach((c) => { candMap[c.id] = c; });

  const results = [];
  let tokensUsed = 0;
  let stopMessage = null;   // set by the first gateway refusal; later candidates are not sent to AI

  for (const app of apps) {
    const cand = candMap[app.candidate_id];
    const candidateName = cand?.full_name || cand?.name || "Unknown";
    const resumeText = cand?.resume_text || cand?.resume_raw_text;
    if (!resumeText?.trim()) {
      results.push({ application_id: app.id, candidate_name: candidateName, score: null, error: "No resume text" });
      continue;
    }

    if (useAI) {
      if (stopMessage) {
        results.push({ application_id: app.id, candidate_name: candidateName, score: null, error: stopMessage });
        continue;
      }

      const prompt = `You are an expert technical recruiter. Score how well this resume matches the job description.

JOB TITLE: ${job.title}

JOB DESCRIPTION:
${jd.slice(0, 6000)}

RESUME:
${resumeText.slice(0, 6000)}

Respond ONLY with minified JSON, no markdown fences, in this exact shape:
{"score": <0-100 number>, "summary": "<2-3 sentence assessment>", "strengths": ["..."], "gaps": ["..."]}`;

      const ai = await runAI({
        caller,
        feature: "screen",
        messages: [{ role: "user", content: prompt }],
        maxTokens: 600,
        temperature: 0.2,
        metadata: { application_id: app.id, job_id: job.id },
      });

      if (!ai.ok) {
        const message = ai.body?.error || "AI request failed";
        if (ai.status === 429 || ai.status === 503) stopMessage = message;
        results.push({ application_id: app.id, candidate_name: candidateName, score: null, error: message });
        continue;
      }

      tokensUsed += ai.usage.total;
      try {
        const parsed = JSON.parse(ai.text.replace(/```json|```/g, "").trim());
        const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));

        await db.from("job_applications").update({
          match_score: score,
          match_summary: parsed.summary || "",
          match_raw_response: parsed,
          status: "screened",
          updated_at: new Date().toISOString(),
        }).eq("id", app.id);

        results.push({ application_id: app.id, candidate_name: candidateName, score, summary: parsed.summary });
      } catch {
        results.push({ application_id: app.id, candidate_name: candidateName, score: null, error: "Parse error" });
      }
    } else {
      // ── Algorithmic matching (free) ─────────────────────────────
      try {
        const result = algorithmicMatch(jd, resumeText);
        const score = result.score;

        await db.from("job_applications").update({
          match_score: score,
          match_summary: result.summary || "",
          match_raw_response: result,
          status: "screened",
          updated_at: new Date().toISOString(),
        }).eq("id", app.id);

        results.push({ application_id: app.id, candidate_name: candidateName, score, summary: result.summary });
      } catch {
        results.push({ application_id: app.id, candidate_name: candidateName, score: null, error: "Matching error" });
      }
    }
  }

  return res.status(200).json({
    results,
    tokens_used: tokensUsed,
    processed: apps.length,
    remaining,
    method: useAI ? "ai" : "python",
  });
}
