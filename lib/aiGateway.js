// The only path to Groq. Every AI call: identify the caller, run the bot check
// and the quota check, call Groq, record the tokens used, trace to Langfuse.
// Database functions: ai_bot_check, ai_quota_check, ai_record_usage
// (migration 20260917155318; spec docs/superpowers/specs/2026-09-17-ai-usage-quotas-design.md §5).

import crypto from "node:crypto";
import { supabaseAdmin, SUPABASE_URL } from "./supabaseServer.js";
import { logGroqGeneration } from "./langfuse.js";

export const GROQ_MODEL = "openai/gpt-oss-120b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export const QUOTA_MESSAGES = {
  user_day_exhausted: "You've used today's AI limit. It resets at midnight.",
  org_month_exhausted: "Your organisation's monthly AI quota is used up. It resets on the 1st.",
  paused_bot_check: "AI is paused for 10 minutes because of unusual activity. Your admin has been notified.",
};

const UNAVAILABLE = { error: "AI usage check is unavailable — please try again shortly" };

// Who is calling: a valid session, a user row with an organisation, not exited.
export async function resolveCaller(token) {
  if (!token) return { ok: false, status: 401, error: "Missing auth token" };

  let user = null;
  try {
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_SERVICE_ROLE_KEY },
    });
    if (resp.ok) user = await resp.json();
  } catch {
    user = null;
  }
  if (!user?.id) return { ok: false, status: 401, error: "Invalid or expired session — please log in again" };

  const db = supabaseAdmin();
  const { data: profile, error } = await db
    .from("users")
    .select("id, org_id, role, status")
    .eq("id", user.id)
    .maybeSingle();
  if (error) return { ok: false, status: 503, error: "Could not load your account — please try again" };
  if (!profile?.org_id) return { ok: false, status: 403, error: "Your account is not linked to an organisation" };
  if (profile.status === "exited") return { ok: false, status: 403, error: "Your account is no longer active" };

  return { ok: true, userId: user.id, orgId: profile.org_id, role: profile.role, db };
}

async function record(db, { orgId, userId, feature, outcome, blockReason = null, prompt = 0, completion = 0, requestHash = null }) {
  const { error } = await db.rpc("ai_record_usage", {
    p_org_id: orgId,
    p_user_id: userId,
    p_feature: feature,
    p_model: GROQ_MODEL,
    p_prompt: prompt,
    p_completion: completion,
    p_outcome: outcome,
    p_block_reason: blockReason,
    p_request_hash: requestHash,
  });
  if (error) console.error("ai_record_usage failed:", error.message);
}

const firstRow = (data) => (Array.isArray(data) ? data[0] : data) || null;

export async function runAI({ caller, feature, messages, maxTokens, temperature = 0.2, metadata = {} }) {
  const { db, orgId, userId } = caller;
  const requestHash = crypto.createHash("sha256").update(feature + JSON.stringify(messages)).digest("hex");

  // 1. Bot check (fails closed).
  const bot = await db.rpc("ai_bot_check", { p_org_id: orgId, p_user_id: userId, p_feature: feature, p_request_hash: requestHash });
  if (bot.error) return { ok: false, status: 503, body: UNAVAILABLE };
  const botRow = firstRow(bot.data);
  if (botRow?.flagged) {
    await record(db, { orgId, userId, feature, outcome: "blocked", blockReason: "paused_bot_check", requestHash });
    return {
      ok: false,
      status: 429,
      body: { error: QUOTA_MESSAGES.paused_bot_check, reason: "paused_bot_check", quota: { paused_until: botRow.paused_until } },
    };
  }

  // 2. Quota check (fails closed).
  const q = await db.rpc("ai_quota_check", { p_org_id: orgId, p_user_id: userId });
  const quota = q.error ? null : firstRow(q.data);
  if (!quota) return { ok: false, status: 503, body: UNAVAILABLE };
  if (quota.allowed !== true) {
    await record(db, { orgId, userId, feature, outcome: "blocked", blockReason: quota.reason, requestHash });
    return {
      ok: false,
      status: 429,
      body: {
        error: QUOTA_MESSAGES[quota.reason] || "AI is not available right now.",
        reason: quota.reason,
        quota: {
          user_used: quota.user_used, user_limit: quota.user_limit,
          org_used: quota.org_used, org_quota: quota.org_quota,
          resets_day: quota.resets_day, resets_month: quota.resets_month,
          paused_until: quota.paused_until,
        },
      },
    };
  }

  // 3. Groq.
  const modelParameters = { temperature, max_tokens: maxTokens, reasoning_effort: "low" };
  const startTime = Date.now();
  let resp = null;
  try {
    resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({ model: GROQ_MODEL, messages, ...modelParameters }),
    });
  } catch {
    resp = null;
  }

  // Shared failure path: record an error row (no tokens, no request hash —
  // failed calls must not count as repeated requests), trace to Langfuse with
  // the detail, log the detail server-side, but never leak Groq's raw error
  // text to the caller.
  const failGroq = async (detail) => {
    console.error("groq request failed:", detail);
    await record(db, { orgId, userId, feature, outcome: "error" });
    logGroqGeneration({
      name: feature, model: GROQ_MODEL, input: messages, output: null, startTime, endTime: Date.now(),
      userId, metadata: { org_id: orgId, feature, ...metadata }, modelParameters, level: "ERROR", statusMessage: detail,
    });
    return { ok: false, status: 502, body: { error: "AI request failed — please try again" } };
  };

  if (!resp || !resp.ok) {
    const detail = resp ? (await resp.text().catch(() => "")).slice(0, 500) : "network error";
    return failGroq(detail);
  }

  let data;
  try {
    data = await resp.json();
  } catch (e) {
    return failGroq("invalid JSON response from Groq: " + (e?.message || e));
  }
  const text = data.choices?.[0]?.message?.content || "";
  const prompt = data.usage?.prompt_tokens || 0;
  const completion = data.usage?.completion_tokens || 0;

  // 4. Record, 5. trace (not awaited).
  await record(db, { orgId, userId, feature, outcome: "ok", prompt, completion, requestHash });
  logGroqGeneration({
    name: feature, model: GROQ_MODEL, input: messages, output: text, usage: data.usage, startTime, endTime: Date.now(),
    userId, metadata: { org_id: orgId, feature, ...metadata }, modelParameters,
  });

  return { ok: true, text, usage: { prompt, completion, total: prompt + completion } };
}
