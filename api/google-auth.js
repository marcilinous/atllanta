// GET  /api/google-auth?action=url    — returns OAuth consent URL
// GET  /api/google-auth?action=callback&code=...  — exchanges code for tokens, stores them
// GET  /api/google-auth?action=status  — checks if user has connected Google
// POST /api/google-auth { action: "disconnect" } — removes stored tokens

import { google } from "googleapis";
import { supabaseAdmin, SUPABASE_URL } from "../lib/supabaseServer.js";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

function getOAuth2Client(origin) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${origin}/api/google-auth?action=callback`
  );
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

  const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
  const oauth2 = getOAuth2Client(origin);

  if (!oauth2) {
    return res.status(501).json({
      error: "Google OAuth not configured",
      setup: "Add GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Vercel env vars",
    });
  }

  const action = req.query?.action || req.body?.action;

  if (action === "url") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const user = await getUserFromToken(token);
    if (!user?.id) return res.status(401).json({ error: "Invalid session" });

    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
      state: token,
    });
    return res.json({ url });
  }

  if (action === "callback") {
    const { code, state } = req.query;
    if (!code) return res.status(400).send("Missing authorization code");

    const user = await getUserFromToken(state);
    if (!user?.id) return res.status(401).send("Invalid session — please try again from Settings");

    try {
      const { tokens } = await oauth2.getToken(code);
      oauth2.setCredentials(tokens);

      const people = google.oauth2({ version: "v2", auth: oauth2 });
      const { data: profile } = await people.userinfo.get();

      const db = supabaseAdmin();
      await db.from("user_google_tokens").upsert({
        user_id: user.id,
        google_email: profile.email,
        refresh_token: tokens.refresh_token,
        access_token: tokens.access_token,
        token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

      return res.redirect(302, `${origin}/?google=connected`);
    } catch (err) {
      return res.status(500).send("Failed to connect Google account: " + (err.message || err));
    }
  }

  if (action === "status") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const user = await getUserFromToken(token);
    if (!user?.id) return res.status(401).json({ error: "Invalid session" });

    const db = supabaseAdmin();
    const { data } = await db
      .from("user_google_tokens")
      .select("google_email, updated_at")
      .eq("user_id", user.id)
      .single();

    return res.json({ connected: !!data, google_email: data?.google_email || null });
  }

  if (req.method === "POST" && action === "disconnect") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const user = await getUserFromToken(token);
    if (!user?.id) return res.status(401).json({ error: "Invalid session" });

    const db = supabaseAdmin();
    await db.from("user_google_tokens").delete().eq("user_id", user.id);
    return res.json({ disconnected: true });
  }

  return res.status(400).json({ error: "Invalid action" });
}
