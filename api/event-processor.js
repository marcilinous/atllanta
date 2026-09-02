import { supabaseAdmin } from "../lib/supabaseServer.js";
import crypto from "crypto";

// Server-side event worker. Two responsibilities:
//
//   1. Backstop event processing. The in-browser processor handles events in
//      real time while someone is online. This drains any events left pending
//      once no browser claimed them (grace period below), so nothing rots.
//
//   2. Email delivery. The browser can never hold the Resend key, so it only
//      queues notifications (email_status='pending'). This pass drains that
//      queue and is the single place email is actually sent.
//
// Trigger it on a schedule (vercel.json cron, or any external cron pinging
// the endpoint with the CRON_SECRET bearer token). More frequent pings =
// lower email latency; in-app notifications stay real-time regardless.

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;
const EMAIL_BATCH_SIZE = 50;
// Only reprocess events a browser has had a fair chance to claim. Avoids the
// server racing an online client on freshly-published events.
const BACKSTOP_GRACE_MS = 2 * 60 * 1000;

async function createNotification(sb, data, email = false) {
  await sb.from("notifications").insert({
    ...data,
    channel: data.channel || "in_app",
    status: "unread",
    email_status: email ? "pending" : "none",
  });
}

const recipes = {
  "people.employee.created": async (sb, event) => {
    const { employee_id, org_id } = event.payload;
    const { data: leaveTypes } = await sb
      .from("leave_types")
      .select("id, annual_quota")
      .eq("org_id", org_id)
      .eq("is_active", true);

    if (leaveTypes?.length) {
      const year = new Date().getFullYear();
      const balances = leaveTypes.map((lt) => ({
        org_id,
        user_id: employee_id,
        leave_type_id: lt.id,
        year,
        opening_balance: lt.annual_quota || 0,
        accrued: 0,
        used: 0,
      }));
      await sb.from("leave_balances").upsert(balances, {
        onConflict: "user_id,leave_type_id,year",
      });
    }

    const { data: emp } = await sb
      .from("users")
      .select("full_name, reporting_manager_id")
      .eq("id", employee_id)
      .maybeSingle();
    const empName = emp?.full_name || "A new team member";

    if (emp?.reporting_manager_id) {
      await createNotification(sb, {
        org_id,
        user_id: emp.reporting_manager_id,
        title: "New team member",
        body: `${empName} has been added to your team.`,
        module: "people",
        entity_type: "employee",
        entity_id: employee_id,
      });
    }

    const { data: hrUsers } = await sb
      .from("users")
      .select("id")
      .eq("org_id", org_id)
      .in("role", ["owner", "admin"]);
    if (hrUsers?.length) {
      const notifications = hrUsers
        .filter((u) => u.id !== event.actor_id && u.id !== emp?.reporting_manager_id)
        .map((u) => ({
          org_id,
          user_id: u.id,
          title: "New employee added",
          body: `${empName} has been added to the organization.`,
          module: "people",
          entity_type: "employee",
          entity_id: employee_id,
          channel: "in_app",
          status: "unread",
          email_status: "none",
        }));
      if (notifications.length) await sb.from("notifications").insert(notifications);
    }
  },

  "leave.request.created": async (sb, event) => {
    const { leave_request_id, user_id, org_id } = event.payload;

    const { data: requester } = await sb
      .from("users")
      .select("full_name, email, reporting_manager_id")
      .eq("id", user_id)
      .maybeSingle();
    const name = requester?.full_name || requester?.email || "An employee";

    const { data: leaveReq } = await sb
      .from("leave_requests")
      .select("days")
      .eq("id", leave_request_id)
      .maybeSingle();
    const days = parseFloat(leaveReq?.days || 0);

    // Manager gets an email; HR (looped in on long leaves) gets in-app only.
    const managerId = requester?.reporting_manager_id;
    if (managerId && managerId !== user_id) {
      await createNotification(sb, {
        org_id,
        user_id: managerId,
        title: "New leave request",
        body: `${name} has requested ${days} day${days !== 1 ? "s" : ""} of leave.`,
        module: "leave",
        entity_type: "leave_request",
        entity_id: leave_request_id,
      }, true);
    }

    const hrIds = new Set();
    if (days > 3) {
      const { data: hrUsers } = await sb
        .from("users")
        .select("id")
        .eq("org_id", org_id)
        .in("role", ["owner", "admin"]);
      (hrUsers || []).forEach((u) => hrIds.add(u.id));
    }
    if (!managerId) {
      const { data: managers } = await sb
        .from("users")
        .select("id")
        .eq("org_id", org_id)
        .in("role", ["owner", "admin", "manager"]);
      (managers || []).forEach((u) => hrIds.add(u.id));
    }
    hrIds.delete(user_id);
    hrIds.delete(managerId);

    if (hrIds.size) {
      const notifications = [...hrIds].map((uid) => ({
        org_id,
        user_id: uid,
        title: "New leave request",
        body: `${name} has requested ${days} day${days !== 1 ? "s" : ""} of leave.`,
        module: "leave",
        entity_type: "leave_request",
        entity_id: leave_request_id,
        channel: "in_app",
        status: "unread",
        email_status: "none",
      }));
      await sb.from("notifications").insert(notifications);
    }
  },

  "leave.request.approved": async (sb, event) => {
    const { leave_request_id, user_id, org_id, days, leave_type_id } =
      event.payload;

    const year = new Date().getFullYear();
    const { data: balance } = await sb
      .from("leave_balances")
      .select("id, used")
      .eq("user_id", user_id)
      .eq("leave_type_id", leave_type_id)
      .eq("year", year)
      .maybeSingle();

    if (balance) {
      await sb
        .from("leave_balances")
        .update({ used: (parseFloat(balance.used) || 0) + parseFloat(days) })
        .eq("id", balance.id);
    }

    const { data: leaveReq } = await sb
      .from("leave_requests")
      .select("start_date, end_date")
      .eq("id", leave_request_id)
      .maybeSingle();

    if (leaveReq) {
      const start = new Date(leaveReq.start_date);
      const end = new Date(leaveReq.end_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        await sb.from("attendance").upsert(
          {
            org_id,
            user_id,
            date: dateStr,
            status: "on_leave",
          },
          { onConflict: "user_id,date" }
        );
      }
    }

    await createNotification(sb, {
      org_id,
      user_id,
      title: "Leave approved",
      body: "Your leave request has been approved.",
      module: "leave",
      entity_type: "leave_request",
      entity_id: leave_request_id,
    }, true);
  },

  "leave.request.rejected": async (sb, event) => {
    const { leave_request_id, user_id, org_id } = event.payload;
    await createNotification(sb, {
      org_id,
      user_id,
      title: "Leave rejected",
      body: "Your leave request has been rejected.",
      module: "leave",
      entity_type: "leave_request",
      entity_id: leave_request_id,
    }, true);
  },

  "recruitment.candidate.shortlisted": async (sb, event) => {
    const { job_id, candidate_id, org_id, application_id } = event.payload;

    const [{ data: job }, { data: candidate }] = await Promise.all([
      sb.from("jobs").select("title, created_by, hiring_manager_id").eq("id", job_id).single(),
      sb.from("candidates").select("full_name").eq("id", candidate_id).maybeSingle(),
    ]);

    const candidateName = candidate?.full_name || "A candidate";
    const jobTitle = job?.title || "a position";

    // The assigned hiring manager is the one who actually schedules the
    // interview, so they get the action item. Fall back to whoever created the
    // job only when no manager is assigned — before this, the manager was
    // never told at all and the notice went to the job's author instead.
    const owner = job?.hiring_manager_id || job?.created_by;
    if (owner) {
      await createNotification(sb, {
        org_id,
        user_id: owner,
        title: "Candidate shortlisted — schedule interview",
        body: `${candidateName} has been shortlisted for ${jobTitle}. Please schedule an interview.`,
        module: "recruitment",
        entity_type: "job_application",
        entity_id: application_id || candidate_id,
      }, true);
    }

    // Keep the job's author in the loop when they are not the manager.
    if (job?.created_by && job.created_by !== owner) {
      await createNotification(sb, {
        org_id,
        user_id: job.created_by,
        title: "Candidate shortlisted",
        body: `${candidateName} shortlisted for ${jobTitle}.`,
        module: "recruitment",
        entity_type: "job_application",
        entity_id: application_id || candidate_id,
      });
    }

    const { data: hrUsers } = await sb
      .from("users")
      .select("id")
      .eq("org_id", org_id)
      .in("role", ["owner", "admin"]);
    if (hrUsers?.length) {
      const notifications = hrUsers
        .filter((u) => u.id !== owner && u.id !== job?.created_by && u.id !== event.actor_id)
        .map((u) => ({
          org_id,
          user_id: u.id,
          title: "Candidate shortlisted",
          body: `${candidateName} shortlisted for ${jobTitle}.`,
          module: "recruitment",
          entity_type: "job_application",
          entity_id: application_id || candidate_id,
          channel: "in_app",
          status: "unread",
          email_status: "none",
        }));
      if (notifications.length) await sb.from("notifications").insert(notifications);
    }
  },

  "finance.expense.created": async (sb, event) => {
    const { expense_id, org_id, amount, title } = event.payload;
    const { data: expense } = await sb.from("expenses").select("user_id").eq("id", expense_id).maybeSingle();
    if (!expense) return;

    const { data: submitter } = await sb.from("users").select("full_name, reporting_manager_id").eq("id", expense.user_id).maybeSingle();
    const name = submitter?.full_name || "An employee";

    const notifyIds = new Set();
    if (submitter?.reporting_manager_id) notifyIds.add(submitter.reporting_manager_id);

    const { data: admins } = await sb.from("users").select("id").eq("org_id", org_id).in("role", ["owner", "admin"]);
    (admins || []).forEach(u => notifyIds.add(u.id));
    notifyIds.delete(expense.user_id);

    if (notifyIds.size) {
      const notifications = [...notifyIds].map(uid => ({
        org_id, user_id: uid,
        title: "New expense claim",
        body: `${name} submitted an expense of ${amount} for "${title}".`,
        module: "finance", entity_type: "expense", entity_id: expense_id,
        channel: "in_app", status: "unread", email_status: "pending",
      }));
      await sb.from("notifications").insert(notifications);
    }
  },

  "finance.expense.approved": async (sb, event) => {
    const { expense_id, user_id, org_id } = event.payload;
    await createNotification(sb, {
      org_id, user_id,
      title: "Expense approved",
      body: "Your expense claim has been approved.",
      module: "finance", entity_type: "expense", entity_id: expense_id,
    }, true);
  },

  "attendance.regularization.approved": async (sb, event) => {
    const { regularization_id, user_id, org_id } = event.payload;
    if (user_id) {
      await createNotification(sb, {
        org_id,
        user_id,
        title: "Regularization approved",
        body: "Your attendance regularization request has been approved.",
        module: "attendance",
        entity_type: "regularization",
        entity_id: regularization_id,
      }, true);
    }
  },

  "attendance.checkin.completed": async (sb, event) => {
    const { user_id, org_id, check_in_time } = event.payload;

    const { data: schedule } = await sb
      .from("work_schedules")
      .select("shift_start")
      .eq("org_id", org_id)
      .eq("is_default", true)
      .single();

    if (schedule?.shift_start && check_in_time) {
      const shiftParts = schedule.shift_start.split(":");
      const shiftMinutes =
        parseInt(shiftParts[0]) * 60 + parseInt(shiftParts[1]);
      const checkInDate = new Date(check_in_time);
      const checkInMinutes =
        checkInDate.getHours() * 60 + checkInDate.getMinutes();
      const lateThreshold = 15;

      if (checkInMinutes > shiftMinutes + lateThreshold) {
        const today = new Date().toISOString().split("T")[0];
        await sb
          .from("attendance")
          .update({ status: "late" })
          .eq("user_id", user_id)
          .eq("date", today);

        const startOfMonth = today.slice(0, 7) + "-01";
        const { count } = await sb
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user_id)
          .eq("status", "late")
          .gte("date", startOfMonth)
          .lte("date", today);

        if (count >= 3) {
          const { data: managers } = await sb
            .from("users")
            .select("id")
            .eq("org_id", org_id)
            .in("role", ["owner", "admin", "manager"]);

          if (managers?.length) {
            const notifications = managers.map((m) => ({
              org_id,
              user_id: m.id,
              title: "Frequent late check-ins",
              body: `An employee has been late ${count} times this month.`,
              module: "attendance",
              entity_type: "attendance",
              channel: "in_app",
              status: "unread",
              email_status: "none",
            }));
            await sb.from("notifications").insert(notifications);
          }
        }
      }
    }
  },
};

