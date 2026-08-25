// Langfuse LLM observability — traces the server-side Groq calls (prompt,
// output, model, latency, token usage) so we can see cost and quality per
// endpoint and per org.
//
// Uses Langfuse's public REST ingestion API directly via fetch — no SDK, no
// npm package, consistent with the rest of the stack. It is a NO-OP until the
// keys are set in the environment, so this is safe to ship before Langfuse is
// configured (same pattern as the Vercel Analytics tags).
//
// Required env (add in Vercel → Settings → Environment Variables):
//   LANGFUSE_PUBLIC_KEY   pk-lf-...
//   LANGFUSE_SECRET_KEY   sk-lf-...
//   LANGFUSE_HOST         optional; defaults to https://cloud.langfuse.com
//                         (use https://cloud.langfuse.com for US, or the EU
//                          host if you created the project in the EU region)
//
// Every export is wrapped so a Langfuse outage can never slow down or break a
// user-facing request: failures are swallowed and the call is bounded by a
// short timeout.

const HOST = (process.env.LANGFUSE_HOST || "https://cloud.langfuse.com").replace(/\/$/, "");
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;
const TIMEOUT_MS = 2500;

export function langfuseEnabled() {
  return Boolean(PUBLIC_KEY && SECRET_KEY);
}

const iso = (t) => (t instanceof Date ? t.toISOString() : typeof t === "number" ? new Date(t).toISOString() : t || new Date().toISOString());

// Map Groq's OpenAI-style usage block to Langfuse's usage shape.
function mapUsage(usage) {
  if (!usage) return undefined;
  const input = usage.prompt_tokens ?? usage.input;
  const output = usage.completion_tokens ?? usage.output;
  const total = usage.total_tokens ?? usage.total ?? ((input || 0) + (output || 0));
  return { input, output, total, unit: "TOKENS" };
}

/**
 * Record one LLM generation (an input→output call) as a Langfuse trace.
 * Fire-and-forget-safe: always resolves, never throws.
 *
 * @param {object} o
 * @param {string} o.name         short label, e.g. "ai-query", "match", "screen-job"
 * @param {string} o.model        the Groq model id
 * @param {*}      o.input        messages array or prompt string sent to the model
 * @param {*}      o.output       the model's text output
 * @param {object} [o.usage]      Groq usage block { prompt_tokens, completion_tokens, total_tokens }
 * @param {Date|number|string} [o.startTime]
 * @param {Date|number|string} [o.endTime]
 * @param {string} [o.userId]     the acting user's id (for per-user filtering)
 * @param {object} [o.metadata]   extra context, e.g. { org_id, job_id }
 * @param {object} [o.modelParameters] e.g. { temperature, max_tokens }
 * @param {"DEFAULT"|"DEBUG"|"WARNING"|"ERROR"} [o.level]
 * @param {string} [o.statusMessage]
 */
export async function logGroqGeneration(o = {}) {
  if (!langfuseEnabled()) return;
  try {
    const now = new Date().toISOString();
    const traceId = crypto.randomUUID();
    const genId = crypto.randomUUID();
    const startTime = iso(o.startTime);
    const endTime = iso(o.endTime);

    const batch = [
      {
        id: crypto.randomUUID(),
        type: "trace-create",
        timestamp: now,
        body: {
          id: traceId,
          name: o.name || "groq",
          timestamp: startTime,
          userId: o.userId,
          metadata: o.metadata,
          tags: ["groq", o.name].filter(Boolean),
        },
      },
      {
        id: crypto.randomUUID(),
        type: "generation-create",
        timestamp: now,
        body: {
          id: genId,
          traceId,
          name: o.name || "groq",
          startTime,
          endTime,
          model: o.model,
          modelParameters: o.modelParameters,
          input: o.input,
          output: o.output,
          usage: mapUsage(o.usage),
          metadata: o.metadata,
          level: o.level || "DEFAULT",
          statusMessage: o.statusMessage,
        },
      },
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      await fetch(`${HOST}/api/public/ingestion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`${PUBLIC_KEY}:${SECRET_KEY}`).toString("base64")}`,
        },
        body: JSON.stringify({ batch }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    // Never let observability break the request.
    console.error("langfuse trace failed:", e?.message || e);
  }
}
