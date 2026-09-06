// Shared rate limiter for serverless endpoints. Backed by the Postgres
// `rate_limit_hit` RPC (atomic fixed-window counter) since Vercel functions
// share no memory. Call it early in a handler, after you know the identity to
// key on; on a block, return 429 with `tooMany`.
//
// It fails OPEN on any limiter error — a counter outage must never take the
// app down. This is defense-in-depth against abuse, not the security boundary
// (RLS is that).

// Best-effort client IP from the Vercel/proxy headers.
export function clientIp(req) {
  const xff = req.headers["x-forwarded-for"] || "";
  const first = String(xff).split(",")[0].trim();
  return first || req.headers["x-real-ip"] || "unknown";
}

// db: a service-role Supabase client. key: a stable string like
// "match:org:<id>" or "schedule:ip:<ip>". Returns { allowed, remaining,
// retryAfter }.
export async function rateLimit(db, { key, limit, windowSec = 60 }) {
  try {
    const { data, error } = await db.rpc("rate_limit_hit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSec,
    });
    if (error) return { allowed: true, remaining: limit, retryAfter: 0 };
    const r = (data && data[0]) || {};
    return {
      allowed: r.allowed !== false,
      remaining: r.remaining ?? 0,
      retryAfter: r.retry_after ?? 0,
    };
  } catch {
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}

// Send a 429 with a Retry-After header. Returns the response for easy `return`.
export function tooMany(res, retryAfter) {
  res.setHeader("Retry-After", String(retryAfter || 60));
  return res.status(429).json({ error: "Too many requests — please slow down and try again shortly." });
}
