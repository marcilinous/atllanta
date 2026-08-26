// POST /api/screen-job
// Batch-scores candidates for a given job.
// Body: { job_id, mode: "unscored" | "all", application_ids?: string[], method: "ai" | "python" }
// method=ai  → Groq LLM scoring (costs 1 credit per candidate)
// method=python → keyword + TF-IDF algorithmic scoring (free)
// Returns: { results: [{ application_id, candidate_name, score, error? }], credits_used }
//
// POST /api/screen-job?action=interview-questions
// Generates a candidate-specific interview guide for one application, grounded
// in that candidate's resume, the job's JD, and the gaps screening already
// found. Costs 1 credit per generation; a cached guide is returned free.
// Body: { application_id, regenerate?: boolean }
// Returns: { questions, focus_areas, generated_at, cached, credits_used }

import { supabaseAdmin, SUPABASE_URL } from "../lib/supabaseServer.js";
import { logGroqGeneration } from "../lib/langfuse.js";

const GROQ_MODEL = "openai/gpt-oss-120b";

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

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set. Configure it in Vercel → Settings → Environment Variables." });
  }

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user?.id) return res.status(401).json({ error: "Invalid or expired session — please log in again" });

  const db = supabaseAdmin();

  if (req.query?.action === "interview-questions") {
    return handleInterviewQuestions(req, res, db, user);
  }

  const { job_id, mode, application_ids, method } = req.body || {};
  if (!job_id) return res.status(400).json({ error: "job_id is required" });

  const useAI = method !== "python";

  if (useAI && !process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set. Configure it in Vercel → Settings → Environment Variables." });
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
    .from("job_applications")
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
    .select("id, full_name, name, resume_text, resume_raw_text")
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
    if (!(cand?.resume_text || cand?.resume_raw_text)?.trim()) {
      results.push({ application_id: app.id, candidate_name: cand?.full_name || cand?.name || "Unknown", score: null, error: "No resume text" });
      continue;
    }

    if (useAI) {
      // ── AI matching (Groq) ──────────────────────────────────────
      if (org.credit_overage_mode === "hard_stop" && creditsRemaining <= 0) {
        results.push({ application_id: app.id, candidate_name: cand.full_name || cand.name, score: null, error: "Out of credits" });
        continue;
      }

      const prompt = `You are an expert technical recruiter. Score how well this resume matches the job description.

JOB TITLE: ${job.title}

JOB DESCRIPTION:
${jd.slice(0, 6000)}

RESUME:
${(cand.resume_text || cand.resume_raw_text).slice(0, 6000)}

Respond ONLY with minified JSON, no markdown fences, in this exact shape:
{"score": <0-100 number>, "summary": "<2-3 sentence assessment>", "strengths": ["..."], "gaps": ["..."]}`;

      try {
        const groqStart = Date.now();
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
          results.push({ application_id: app.id, candidate_name: cand.full_name || cand.name, score: null, error: "Groq API error" });
          continue;
        }

        const groqData = await groqResp.json();
        logGroqGeneration({
          name: "screen-job",
          model: GROQ_MODEL,
          input: prompt,
          output: groqData.choices?.[0]?.message?.content,
          usage: groqData.usage,
          startTime: groqStart,
          endTime: Date.now(),
          userId: user.id,
          metadata: { org_id: orgId, job_id, application_id: app.id, candidate_id: app.candidate_id },
          modelParameters: { temperature: 0.2, max_tokens: 600 },
        });
        const raw = (groqData.choices?.[0]?.message?.content || "")
          .replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));

        await db.from("job_applications").update({
          match_score: score,
          match_summary: parsed.summary || "",
          match_raw_response: parsed,
          status: "screened",
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

        results.push({ application_id: app.id, candidate_name: cand.full_name || cand.name, score, summary: parsed.summary });
      } catch (err) {
        results.push({ application_id: app.id, candidate_name: cand.full_name || cand.name, score: null, error: "Parse error" });
      }
    } else {
      // ── Algorithmic matching (free) ─────────────────────────────
      try {
        const result = algorithmicMatch(jd, cand.resume_text || cand.resume_raw_text);
        const score = result.score;

        await db.from("job_applications").update({
          match_score: score,
          match_summary: result.summary || "",
          match_raw_response: result,
          status: "screened",
          updated_at: new Date().toISOString(),
        }).eq("id", app.id);

        results.push({ application_id: app.id, candidate_name: cand.full_name || cand.name, score, summary: result.summary });
      } catch (err) {
        results.push({ application_id: app.id, candidate_name: cand.full_name || cand.name, score: null, error: "Matching error" });
      }
    }
  }

  return res.status(200).json({ results, credits_used: creditsUsed, credits_remaining: creditsRemaining, method: useAI ? "ai" : "python" });
}

