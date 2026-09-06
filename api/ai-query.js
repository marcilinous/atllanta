import { supabaseAsUser, SUPABASE_URL } from "../lib/supabaseServer.js";
import { logGroqGeneration } from "../lib/langfuse.js";

const GROQ_MODEL = "openai/gpt-oss-120b";

// Typed registry of datasets the assistant may read. This is the security
// boundary for the AI data path, in two layers:
//   1. The query always runs through the caller's RLS (supabaseAsUser), so
//      results are limited to what that user may see — a member gets their own
//      rows, a manager their team's, an admin the org's. RLS is the authority,
//      never the model.
//   2. The model may only name a dataset KEY here (not an arbitrary table), and
//      each dataset fixes its selected columns and declares each filter's
//      column AND allowed values/type. A filter whose column isn't declared, or
//      whose value fails its type, is dropped before the query runs — so a
//      hallucinated or hostile filter can't reach the database.
//
// Filter spec per column: { enum: [...] } (value must match exactly),
// { type: "uuid" | "date" } (format-checked), or { type: "text" } (trimmed,
// length-capped). Nothing else is accepted.
const S = {                              // shared enum sets
  memberRole: ["owner", "admin", "manager", "member"],
};
const DATASETS = {
  employees: {
    table: "users", select: "full_name,email,designation,status,role",
    filters: { status: { enum: ["active", "on_notice", "exited"] }, role: { enum: S.memberRole }, department_id: { type: "uuid" } },
  },
  attendance: {
    table: "attendance", select: "user_id,date,status,total_hours",
    filters: { status: { enum: ["present", "absent", "late", "on_leave", "holiday", "weekly_off"] }, date: { type: "date" }, user_id: { type: "uuid" } },
  },
  leave_requests: {
    table: "leave_requests", select: "user_id,start_date,end_date,days,status",
    filters: { status: { enum: ["pending", "approved", "rejected", "cancelled"] }, user_id: { type: "uuid" } },
  },
  jobs: {
    table: "jobs", select: "title,status,location,employment_type",
    filters: { status: { enum: ["draft", "open", "on_hold", "closed"] }, employment_type: { type: "text" } },
  },
  candidates: {
    table: "candidates", select: "full_name,email,source",
    filters: { source: { type: "text" } },
  },
  interviews: {
    table: "interviews", select: "round_name,scheduled_at,status,rating",
    filters: { status: { enum: ["scheduled", "completed", "cancelled", "no_show"] } },
  },
  accounts: {
    table: "crm_accounts", select: "name,industry,website,phone",
    filters: { industry: { type: "text" } },
  },
  contacts: {
    table: "crm_contacts", select: "first_name,last_name,email,title",
    filters: { account_id: { type: "uuid" } },
  },
  leads: {
    table: "crm_leads", select: "first_name,last_name,company,status,rating",
    filters: { status: { enum: ["new", "working", "qualified", "unqualified", "converted"] }, rating: { enum: ["hot", "warm", "cold"] }, source: { type: "text" } },
  },
  opportunities: {
    table: "crm_opportunities", select: "name,amount,status,close_date,probability",
    filters: { status: { enum: ["open", "won", "lost"] }, source: { type: "text" } },
  },
  expenses: {
    table: "expenses", select: "title,amount,status,expense_date",
    filters: { status: { enum: ["pending", "approved", "rejected", "reimbursed"] } },
  },
  tickets: {
    table: "helpdesk_tickets", select: "subject,status,priority",
    filters: { status: { enum: ["open", "in_progress", "resolved", "closed"] }, priority: { enum: ["Low", "Medium", "High", "Urgent"] } },
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Validate one model-proposed filter against its declared spec. Returns the
// cleaned value to apply, or null to drop it.
function cleanFilterValue(fspec, value) {
  if (fspec == null || value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (fspec.enum) return fspec.enum.includes(v) ? v : null;
  if (fspec.type === "uuid") return UUID_RE.test(v) ? v : null;
  if (fspec.type === "date") return DATE_RE.test(v) ? v : null;
  if (fspec.type === "text") return v.length <= 100 ? v : v.slice(0, 100);
  return null;
}

async function getUserFromToken(token) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: process.env.SUPABASE_ANON_KEY || "" },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function callGroq(key, messages, maxTokens = 700, trace = {}) {
  const startTime = Date.now();
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: GROQ_MODEL, messages, temperature: 0.2, max_tokens: maxTokens }),
  });
  if (!resp.ok) throw new Error("Groq API error: " + (await resp.text()));
  const result = await resp.json();
  const output = result.choices?.[0]?.message?.content || "";
  logGroqGeneration({
    name: trace.name || "ai-query",
    model: GROQ_MODEL,
    input: messages,
    output,
    usage: result.usage,
    startTime,
    endTime: Date.now(),
    userId: trace.userId,
    metadata: trace.metadata,
    modelParameters: { temperature: 0.2, max_tokens: maxTokens },
  });
  return output;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user?.id) return res.status(401).json({ error: "Invalid token" });

  const { query, mode, catalog } = req.body || {};
  if (!query) return res.status(400).json({ error: "query is required" });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: "GROQ_API_KEY not configured" });

  // Analytics NL→spec: turn a plain-English question into a builder spec against
  // the semantic model the client sent. We never touch data here — the browser
  // compiles the returned spec and runs it through the RLS-safe analytics RPC —
  // so this branch only needs the LLM (whose key stays server-side).
  if (mode === "analytics") {
    return handleAnalyticsSpec({ res, groqKey, query, catalog, userId: user.id });
  }

  // RLS-scoped client — the whole point: the AI can only see what the user can.
  const sb = supabaseAsUser(token);

  const { data: membership } = await sb
    .from("memberships")
    .select("role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const role = membership?.role || "member";
  const today = new Date().toISOString().split("T")[0];

  const planPrompt = `You are Atllanta AI, an assistant over a Business OS (HR + CRM).
Today is ${today}. The user's role is ${role}. Results are automatically restricted
to what this user may see, so never worry about permissions — just pick the data.

To answer a data question, reply with ONLY a JSON object:
{"dataset":"<name>","filters":{"column":"value"}}

Datasets and their filterable columns:
- employees: status(active|on_notice|exited), role, department_id
- attendance: status(present|absent|late|on_leave|holiday|weekly_off), date(YYYY-MM-DD), user_id
- leave_requests: status(pending|approved|rejected|cancelled), user_id
- jobs: status(draft|open|on_hold|closed), employment_type
- candidates: source
- interviews: status(scheduled|completed|cancelled|no_show)
- accounts: industry
- contacts: account_id
- leads: status(new|working|qualified|unqualified|converted), rating(hot|warm|cold), source
- opportunities: status(open|won|lost), source
- expenses: status(pending|approved|rejected|reimbursed)
- tickets: status(open|in_progress|resolved|closed), priority(Low|Medium|High|Urgent)

Use "date":"${today}" for "today". Omit filters you don't need.
If the question isn't about this data, reply with a short plain-text answer instead of JSON.`;

  let plan;
  try {
    plan = await callGroq(groqKey, [
      { role: "system", content: planPrompt },
      { role: "user", content: query },
    ], 300, { name: "ai-query.plan", userId: user.id, metadata: { role, query } });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  let intent = null;
  try {
    const m = plan.match(/\{[\s\S]*\}/);
    if (m) intent = JSON.parse(m[0]);
  } catch {}

  // Not a data query → return the model's plain-text answer.
  if (!intent?.dataset || !DATASETS[intent.dataset]) {
    const text = plan.replace(/\{[\s\S]*\}/, "").trim();
    return res.status(200).json({ response: text || "I couldn't map that to your data. Try asking about employees, attendance, leave, deals, leads, expenses, or tickets." });
  }

  const spec = DATASETS[intent.dataset];
  let q = sb.from(spec.table).select(spec.select);
  // Apply only declared filters whose value passes its declared type/enum —
  // an undeclared column or an off-spec value is dropped, never sent to the DB.
  const filters = intent.filters && typeof intent.filters === "object" ? intent.filters : {};
  for (const [k, rawV] of Object.entries(filters)) {
    const fspec = spec.filters[k];
    const clean = cleanFilterValue(fspec, rawV);
    if (clean !== null) q = q.eq(k, clean);
  }
  q = q.limit(50);

  const { data, error } = await q;
  if (error) {
    return res.status(200).json({ response: `I couldn't read the ${intent.dataset} data (${error.message}).` });
  }

  // Summarise the (permission-scoped) rows into a natural answer.
  let answer;
  try {
    const sample = (data || []).slice(0, 20);
    answer = await callGroq(groqKey, [
      { role: "system", content: `You are Atllanta AI. Answer the user's question in 1-3 short sentences using ONLY the JSON rows provided (already filtered to what the user may see). State counts where relevant. Do not invent data. If rows are empty, say nothing matched.` },
      { role: "user", content: `Question: ${query}\n\nRows (${(data || []).length} total, up to 20 shown):\n${JSON.stringify(sample)}` },
    ], 400, { name: "ai-query.answer", userId: user.id, metadata: { role, dataset: intent.dataset, rows: (data || []).length } });
  } catch {
    answer = `Found ${(data || []).length} ${intent.dataset.replace(/_/g, " ")} record${(data || []).length === 1 ? "" : "s"}.`;
  }

  return res.status(200).json({ response: answer, data });
}

// ---- analytics NL → builder spec -------------------------------------------
// `catalog` is a compact description of the models the caller may use (sent by
// the browser from js/analytics/models.js). We ask the LLM to emit a builder
// spec as JSON; the browser then validates it against the real catalogue and
// compiles it to RLS-safe SQL, so a hallucinated field simply gets dropped.
async function handleAnalyticsSpec({ res, groqKey, query, catalog, userId }) {
  if (!Array.isArray(catalog) || !catalog.length) {
    return res.status(400).json({ error: "catalog is required for analytics mode" });
  }
  const today = new Date().toISOString().split("T")[0];
  const catalogText = catalog.map((m) => {
    const dims = (m.dimensions || []).map((d) => `${d.name}${d.temporal ? " (date)" : ""}`).join(", ");
    const meas = (m.measures || []).join(", ");
    const named = (m.namedMeasures || []).map((n) => `m:${n}`).join(", ");
    const filt = (m.filters || []).join(", ");
    return `- model "${m.key}" (${m.label}):\n    dimensions: ${dims || "—"}\n    measures: count, then <agg> of a numeric field where agg ∈ [count_distinct,sum,avg,min,max]: ${meas || "—"}\n    named measures: ${named || "—"}\n    filterable: ${filt || "—"}`;
  }).join("\n");

  const sys = `You are Atllanta AI, a data analyst for a Business OS. Today is ${today}.
Turn the user's question into ONE JSON object describing a chart query. Use ONLY models and field names from this catalogue — never invent names:

${catalogText}

Reply with ONLY this JSON (no prose):
{"model":"<key>","dimensions":[{"field":"<name>","granularity":"month"}],"measures":[{"agg":"count"}|{"agg":"sum","field":"<name>"}|{"agg":"m:<namedKey>"}],"filters":[{"field":"<name>","op":"<op>","value":"<v>"}],"sort":{"by":"<columnKey>","dir":"desc"},"limit":50,"viz":"bar","explanation":"<one short sentence>"}

Rules:
- granularity only for date dimensions, one of: day, week, month, quarter, year.
- op is one of: eq, neq, gt, gte, lt, lte, contains, in, is_null, not_null, is_true, is_false, last_n_days (value = number of days).
- viz one of: number, table, bar, row, line, pie. Prefer line for trends over time, pie for share of a total, number for a single value, bar/row otherwise.
- Keep it minimal; omit filters/sort if not needed. Output valid JSON only.`;

  let raw;
  try {
    raw = await callGroq(groqKey, [
      { role: "system", content: sys },
      { role: "user", content: String(query).slice(0, 500) },
    ], 500, { name: "ai-query.analytics", userId, metadata: { query } });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  let spec = null;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) spec = JSON.parse(m[0]);
  } catch {}
  if (!spec || !spec.model) {
    return res.status(200).json({ error: "Couldn't turn that into a query. Try naming a metric and a grouping, e.g. \"deals by stage\" or \"headcount by department\"." });
  }
  return res.status(200).json({ spec });
}
