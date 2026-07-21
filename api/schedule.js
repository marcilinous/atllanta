// GET  /api/schedule?token=<uuid>  — public: fetch job info + candidate-specific slots
// POST /api/schedule { token, slot_id } — public: book a slot
// Each candidate gets a unique link with 24hr auto-expiry.

import { supabaseAdmin } from "../lib/supabaseServer.js";
import { createMeetEvent } from "../lib/googleMeet.js";

export default async function handler(req, res) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Server misconfigured" });
  }

  const db = supabaseAdmin();

  if (req.method === "GET") {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: "token required" });

    const { data: app } = await db
      .from("job_applications")
      .select("id, job_id, candidate_id, status, interview_at, schedule_expires_at, meet_link")
      .eq("schedule_token", token)
      .single();
    if (!app) return res.status(404).json({ error: "Invalid or expired link" });

    if (app.schedule_expires_at && new Date(app.schedule_expires_at) < new Date()) {
      return res.status(410).json({ error: "This scheduling link has expired. Please ask the hiring team for a new link." });
    }

    const [{ data: job }, { data: cand }] = await Promise.all([
      db.from("jobs").select("id, title, client_id").eq("id", app.job_id).single(),
      db.from("candidates").select("full_name, name").eq("id", app.candidate_id).single(),
    ]);
    if (!job) return res.status(404).json({ error: "Job not found" });

    const { data: client } = await db
      .from("clients").select("organization_id, name").eq("id", job.client_id).single();

    const { data: org } = client
      ? await db.from("organizations").select("full_name, name").eq("id", client.organization_id).single()
      : { data: null };

    if (app.interview_at) {
      return res.json({
        booked: true,
        interview_at: app.interview_at,
        meet_link: app.meet_link || null,
        job_title: job.title,
        org_name: org?.name || client?.name || "",
        candidate_name: cand?.full_name || cand?.name || "",
      });
    }

    const { data: slots } = await db
      .from("interview_slots")
      .select("id, slot_start, slot_end")
      .eq("application_id", app.id)
      .is("booked_by", null)
      .gte("slot_start", new Date().toISOString())
      .order("slot_start");

    const expiresAt = app.schedule_expires_at || null;

    return res.json({
      booked: false,
      job_title: job.title,
      org_name: org?.name || client?.name || "",
      candidate_name: cand?.full_name || cand?.name || "",
      slots: slots || [],
      expires_at: expiresAt,
    });
  }

  if (req.method === "POST") {
    const { token, slot_id } = req.body || {};
    if (!token || !slot_id) return res.status(400).json({ error: "token and slot_id required" });

    const { data: app } = await db
      .from("job_applications")
      .select("id, job_id, interview_at, schedule_expires_at")
      .eq("schedule_token", token)
      .single();
    if (!app) return res.status(404).json({ error: "Invalid link" });

    if (app.schedule_expires_at && new Date(app.schedule_expires_at) < new Date()) {
      return res.status(410).json({ error: "This scheduling link has expired" });
    }

    if (app.interview_at) return res.status(409).json({ error: "Already booked" });

    const { data: slot } = await db
      .from("interview_slots")
      .select("*")
      .eq("id", slot_id)
      .eq("application_id", app.id)
      .is("booked_by", null)
      .single();
    if (!slot) return res.status(409).json({ error: "Slot no longer available" });

    const { error: slotErr } = await db
      .from("interview_slots")
      .update({ booked_by: app.id })
      .eq("id", slot_id)
      .is("booked_by", null);
    if (slotErr) return res.status(500).json({ error: "Booking failed" });

    // Fetch candidate, job, org info for the calendar event
    const [{ data: job }, { data: cand }] = await Promise.all([
      db.from("jobs").select("title, client_id").eq("id", app.job_id).single(),
      db.from("candidates").select("full_name, name, email").eq("id", app.candidate_id).single(),
    ]);

    let meetLink = null;
    try {
      // Get manager email for the calendar invite
      let managerEmail = null;
      if (slot.created_by) {
        const { data: mUser } = await db.auth.admin.getUserById(slot.created_by);
        managerEmail = mUser?.user?.email || null;
      }

      const meetResult = await createMeetEvent({
        title: `Interview: ${cand?.full_name || cand?.name || "Candidate"} — ${job?.title || "Position"}`,
        description: `Interview for ${job?.title || "Position"}\nCandidate: ${cand?.full_name || cand?.name || ""}`,
        startTime: slot.slot_start,
        endTime: slot.slot_end,
        attendees: [managerEmail, cand?.email],
        creatorUserId: slot.created_by,
      });
      meetLink = meetResult?.meetLink || null;
    } catch (_) {
      // Meet creation is best-effort — booking still succeeds without it
    }

    const updateData = { status: "interview_scheduled", interview_at: slot.slot_start };
    if (meetLink) updateData.meet_link = meetLink;

    const { error: appErr } = await db
      .from("job_applications")
      .update(updateData)
      .eq("id", app.id);
    if (appErr) return res.status(500).json({ error: "Update failed" });

    return res.json({ success: true, interview_at: slot.slot_start, meet_link: meetLink });
  }

  return res.status(405).json({ error: "Use GET or POST" });
}
