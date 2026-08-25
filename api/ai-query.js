import { supabaseAsUser, SUPABASE_URL } from "../lib/supabaseServer.js";
import { logGroqGeneration } from "../lib/langfuse.js";

const GROQ_MODEL = "llama-3.3-70b-versatile";

// Whitelist of datasets the assistant may read. The query always runs through
// the caller's RLS (supabaseAsUser), so results are automatically limited to
// what that user is allowed to see — a member gets only their own rows, a
// manager their team's, an admin the org's. The whitelist additionally stops
// the LLM from reaching arbitrary tables/columns.
const DATASETS = {
  employees:     { table: "users",              filters: ["status", "role", "department_id"], select: "full_name,email,designation,status,role" },
  attendance:    { table: "attendance",         filters: ["status", "date", "user_id"],       select: "user_id,date,status,total_hours" },
  leave_requests:{ table: "leave_requests",     filters: ["status", "user_id"],               select: "user_id,start_date,end_date,days,status" },
  jobs:          { table: "jobs",               filters: ["status", "employment_type"],       select: "title,status,location,employment_type" },
  candidates:    { table: "candidates",         filters: ["source"],                          select: "full_name,email,source" },
  interviews:    { table: "interviews",         filters: ["status"],                          select: "round_name,scheduled_at,status,rating" },
  accounts:      { table: "crm_accounts",       filters: ["industry"],                        select: "name,industry,website,phone" },
  contacts:      { table: "crm_contacts",       filters: ["account_id"],                      select: "first_name,last_name,email,title" },
  leads:         { table: "crm_leads",          filters: ["status", "rating", "source"],      select: "first_name,last_name,company,status,rating" },
  opportunities: { table: "crm_opportunities",  filters: ["status", "source"],                select: "name,amount,status,close_date,probability" },
  expenses:      { table: "expenses",           filters: ["status"],                          select: "title,amount,status,expense_date" },
  tickets:       { table: "helpdesk_tickets",   filters: ["status", "priority"],              select: "subject,status,priority" },
};

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
  await logGroqGeneration({
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

  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: "query is required" });

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return res.status(500).json({ error: "GROQ_API_KEY not configured" });

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
  for (const [k, v] of Object.entries(intent.filters || {})) {
    if (spec.filters.includes(k)) q = q.eq(k, v);
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
