// GET  /api/schedule?token=<uuid>  — public: fetch job info + available slots
// POST /api/schedule { token, slot_id } — public: book a slot

import { supabaseAdmin } from "../lib/supabaseServer.js";

export default async function handler(req, res) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const db = supabaseAdmin();

  if (req.method === "GET") {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "token required" });

    const { data: app } = await db
      .from("applications")
      .select("id, job_id, candidate_id, stage, interview_at")
      .eq("schedule_token", token)
      .single();
    if (!app) return res.status(404).json({ error: "Invalid or expired link" });

    const [{ data: job }, { data: cand }] = await Promise.all([
      db.from("jobs").select("id, title, client_id").eq("id", app.job_id).single(),
      db.from("candidates").select("name").eq("id", app.candidate_id).single(),
    ]);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const { data: client } = await db
      .from("clients").select("organization_id, name").eq("id", job.client_id).single();

    const { data: org } = client
      ? await db.from("organizations").select("name").eq("id", client.organization_id).single()
      : { data: null };

    if (app.interview_at) {
      return res.json({
        booked: true,
        interview_at: app.interview_at,
        job_title: job.title,
        org_name: org?.name || client?.name || "",
        candidate_name: cand?.name || "",
      });
    }

    const { data: slots } = await db
      .from("interview_slots")
      .select("id, slot_start, slot_end")
      .eq("job_id", app.job_id)
      .is("booked_by", null)
      .gte("slot_start", new Date().toISOString())
      .order("slot_start");

    return res.json({
      booked: false,
      job_title: job.title,
      org_name: org?.name || client?.name || "",
      candidate_name: cand?.name || "",
      slots: slots || [],
    });
  }

  if (req.method === "POST") {
    const { token, slot_id } = req.body || {};
    if (!token || !slot_id) return res.status(400).json({ error: "token and slot_id required" });

    const { data: app } = await db
      .from("applications")
      .select("id, job_id, interview_at")
      .eq("schedule_token", token)
      .single();
    if (!app) return res.status(404).json({ error: "Invalid link" });
    if (app.interview_at) return res.status(409).json({ error: "Already booked" });

    const { data: slot } = await db
      .from("interview_slots")
      .select("*")
      .eq("id", slot_id)
      .eq("job_id", app.job_id)
      .is("booked_by", null)
      .single();
    if (!slot) return res.status(409).json({ error: "Slot no longer available" });

    const { error: slotErr } = await db
      .from("interview_slots")
      .update({ booked_by: app.id })
      .eq("id", slot_id)
      .is("booked_by", null);
    if (slotErr) return res.status(500).json({ error: "Booking failed" });

    const { error: appErr } = await db
      .from("applications")
      .update({ stage: "interview_scheduled", interview_at: slot.slot_start })
      .eq("id", app.id);
    if (appErr) return res.status(500).json({ error: "Update failed" });

    return res.json({ success: true, interview_at: slot.slot_start });
  }

  return res.status(405).json({ error: "Use GET or POST" });
}