// ── Candidate-specific interview questions ──────────────────────────
//
// Screening tells you WHETHER to interview someone. This tells you WHAT to ask
// them: questions grounded in this candidate's actual resume against this job's
// JD, plus the gaps the screening pass already surfaced. Generic question banks
// are the thing this replaces, so the prompt is explicit about naming real
// employers/projects and probing real gaps.

function normalizeQuestions(parsed) {
  const CATEGORIES = [
    "Experience deep-dive",
    "Skill verification",
    "Gap probe",
    "Role fit",
    "Motivation",
  ];
  const questions = (Array.isArray(parsed?.questions) ? parsed.questions : [])
    .filter((q) => q && typeof q.question === "string" && q.question.trim())
    .slice(0, 12)
    .map((q) => ({
      category: CATEGORIES.includes(q.category) ? q.category : "Role fit",
      question: String(q.question).trim(),
      why: typeof q.why === "string" ? q.why.trim() : "",
      strong_answer: typeof q.strong_answer === "string" ? q.strong_answer.trim() : "",
      follow_up: typeof q.follow_up === "string" ? q.follow_up.trim() : "",
    }));

  const focus_areas = (Array.isArray(parsed?.focus_areas) ? parsed.focus_areas : [])
    .filter((f) => typeof f === "string" && f.trim())
    .slice(0, 6)
    .map((f) => f.trim());

  return { questions, focus_areas };
}

