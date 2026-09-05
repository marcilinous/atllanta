// Atllanta API gateway — a public Supabase Edge Function that turns a revocable
// org API key into RLS-scoped access to the REST surface (PostgREST).
//
// Flow per request:
//   1. Read the key from Authorization: Bearer atl_… (or X-API-Key).
//   2. SHA-256 it and look up an active row in api_keys (service role).
//   3. Enforce scope: GET needs 'read'; writes need 'write'.
//   4. Mint a short-lived JWT for the key's acting_user_id and forward the
//      request to PostgREST with it — so every table's RLS applies as that
//      user (org-scoped). Only the hash is ever stored; revoking a key
//      (active=false) blocks it on the very next request.
//
// Deploy as a PUBLIC function (no Supabase-JWT gate) — callers present the
// Atllanta key, not a Supabase JWT. Requires the APP_JWT_SECRET secret (the
// project's JWT secret) so minted tokens verify at PostgREST.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const JWT_SECRET = Deno.env.get("APP_JWT_SECRET") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "authorization,x-api-key,apikey,content-type,prefer,range,accept-profile,content-profile",
  "Access-Control-Expose-Headers": "content-range,content-profile",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const enc = new TextEncoder();

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function mintJwt(sub: string): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(enc.encode(JSON.stringify({ sub, role: "authenticated", aud: "authenticated", iat: now, exp: now + 60 })));
  const data = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return `${data}.${b64url(sig)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!JWT_SECRET) return json(503, { error: "Gateway not configured: APP_JWT_SECRET is not set" });

  // Extract the Atllanta key.
  const auth = req.headers.get("authorization") || "";
  const rawKey = req.headers.get("x-api-key") || (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "");
  if (!rawKey || !rawKey.startsWith("atl_")) return json(401, { error: "Missing or malformed API key" });

  // Validate against the store (service role; only the hash is compared).
  const keyHash = await sha256Hex(rawKey);
  const lookup = await fetch(
    `${SUPABASE_URL}/rest/v1/api_keys?key_hash=eq.${keyHash}&active=is.true&select=id,org_id,acting_user_id,scopes`,
    { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` } },
  );
  const rows = lookup.ok ? await lookup.json() : [];
  const keyRow = rows[0];
  if (!keyRow) return json(401, { error: "Invalid or revoked API key" });

  // Scope check.
  const scopes: string[] = keyRow.scopes || [];
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  if (isWrite && !scopes.includes("write")) return json(403, { error: "This key is read-only" });
  if (!isWrite && !scopes.includes("read") && !scopes.includes("write")) return json(403, { error: "This key has no read scope" });

  // Resolve the PostgREST resource path.
  const url = new URL(req.url);
  let path = url.pathname;
  const marker = "/api-gateway";
  const i = path.indexOf(marker);
  if (i >= 0) path = path.slice(i + marker.length);
  if (!path || path === "/") {
    return json(200, { service: "Atllanta API", usage: "GET/POST/PATCH/DELETE /api-gateway/<table>?<postgrest-query>", docs: "PostgREST syntax; scoped to your organization." });
  }

  // Forward to PostgREST as the key's acting user (RLS applies).
  const token = await mintJwt(keyRow.acting_user_id);
  const fwdHeaders: Record<string, string> = {
    apikey: ANON,
    Authorization: `Bearer ${token}`,
  };
  for (const h of ["content-type", "prefer", "range", "accept-profile", "content-profile"]) {
    const v = req.headers.get(h);
    if (v) fwdHeaders[h] = v;
  }
  const body = isWrite ? await req.arrayBuffer() : undefined;
  const resp = await fetch(`${SUPABASE_URL}/rest/v1${path}${url.search}`, { method: req.method, headers: fwdHeaders, body });

  // Best-effort last-used stamp.
  fetch(`${SUPABASE_URL}/rest/v1/api_keys?id=eq.${keyRow.id}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ last_used_at: new Date().toISOString() }),
  }).catch(() => {});

  const respHeaders = new Headers(CORS);
  for (const h of ["content-type", "content-range", "content-profile"]) {
    const v = resp.headers.get(h);
    if (v) respHeaders.set(h, v);
  }
  return new Response(resp.body, { status: resp.status, headers: respHeaders });
});
