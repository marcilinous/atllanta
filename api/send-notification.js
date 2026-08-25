// POST /api/send-notification
// Body: { to, subject, body, channel: "email" | "in_app", user_id, ... }
// Internal notifications to org members. Admin-gated.
//
// POST /api/send-notification?action=candidate-outreach
// Composes (and optionally sends) a candidate-facing message for one
// application. Body: { application_id, kind, send?: boolean }
// kind: "schedule_invite" | "shortlisted" | "interview_confirmed" | "rejected"
// Returns: { subject, body, whatsapp_text, schedule_url, candidate, sent }
//
// Authorised by access to the application's CLIENT — the same rule screen-job
// uses — not by the blanket admin gate above. A client_admin recruiter owns
// candidate communication for their own client but has no business sending
// arbitrary org-wide mail, and the admin gate excludes client_admin anyway.

import { supabaseAdmin, SUPABASE_URL } from "../lib/supabaseServer.js";

// How long a scheduling link stays valid once it is actually sent to someone.
// Nothing set an expiry before this, so links lived forever.
const SCHEDULE_LINK_TTL_DAYS = 7;

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
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  const user = await getUserFromToken(token);
  if (!user) return res.status(401).json({ error: "Invalid token" });

  const sb = supabaseAdmin();

  if (req.query?.action === "candidate-outreach") {
    return handleCandidateOutreach(req, res, sb, user);
  }

  const { data: membership } = await sb
    .from("memberships")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership?.organization_id) {
    return res.status(403).json({ error: "No organization found" });
  }

  const isAdmin = ["owner", "admin", "super_admin", "agency_admin"].includes(membership.role);
  if (!isAdmin) return res.status(403).json({ error: "Admin access required" });

  const { to, subject, body, channel, user_id, module, entity_type, entity_id } = req.body || {};
  const orgId = membership.organization_id;

  // Escape user-supplied text before it lands in the email's HTML body, and
  // strip newlines from the subject (header-injection guard).
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const safeSubject = String(subject || "").replace(/[\r\n]+/g, " ").trim();

  if (channel === "email" || (!channel && to)) {
    if (!to || !safeSubject) return res.status(400).json({ error: "to and subject required for email" });

    // Recipient must belong to the caller's organization — no arbitrary sends.
    const recipient = String(to).trim().toLowerCase();
    const [{ data: mem }, { data: cand }] = await Promise.all([
      sb.from("memberships").select("id").eq("organization_id", orgId).eq("email", recipient).maybeSingle(),
      sb.from("candidates").select("id").eq("org_id", orgId).eq("email", recipient).maybeSingle(),
    ]);
    if (!mem && !cand) {
      return res.status(403).json({ error: "Recipient is not a member or candidate of your organization" });
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return res.status(500).json({ error: "RESEND_API_KEY not configured" });

    const emailResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "Atllanta <notifications@atllanta.app>",
        to: recipient,
        subject: `[Atllanta] ${safeSubject}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#1A1D23">${esc(safeSubject)}</h2>
          <div style="color:#6B7080">${esc(body || '')}</div>
          <hr style="border:none;border-top:1px solid #E2E4E9;margin:24px 0">
          <p style="font-size:12px;color:#9CA0AB">Atllanta Business OS</p>
        </div>`,
      }),
    });

    const emailResult = await emailResp.json();
    if (!emailResp.ok) return res.status(502).json({ error: "Email send failed", details: emailResult });
    return res.status(200).json({ sent: true, id: emailResult.id });
  }

  if (channel === "in_app" || !channel) {
    if (!user_id || !safeSubject) return res.status(400).json({ error: "user_id and subject required" });

    // Target user must belong to the caller's organization.
    const { data: target } = await sb
      .from("memberships").select("id")
      .eq("organization_id", orgId).eq("user_id", user_id).maybeSingle();
    if (!target) return res.status(403).json({ error: "Target user is not in your organization" });

    const { error } = await sb.from("notifications").insert({
      org_id: orgId,
      user_id,
      title: safeSubject,
      body: body || null,
      module: module || "system",
      entity_type: entity_type || null,
      entity_id: entity_id || null,
      channel: "in_app",
      status: "unread",
    });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ sent: true });
  }

  return res.status(400).json({ error: "Unsupported channel. Use 'email' or 'in_app'." });
}

// ── Candidate outreach ──────────────────────────────────────────────

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatWhen(iso, timezone) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: timezone || "Asia/Kolkata",
      weekday: "long", day: "numeric", month: "long",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 16);
  }
}

