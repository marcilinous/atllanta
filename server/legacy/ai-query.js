// Disabled until release v1.4.0 brings back the AI assistant through
// lib/aiGateway.js, reading data under the caller's row-level security.
// The assistant panel falls back to its built-in answers when this call fails.
export default async function handler(req, res) {
  return res.status(503).json({ error: "AI assistant is temporarily unavailable" });
}