// ------------------------------------------------------------
// Email delivery
// ------------------------------------------------------------
function renderEmailHtml(title, body, name) {
  const greeting = name ? `<p style="color:#6B7080">Hi ${escapeHtml(name)},</p>` : "";
  return `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
    ${greeting}
    <h2 style="color:#1A1D23">${escapeHtml(title)}</h2>
    <p style="color:#6B7080">${escapeHtml(body || "")}</p>
    <hr style="border:none;border-top:1px solid #E2E4E9;margin:24px 0">
    <p style="font-size:12px;color:#9CA0AB">Atllanta Business OS</p>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function sendEmail(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Atllanta <notifications@atllanta.app>",
      to,
      subject: `[Atllanta] ${subject}`,
      html,
    }),
  });
  const result = await res.json().catch(() => ({}));
  return { ok: res.ok, result };
}

async function dispatchEmails(sb) {
  if (!process.env.RESEND_API_KEY) {
    return { emailed: 0, failed: 0, skipped: "RESEND_API_KEY not set" };
  }

  const { data: pending } = await sb
    .from("notifications")
    .select("id, user_id, title, body")
    .eq("email_status", "pending")
    .order("sent_at", { ascending: true })
    .limit(EMAIL_BATCH_SIZE);

  if (!pending?.length) return { emailed: 0, failed: 0 };

  const userIds = [...new Set(pending.map((n) => n.user_id))];
  const { data: users } = await sb
    .from("users")
    .select("id, email, full_name")
    .in("id", userIds);
  const byId = Object.fromEntries((users || []).map((u) => [u.id, u]));

  let emailed = 0;
  let failed = 0;

  for (const n of pending) {
    const user = byId[n.user_id];
    const stamp = new Date().toISOString();

    if (!user?.email) {
      await sb.from("notifications").update({ email_status: "failed", emailed_at: stamp }).eq("id", n.id);
      failed++;
      continue;
    }

    try {
      const { ok } = await sendEmail(user.email, n.title, renderEmailHtml(n.title, n.body, user.full_name));
      await sb
        .from("notifications")
        .update({ email_status: ok ? "sent" : "failed", emailed_at: stamp })
        .eq("id", n.id);
      ok ? emailed++ : failed++;
    } catch {
      await sb.from("notifications").update({ email_status: "failed", emailed_at: stamp }).eq("id", n.id);
      failed++;
    }
  }

  return { emailed, failed };
}

// ------------------------------------------------------------
// Backstop event processing
// ------------------------------------------------------------
async function processBackstopEvents(sb) {
  const cutoff = new Date(Date.now() - BACKSTOP_GRACE_MS).toISOString();

  const { data: events, error } = await sb
    .from("events")
    .select("*")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .lt("created_at", cutoff)
    .order("created_at")
    .limit(BATCH_SIZE);

  if (error) throw new Error(error.message);
  if (!events?.length) return { processed: 0, failed: 0 };

  let processed = 0;
  let failed = 0;

  for (const event of events) {
    // Guarded claim: only proceed if this row is still pending, so a browser
    // that grabbed it a moment ago wins and we skip it.
    const { data: claimed } = await sb
      .from("events")
      .update({ status: "processing", attempts: event.attempts + 1 })
      .eq("id", event.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed?.length) continue;

    const recipe = recipes[event.event_type];
    if (!recipe) {
      await sb
        .from("events")
        .update({ status: "completed", processed_at: new Date().toISOString() })
        .eq("id", event.id);
      processed++;
      continue;
    }

    try {
      await recipe(sb, event);
      await sb
        .from("events")
        .update({ status: "completed", processed_at: new Date().toISOString() })
        .eq("id", event.id);
      processed++;
    } catch (err) {
      const newStatus = event.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending";
      await sb.from("events").update({ status: newStatus }).eq("id", event.id);
      failed++;
    }
  }

  return { processed, failed };
}

// Recompute the CRM opportunity engine's feature cache.
//
// The engine reads a materialised view rather than the raw report rows: doing
// it live cost 5.7s a call, almost all of it decompressing the JSONB in
// crm_report_rows. There is no pg_cron on this project, so this nightly pass
// is what keeps the scores current. It is deliberately non-fatal — a failure
// here must not cost us the event drain or the email queue, and yesterday's
// scores are still useful (the UI shows when they were last computed).
async function refreshOpportunityEngine(sb) {
  const { data, error } = await sb.rpc("crm_refresh_opportunity_features");
  if (error) return { refreshed: false, error: error.message };
  return { refreshed: true, computed_at: data };
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Use POST or GET" });
  }

  // Fail closed: this endpoint drains the email queue via the service role, so
  // it must never be publicly callable. Require CRON_SECRET to be configured
  // AND presented in the Authorization header (Vercel Cron sends it there).
  // The secret is never accepted in the query string (it would leak to logs).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: "Server misconfigured: CRON_SECRET is not set" });
  }
  const authHeader = req.headers.authorization || "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(cronSecret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const sb = supabaseAdmin();

  try {
    const events = await processBackstopEvents(sb);
    const emails = await dispatchEmails(sb);
    const opportunities = await refreshOpportunityEngine(sb);
    return res.status(200).json({ events, emails, opportunities });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
