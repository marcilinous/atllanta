// Google OAuth flow for per-user Calendar + Meet integration
//
// GET  ?action=url      → returns OAuth consent URL
// GET  ?action=callback → exchanges code for tokens, redirects to settings
// GET  ?action=status   → returns connection status
// POST { action: "disconnect" } → removes stored tokens
//
// The OAuth `state` param is an HMAC-signed, expiring payload bound to an
// HttpOnly `atllanta_goauth` cookie set on the ?action=url response. The
// callback verifies both the signature and that the cookie nonce matches
// before trusting the state, to prevent OAuth CSRF (state hijacking).

import crypto from "node:crypto";
import { supabaseAdmin, SUPABASE_URL } from "../../lib/supabaseServer.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || `${process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "http://localhost:3000"}/api/google-auth?action=callback`;
  return { clientId, clientSecret, redirectUri };
}

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

function deriveStateKey(clientSecret) {
  return crypto.createHmac("sha256", clientSecret).update("atllanta-google-oauth-state-v1").digest();
}

export function signState({ uid, nonce, exp }, key) {
  const payload = JSON.stringify({ uid, nonce, exp });
  const part1 = Buffer.from(payload).toString("base64url");
  const part2 = crypto.createHmac("sha256", key).update(part1).digest("base64url");
  return `${part1}.${part2}`;
}

export function verifyState(state, key) {
  if (typeof state !== "string") return null;
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [part1, part2] = parts;
  if (!part1 || !part2) return null;

  const expectedSig = crypto.createHmac("sha256", key).update(part1).digest("base64url");
  const bufPart2 = Buffer.from(part2);
  const bufExpected = Buffer.from(expectedSig);
  if (bufPart2.length !== bufExpected.length) return null;
  if (!crypto.timingSafeEqual(bufPart2, bufExpected)) return null;

  let payloadObj;
  try {
    const json = Buffer.from(part1, "base64url").toString();
    payloadObj = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof payloadObj !== "object" || payloadObj === null) return null;
  const { uid, nonce, exp } = payloadObj;
  if (typeof uid !== "string" || typeof nonce !== "string" || typeof exp !== "number") return null;
  if (exp < Date.now()) return null;
  return { uid, nonce, exp };
}

export default async function handler(req, res) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" });
  }

  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: "Google OAuth not configured on this deployment" });
  }

  const action = req.query?.action || req.body?.action;

  if (req.method === "GET" && action === "url") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const user = await getUserFromToken(token);
    if (!user?.id) return res.status(401).json({ error: "Invalid session" });

    const nonce = crypto.randomBytes(32).toString("base64url");
    const exp = Date.now() + 10 * 60 * 1000;
    const key = deriveStateKey(clientSecret);
    const state = signState({ uid: user.id, nonce, exp }, key);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state,
    });

    let cookieString = `atllanta_goauth=${nonce}; Path=/api/google-auth; HttpOnly; SameSite=Lax; Max-Age=600`;
    if (process.env.VERCEL_URL) cookieString += "; Secure";
    res.setHeader("Set-Cookie", cookieString);

    return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }

  if (req.method === "GET" && action === "callback") {
    const { code, state: token } = req.query;
    if (!code || !token) return res.status(400).send("Missing code or state");

    const cookieHeader = req.headers.cookie;
    const cookies = {};
    if (cookieHeader) {
      cookieHeader.split(";").forEach((pair) => {
        const [name, ...rest] = pair.trim().split("=");
        cookies[name] = rest.join("=");
      });
    }
    const cookieNonce = cookies["atllanta_goauth"];

    const key = deriveStateKey(clientSecret);
    const payload = verifyState(token, key);

    function cookiesMatch(a, b) {
      if (!a || !b) return false;
      const ba = Buffer.from(a);
      const bb = Buffer.from(b);
      if (ba.length !== bb.length) return false;
      return crypto.timingSafeEqual(ba, bb);
    }

    const clearCookie = "atllanta_goauth=; Path=/api/google-auth; HttpOnly; SameSite=Lax; Max-Age=0";

    if (!payload || !cookieNonce || !cookiesMatch(cookieNonce, payload.nonce)) {
      res.setHeader("Set-Cookie", clearCookie);
      return res.status(400).send("This Google connection link has expired or was not started from this browser. Start again from Settings → Integrations.");
    }

    // Successful verification – clear the one-time cookie and continue
    res.setHeader("Set-Cookie", clearCookie);

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenResp.json();
    if (!tokenResp.ok) return res.status(500).json({ error: tokens.error_description || "Token exchange failed" });

    const db = supabaseAdmin();
    await db.from("user_google_tokens").upsert({
      user_id: payload.uid,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      scopes: SCOPES.join(" "),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000";
    return res.redirect(302, `${baseUrl}/#/settings/integrations?google=connected`);
  }

  if (req.method === "GET" && action === "status") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const user = await getUserFromToken(token);
    if (!user?.id) return res.status(401).json({ error: "Invalid session" });

    const db = supabaseAdmin();
    const { data } = await db.from("user_google_tokens").select("updated_at").eq("user_id", user.id).single();
    return res.json({ connected: !!data, connected_at: data?.updated_at || null });
  }

  if (req.method === "POST" && action === "disconnect") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Missing auth token" });

    const user = await getUserFromToken(token);
    if (!user?.id) return res.status(401).json({ error: "Invalid session" });

    const db = supabaseAdmin();
    await db.from("user_google_tokens").delete().eq("user_id", user.id);
    return res.json({ disconnected: true });
  }

  return res.status(400).json({ error: "Invalid action" });
}