// Plain-text bodies. The same text is used for the email and for the
// WhatsApp prefill, so what HR previews is exactly what the candidate gets on
// either channel — no drift between the two.
function composeMessage(kind, ctx) {
  const { candidateName, jobTitle, orgName, scheduleUrl, interviewWhen, meetLink } = ctx;
  const first = (candidateName || "there").split(/\s+/)[0];

  switch (kind) {
    case "schedule_invite":
      return {
        subject: `Pick your interview time — ${jobTitle} at ${orgName}`,
        body: [
          `Hi ${first},`,
          ``,
          `Thanks for your interest in the ${jobTitle} role at ${orgName}. We'd like to talk.`,
          ``,
          `Pick whichever time suits you best:`,
          scheduleUrl,
          ``,
          `The link is personal to you and stays open for ${SCHEDULE_LINK_TTL_DAYS} days. Once you choose a slot you'll get a confirmation with the meeting details.`,
          ``,
          `Looking forward to speaking,`,
          `${orgName} Hiring Team`,
        ].join("\n"),
      };

    case "shortlisted":
      return {
        subject: `Your application is moving forward — ${jobTitle}`,
        body: [
          `Hi ${first},`,
          ``,
          `Good news — your application for the ${jobTitle} role at ${orgName} has been shortlisted.`,
          ``,
          `We'll be in touch shortly with next steps and interview times.`,
          ``,
          `Best,`,
          `${orgName} Hiring Team`,
        ].join("\n"),
      };

    case "interview_confirmed":
      return {
        subject: `Interview confirmed — ${jobTitle} on ${interviewWhen}`,
        body: [
          `Hi ${first},`,
          ``,
          `Your interview for the ${jobTitle} role at ${orgName} is confirmed.`,
          ``,
          `When: ${interviewWhen}`,
          meetLink ? `Where: ${meetLink}` : `We'll share joining details closer to the time.`,
          ``,
          `If you need to reschedule, just reply to this message.`,
          ``,
          `See you then,`,
          `${orgName} Hiring Team`,
        ].filter(Boolean).join("\n"),
      };

    case "rejected":
      return {
        subject: `Update on your application — ${jobTitle}`,
        body: [
          `Hi ${first},`,
          ``,
          `Thank you for taking the time to apply for the ${jobTitle} role at ${orgName}, and for sharing your work with us.`,
          ``,
          `After careful review we're not moving forward with your application for this particular role. This was a genuinely difficult call and it isn't a reflection of your ability.`,
          ``,
          `We'd be glad to keep your details on file and reach out when something closer to your background opens up.`,
          ``,
          `Wishing you the best,`,
          `${orgName} Hiring Team`,
        ].join("\n"),
      };

    default:
      return null;
  }
}

async function handleCandidateOutreach(req, res, sb, user) {
  const { application_id, kind, send } = req.body || {};
  if (!application_id) return res.status(400).json({ error: "application_id is required" });

  const KINDS = ["schedule_invite", "shortlisted", "interview_confirmed", "rejected"];
  if (!KINDS.includes(kind)) {
    return res.status(400).json({ error: `kind must be one of: ${KINDS.join(", ")}` });
  }

  const { data: app } = await sb
    .from("job_applications")
    .select("id, job_id, candidate_id, status, schedule_token, schedule_expires_at, interview_at, meet_link")
    .eq("id", application_id)
    .maybeSingle();
  if (!app) return res.status(404).json({ error: "Application not found" });

  const { data: job } = await sb
    .from("jobs")
    .select("id, title, client_id, clients(id, organization_id)")
    .eq("id", app.job_id)
    .maybeSingle();
  if (!job) return res.status(404).json({ error: "Job not found" });

  const orgId = job.clients.organization_id;

  // Same access rule as screen-job: agency-wide roles, or membership scoped to
  // this job's client.
  const { data: membership } = await sb
    .from("memberships")
    .select("id, role, client_id")
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .maybeSingle();

  const allowed = membership &&
    (["agency_admin", "super_admin"].includes(membership.role) ||
      membership.client_id === job.client_id);
  if (!allowed) return res.status(403).json({ error: "No access to this client" });

  const [{ data: cand }, { data: org }] = await Promise.all([
    sb.from("candidates").select("id, full_name, name, email, phone").eq("id", app.candidate_id).maybeSingle(),
    sb.from("organizations").select("id, name, timezone").eq("id", orgId).maybeSingle(),
  ]);
  if (!cand) return res.status(404).json({ error: "Candidate not found" });

  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const scheduleUrl = app.schedule_token ? `${proto}://${host}/schedule?token=${app.schedule_token}` : null;

  if (kind === "schedule_invite" && !scheduleUrl) {
    return res.status(400).json({ error: "This application has no scheduling token." });
  }

  const composed = composeMessage(kind, {
    candidateName: cand.full_name || cand.name || "",
    jobTitle: job.title,
    orgName: org?.name || "the team",
    scheduleUrl,
    interviewWhen: formatWhen(app.interview_at, org?.timezone),
    meetLink: app.meet_link,
  });

  const payload = {
    subject: composed.subject,
    body: composed.body,
    whatsapp_text: composed.body,
    schedule_url: scheduleUrl,
    candidate: { name: cand.full_name || cand.name || "", email: cand.email || null, phone: cand.phone || null },
    sent: false,
  };

  // Preview only — nothing leaves the building.
  if (!send) return res.status(200).json(payload);

  if (!cand.email) {
    return res.status(400).json({ error: "This candidate has no email address. Use WhatsApp, or add an email first." });
  }
  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: "RESEND_API_KEY is not configured." });
  }

  const emailResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Atllanta <notifications@atllanta.app>",
      to: cand.email,
      // Candidate-facing mail carries the hiring org's name, not "[Atllanta]".
      // The candidate applied to them, and has never heard of us.
      subject: composed.subject,
      html: `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#1A1D23;line-height:1.6">
        ${composed.body.split("\n").map((line) => {
          if (!line.trim()) return "<div style=\"height:12px\"></div>";
          if (scheduleUrl && line.trim() === scheduleUrl) {
            return `<p style="margin:16px 0"><a href="${escapeHtml(scheduleUrl)}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">Choose your interview time</a></p>`;
          }
          return `<p style="margin:0">${escapeHtml(line)}</p>`;
        }).join("")}
      </div>`,
    }),
  });

  const emailResult = await emailResp.json().catch(() => ({}));
  if (!emailResp.ok) {
    return res.status(502).json({ error: "Email send failed", details: emailResult });
  }

  // Now that a real invite is out, start the clock on the link.
  if (kind === "schedule_invite") {
    const expiresAt = new Date(Date.now() + SCHEDULE_LINK_TTL_DAYS * 86400000).toISOString();
    await sb.from("job_applications").update({ schedule_expires_at: expiresAt }).eq("id", app.id);
    payload.schedule_expires_at = expiresAt;
  }

  return res.status(200).json({ ...payload, sent: true, email_id: emailResult.id });
}