async function handleInterviewQuestions(req, res, db, user) {
  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is not set. Configure it in Vercel → Settings → Environment Variables." });
  }

  const { application_id, regenerate } = req.body || {};
  if (!application_id) return res.status(400).json({ error: "application_id is required" });

  const { data: app } = await db
    .from("job_applications")
    .select("id, job_id, candidate_id, match_score, match_summary, match_raw_response, interview_questions, interview_questions_at")
    .eq("id", application_id)
    .maybeSingle();

  if (!app) return res.status(404).json({ error: "Application not found" });

  const { data: job } = await db
    .from("jobs")
    .select("id, title, jd_raw_text, description, client_id, clients(id, organization_id)")
    .eq("id", app.job_id)
    .maybeSingle();

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

  // A guide already exists and nobody asked for a fresh one — serve it free.
  // Credits should only ever be spent on an actual Groq call.
  if (!regenerate && app.interview_questions?.questions?.length) {
    return res.status(200).json({
      ...app.interview_questions,
      generated_at: app.interview_questions_at,
      cached: true,
      credits_used: 0,
    });
  }

  const { data: cand } = await db
    .from("candidates")
    .select("id, full_name, name, resume_text, resume_raw_text")
    .eq("id", app.candidate_id)
    .maybeSingle();

  const candidateName = cand?.full_name || cand?.name || "the candidate";
  const resume = (cand?.resume_text || cand?.resume_raw_text || "").trim();
  if (!resume) {
    return res.status(400).json({ error: "This candidate has no resume text — upload or paste a resume first." });
  }

  const jd = (job.jd_raw_text || job.description || "").trim();
  if (!jd) {
    return res.status(400).json({ error: "This job has no JD text to build questions from." });
  }

  const { data: org } = await db
    .from("organizations")
    .select("id, credits_balance, credit_overage_mode")
    .eq("id", orgId)
    .maybeSingle();

  if (org?.credit_overage_mode === "hard_stop" && (org?.credits_balance ?? 0) <= 0) {
    return res.status(402).json({ error: "Out of credits. Top up to generate interview questions." });
  }

  // Feed the screening verdict back in — the gaps it found are exactly what the
  // interview should pressure-test.
  const screening = [];
  if (app.match_score != null) screening.push(`Match score: ${app.match_score}/100`);
  if (app.match_summary) screening.push(`Assessment: ${app.match_summary}`);
  const strengths = app.match_raw_response?.strengths;
  const gaps = app.match_raw_response?.gaps;
  if (Array.isArray(strengths) && strengths.length) screening.push(`Apparent strengths: ${strengths.join(", ")}`);
  if (Array.isArray(gaps) && gaps.length) screening.push(`Apparent gaps: ${gaps.join(", ")}`);

  const prompt = `You are an expert interviewer preparing a hiring manager to interview a specific candidate for a specific role.

Write 8 interview questions that could ONLY have been written for THIS candidate. Every question must be anchored in something concrete from their resume — a named employer, project, tool, transition, or time gap. Reject anything you could ask a stranger ("What is your greatest weakness?", "Tell me about yourself", "Where do you see yourself in five years?").

Cover this mix:
- 3 "Experience deep-dive" — dig into specific things they claim to have built or led.
- 2 "Skill verification" — probe a skill the JD requires and their resume asserts, deep enough that bluffing shows.
- 2 "Gap probe" — address where the resume falls short of the JD, or an unexplained gap/short stint. Ask fairly and neutrally, not as a trap.
- 1 "Motivation" — why this role, given their actual trajectory.

JOB TITLE: ${job.title}

JOB DESCRIPTION:
${jd.slice(0, 5000)}

CANDIDATE: ${candidateName}

RESUME:
${resume.slice(0, 6000)}

${screening.length ? `PRIOR SCREENING RESULT:\n${screening.join("\n")}` : ""}

Respond ONLY with minified JSON, no markdown fences, in this exact shape:
{"focus_areas":["<3-5 short phrases naming what this interview must establish>"],"questions":[{"category":"Experience deep-dive|Skill verification|Gap probe|Motivation","question":"<the question, asked directly to the candidate>","why":"<one sentence: what this reveals about THIS candidate>","strong_answer":"<one sentence: what a strong answer contains>","follow_up":"<one short follow-up to ask if the answer is thin>"}]}`;

  let parsed;
  const groqStart = Date.now();
  try {
    const groqResp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.4,
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!groqResp.ok) {
      return res.status(502).json({ error: "Groq API error — try again in a moment." });
    }

    const groqData = await groqResp.json();
    const raw = (groqData.choices?.[0]?.message?.content || "").replace(/```json|```/g, "").trim();

    logGroqGeneration({
      name: "interview-questions",
      model: GROQ_MODEL,
      input: prompt,
      output: raw,
      usage: groqData.usage,
      startTime: groqStart,
      endTime: Date.now(),
      userId: user.id,
      metadata: { org_id: orgId, job_id: job.id, application_id: app.id, candidate_id: app.candidate_id },
      modelParameters: { temperature: 0.4, max_tokens: 2000 },
    });

    parsed = JSON.parse(raw);
  } catch (err) {
    return res.status(502).json({ error: "Could not read the model's response — try again." });
  }

  const { questions, focus_areas } = normalizeQuestions(parsed);
  if (!questions.length) {
    return res.status(502).json({ error: "The model returned no usable questions — try again." });
  }

  const payload = {
    questions,
    focus_areas,
    generated_for: { job_title: job.title, candidate_name: candidateName },
  };
  const generatedAt = new Date().toISOString();

  const { error: saveErr } = await db.from("job_applications").update({
    interview_questions: payload,
    interview_questions_at: generatedAt,
    updated_at: generatedAt,
  }).eq("id", app.id);

  if (saveErr) {
    return res.status(500).json({ error: "Generated the questions but could not save them: " + saveErr.message });
  }

  // Charge only after the guide is safely stored.
  const creditsRemaining = (org?.credits_balance ?? 0) - 1;
  await db.from("organizations").update({ credits_balance: creditsRemaining }).eq("id", orgId);
  await db.from("credit_ledger").insert({
    organization_id: orgId,
    action_type: "interview_questions",
    credits_delta: -1,
    reference_id: app.id,
  });

  return res.status(200).json({
    ...payload,
    generated_at: generatedAt,
    cached: false,
    credits_used: 1,
    credits_remaining: creditsRemaining,
  });
}
