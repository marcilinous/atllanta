// Public lead-capture endpoint for the marketing site.
//
// Anonymous visitors can't insert into atllanta_leads (RLS restricts it to
// super_admins), so this endpoint writes with the service role. It is
// deliberately narrow: it only ever creates an inbound lead in 'new' stage,
// and ignores any client-supplied stage/value/owner. Basic anti-abuse via a
// honeypot field + validation + length caps.
import { supabaseAdmin } from "../lib/supabaseServer.js";

const cap = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  // Liveness probe for uptime monitors: GET /api/lead → 200. Confirms the
  // serverless layer is deploying and running. Kept DB-free so this
  // unauthenticated path can't be used to hammer the database.
  if (req.method === "GET") {
    return res.status(200).json({ status: "ok", ts: Date.now() });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const body = req.body || {};

  // Honeypot: real users never fill this hidden field. Pretend success.
  if (typeof body.website === "string" && body.website.trim() !== "") {
    return res.status(200).json({ ok: true });
  }

  const company = cap(body.company, 200);
  const email = cap(body.email, 200);
  const contact_name = cap(body.contact_name, 120);
  const phone = cap(body.phone, 40);
  const message = cap(body.message, 2000);

  if (!company) return res.status(400).json({ error: "Company is required" });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "A valid email is required" });

  const notes = [
    "Inbound from landing page.",
    message ? `Message: ${message}` : "",
  ].filter(Boolean).join(" ");

  try {
    const sb = supabaseAdmin();
    const { error } = await sb.from("atllanta_leads").insert({
      company,
      contact_name: contact_name || null,
      email,
      phone: phone || null,
      source: "inbound",
      stage: "new",
      notes,
    });
    if (error) {
      console.error("lead insert failed:", error.message);
      return res.status(500).json({ error: "Could not submit. Please email us." });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("lead endpoint error:", e.message);
    return res.status(500).json({ error: "Could not submit. Please email us." });
  }
}
