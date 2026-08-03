// Google OAuth flow for per-user Calendar + Meet integration
//
// GET  ?action=url      → returns OAuth consent URL
// GET  ?action=callback → exchanges code for tokens, redirects to settings
// GET  ?action=status   → returns connection status
// POST { action: "disconnect" } → removes stored tokens

import { supabaseAdmin, SUPABASE_URL } from "../lib/supabaseServer.js";

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

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      state: token,
    });

    return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }

  if (req.method === "GET" && action === "callback") {
    const { code, state: token } = req.query;
    if (!code || !token) return res.status(400).send("Missing code or state");

    const user = await getUserFromToken(token);
    if (!user?.id) return res.status(401).send("Invalid session");

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
      user_id: user.id,
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
