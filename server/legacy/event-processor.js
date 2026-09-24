import { supabaseAdmin } from "../../lib/supabaseServer.js";

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;

// An event means "something changed — go and look". Payload values are only
// LOOKUP KEYS. Every row is reloaded with .eq("id", id).eq("org_id", orgId)
// where orgId = event.org_id; every fact (user, days, dates, amounts, titles,
// times) comes from the reloaded row, never the payload; a recipe that
// reflects a state change requires the row to actually be in that state. If a
// row isn't found in the org, or isn't in the required state, the recipe
// returns silently (no throw — a throw would retry). Any users lookup must
// also be .eq("org_id", orgId).

async function inOrg(sb, table, id, orgId, columns) {
  return id
    ? (await sb.from(table).select(columns).eq("id", id).eq("org_id", orgId).maybeSingle()).data
    : null;
}

function esc(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

const recipes = {
  "people.employee.created": async (sb, event) => {
    const { payload } = event;
    const orgId = event.org_id;
    const emp = await inOrg(sb, "users", payload.employee_id, orgId, "id, full_name, reporting_manager_id");
    if (!emp) return;

    const { data: leaveTypes } = await sb
      .from("leave_types")
      .select("id, annual_quota")
      .eq("org_id", orgId)
      .eq("is_active", true);

    if (leaveTypes?.length) {
      const year = new Date().getFullYear();
      const balances = leaveTypes.map((lt) => ({
        org_id: orgId,
        user_id: emp.id,
        leave_type_id: lt.id,
        year,
        opening_balance: lt.annual_quota || 0,
        accrued: 0,
        used: 0,
      }));
      await sb.from("leave_balances").upsert(balances, {
        onConflict: "user_id,leave_type_id,year",
        ignoreDuplicates: true,
      });
    }

    const empName = emp.full_name || "A new team member";

    if (emp.reporting_manager_id) {
      await createNotification(sb, {
        org_id: orgId,
        user_id: emp.reporting_manager_id,
        title: "New team member",
        body: `${empName} has been added to your team.`,
        module: "people",
        entity_type: "employee",
        entity_id: emp.id,
      });
    }

    const { data: hrUsers } = await sb
      .from("users")
      .select("id")
      .eq("org_id", orgId)
      .in("role", ["owner", "admin"]);
    if (hrUsers?.length) {
      const notifications = hrUsers
        .filter((u) => u.id !== event.actor_id && u.id !== emp.reporting_manager_id)
        .map((u) => ({
          org_id: orgId,
          user_id: u.id,
          title: "New employee added",
          body: `${empName} has been added to the organization.`,
          module: "people",
          entity_type: "employee",
          entity_id: emp.id,
          channel: "in_app",
          status: "unread",
        }));
      if (notifications.length) await sb.from("notifications").insert(notifications);
    }
  },

  "leave.request.created": async (sb, event) => {
    const { payload } = event;
    const orgId = event.org_id;

    const req = await inOrg(sb, "leave_requests", payload.leave_request_id, orgId, "id, user_id, days");
    if (!req) return;

    const requester = await inOrg(sb, "users", req.user_id, orgId, "full_name, email, reporting_manager_id");
    const name = requester?.full_name || requester?.email || "An employee";
    const days = parseFloat(req.days || 0);

    const notifyIds = new Set();

    if (requester?.reporting_manager_id) {
      notifyIds.add(requester.reporting_manager_id);
    }

    if (days > 3) {
      const { data: hrUsers } = await sb
        .from("users")
        .select("id")
        .eq("org_id", orgId)
        .in("role", ["owner", "admin"]);
      (hrUsers || []).forEach((u) => notifyIds.add(u.id));
    }

    if (!notifyIds.size) {
      const { data: managers } = await sb
        .from("users")
        .select("id")
        .eq("org_id", orgId)
        .in("role", ["owner", "admin", "manager"]);
      (managers || []).forEach((u) => notifyIds.add(u.id));
    }

    notifyIds.delete(req.user_id);

    if (notifyIds.size) {
      const notifications = [...notifyIds].map((uid) => ({
        org_id: orgId,
        user_id: uid,
        title: "New leave request",
        body: `${name} has requested ${days} day${days !== 1 ? "s" : ""} of leave.`,
        module: "leave",
        entity_type: "leave_request",
        entity_id: req.id,
        channel: "in_app",
        status: "unread",
      }));
      await sb.from("notifications").insert(notifications);
    }
  },

  "leave.request.approved": async (sb, event) => {
    const { payload } = event;
    const orgId = event.org_id;

    const req = await inOrg(
      sb,
      "leave_requests",
      payload.leave_request_id,
      orgId,
      "id, user_id, leave_type_id, days, start_date, end_date, status"
    );
    if (!req || req.status !== "approved") return;

    // Dedup PER REQUEST, not per event: event_side_effects' primary key is
    // (event_id, effect_key), so a fresh fake event for the same request would
    // otherwise deduct again.
    const effectKey = `leave_used:${req.id}`;
    const { count } = await sb
      .from("event_side_effects")
      .select("*", { count: "exact", head: true })
      .eq("effect_key", effectKey);
    // Before v1.2.5 the claim key was the bare "leave_used", recorded against
    // whichever event applied it. Count those too, or a fresh event for a
    // request approved before this release would deduct a second time.
    let legacyApplied = false;
    if (!(count > 0)) {
      const { data: earlier } = await sb
        .from("events")
        .select("id")
        .eq("org_id", orgId)
        .eq("event_type", "leave.request.approved")
        .eq("payload->>leave_request_id", req.id)
        .neq("id", event.id);
      const earlierIds = (earlier || []).map((e) => e.id);
      if (earlierIds.length) {
        const { count: legacyCount } = await sb
          .from("event_side_effects")
          .select("*", { count: "exact", head: true })
          .eq("effect_key", "leave_used")
          .in("event_id", earlierIds);
        legacyApplied = legacyCount > 0;
      }
    }
    const alreadyApplied = count > 0 || legacyApplied;

    // Atomic in-DB claim, applied at most once per request: claim_side_effect
    // dedupes across retries and across the browser processor.
    const { data: firstTime, error: claimError } = await sb.rpc("claim_side_effect", {
      p_event_id: event.id,
      p_effect_key: effectKey,
    });
    // Nothing was recorded, so a retry is safe.
    if (claimError) throw new Error(`claim_side_effect failed: ${claimError.message}`);
    if (firstTime && !alreadyApplied) {
      const year = new Date().getFullYear();
      const { error: applyError } = await sb.rpc("apply_leave_usage", {
        p_user_id: req.user_id,
        p_leave_type_id: req.leave_type_id,
        p_year: year,
        p_days: parseFloat(req.days) || 0,
      });
      // The side effect is already claimed, so a retry would skip it: log loudly.
      if (applyError) console.error("leave usage apply failed after claim:", event.id, applyError.message);
    }

    const start = new Date(req.start_date);
    const end = new Date(req.end_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      await sb.from("attendance").upsert(
        {
          org_id: orgId,
          user_id: req.user_id,
          date: dateStr,
          status: "on_leave",
        },
        { onConflict: "user_id,date" }
      );
    }

    // Skip the notification too if already applied, to avoid spam. The
    // attendance upserts above are idempotent, so they always run.
    if (!alreadyApplied) {
      await createNotification(sb, {
        org_id: orgId,
        user_id: req.user_id,
        title: "Leave approved",
        body: "Your leave request has been approved.",
        module: "leave",
        entity_type: "leave_request",
        entity_id: req.id,
      });
    }
  },

  "leave.request.rejected": async (sb, event) => {
    const { payload } = event;
    const orgId = event.org_id;

    const req = await inOrg(sb, "leave_requests", payload.leave_request_id, orgId, "id, user_id, status");
    if (!req || req.status !== "rejected") return;

    await createNotification(sb, {
      org_id: orgId,
      user_id: req.user_id,
      title: "Leave rejected",
      body: "Your leave request has been rejected.",
      module: "leave",
      entity_type: "leave_request",
      entity_id: req.id,
    });
  },

  "recruitment.candidate.shortlisted": async (sb, event) => {
    const { payload } = event;
    const orgId = event.org_id;

    const job = await inOrg(sb, "jobs", payload.job_id, orgId, "id, title, created_by");
    if (!job) return;

    const candidate = await inOrg(sb, "candidates", payload.candidate_id, orgId, "full_name");
    const application = payload.application_id
      ? await inOrg(sb, "job_applications", payload.application_id, orgId, "id")
      : null;
    const entityId = application?.id || (candidate ? payload.candidate_id : job.id);

    const candidateName = candidate?.full_name || "A candidate";
    const jobTitle = job.title || "a position";

    if (job.created_by) {
      await createNotification(sb, {
        org_id: orgId,
        user_id: job.created_by,
        title: "Candidate shortlisted — schedule interview",
        body: `${candidateName} has been shortlisted for ${jobTitle}. Please schedule an interview.`,
        module: "recruitment",
        entity_type: "job_application",
        entity_id: entityId,
      });
    }

    const { data: hrUsers } = await sb
      .from("users")
      .select("id")
      .eq("org_id", orgId)
      .in("role", ["owner", "admin"]);
    if (hrUsers?.length) {
      const notifications = hrUsers
        .filter((u) => u.id !== job.created_by && u.id !== event.actor_id)
        .map((u) => ({
          org_id: orgId,
          user_id: u.id,
          title: "Candidate shortlisted",
          body: `${candidateName} shortlisted for ${jobTitle}.`,
          module: "recruitment",
          entity_type: "job_application",
          entity_id: entityId,
          channel: "in_app",
          status: "unread",
        }));
      if (notifications.length) await sb.from("notifications").insert(notifications);
    }
  },

  "finance.expense.created": async (sb, event) => {
    const { payload } = event;
    const orgId = event.org_id;

    const expense = await inOrg(sb, "expenses", payload.expense_id, orgId, "id, user_id, amount, title");
    if (!expense) return;

    const submitter = await inOrg(sb, "users", expense.user_id, orgId, "full_name, reporting_manager_id");
    const name = submitter?.full_name || "An employee";

    const notifyIds = new Set();
    if (submitter?.reporting_manager_id) notifyIds.add(submitter.reporting_manager_id);

    const { data: admins } = await sb.from("users").select("id").eq("org_id", orgId).in("role", ["owner", "admin"]);
    (admins || []).forEach((u) => notifyIds.add(u.id));
    notifyIds.delete(expense.user_id);

    if (notifyIds.size) {
      const notifications = [...notifyIds].map((uid) => ({
        org_id: orgId,
        user_id: uid,
        title: "New expense claim",
        body: `${name} submitted an expense of ${expense.amount} for "${expense.title}".`,
        module: "finance",
        entity_type: "expense",
        entity_id: expense.id,
        channel: "in_app",
        status: "unread",
      }));
      await sb.from("notifications").insert(notifications);
    }
  },

  "finance.expense.approved": async (sb, event) => {
    const { payload } = event;
    const orgId = event.org_id;

    const expense = await inOrg(sb, "expenses", payload.expense_id, orgId, "id, user_id, status");
    if (!expense || expense.status !== "approved") return;

    await createNotification(sb, {
      org_id: orgId,
      user_id: expense.user_id,
      title: "Expense approved",
      body: "Your expense claim has been approved.",
      module: "finance",
      entity_type: "expense",
      entity_id: expense.id,
    });
  },

  "attendance.regularization.approved": async (sb, event) => {
    const { payload } = event;
    const orgId = event.org_id;

    const reg = await inOrg(sb, "attendance_regularizations", payload.regularization_id, orgId, "id, user_id, status");
    if (!reg || reg.status !== "approved") return;

    await createNotification(sb, {
      org_id: orgId,
      user_id: reg.user_id,
      title: "Regularization approved",
      body: "Your attendance regularization request has been approved.",
      module: "attendance",
      entity_type: "regularization",
      entity_id: reg.id,
    });
  },

  "attendance.checkin.completed": async (sb, event) => {
    const { payload } = event;
    const orgId = event.org_id;

    const today = new Date().toISOString().split("T")[0];
    const { data: row } = await sb
      .from("attendance")
      .select("id, user_id, check_in")
      .eq("org_id", orgId)
      .eq("user_id", payload.user_id)
      .eq("date", today)
      .maybeSingle();
    if (!row || !row.check_in) return;

    const { data: schedule } = await sb
      .from("work_schedules")
      .select("shift_start")
      .eq("org_id", orgId)
      .eq("is_default", true)
      .single();

    if (schedule?.shift_start) {
      const shiftParts = schedule.shift_start.split(":");
      const shiftMinutes = parseInt(shiftParts[0]) * 60 + parseInt(shiftParts[1]);
      const checkInDate = new Date(row.check_in);
      const checkInMinutes = checkInDate.getHours() * 60 + checkInDate.getMinutes();
      const lateThreshold = 15;

      if (checkInMinutes > shiftMinutes + lateThreshold) {
        await sb.from("attendance").update({ status: "late" }).eq("id", row.id);

        const startOfMonth = today.slice(0, 7) + "-01";
        const { count } = await sb
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("org_id", orgId)
          .eq("user_id", row.user_id)
          .eq("status", "late")
          .gte("date", startOfMonth)
          .lte("date", today);

        if (count >= 3) {
          const { data: managers } = await sb
            .from("users")
            .select("id")
            .eq("org_id", orgId)
            .in("role", ["owner", "admin", "manager"]);

          if (managers?.length) {
            const notifications = managers.map((m) => ({
              org_id: orgId,
              user_id: m.id,
              title: "Frequent late check-ins",
              body: `An employee has been late ${count} times this month.`,
              module: "attendance",
              entity_type: "attendance",
              channel: "in_app",
              status: "unread",
            }));
            await sb.from("notifications").insert(notifications);
          }
        }
      }
    }
  },
};

async function createNotification(sb, data) {
  // The notified user must exist and belong to the same org this recipe
  // scoped everything to. If not, insert nothing and never email.
  const { data: target } = await sb
    .from("users")
    .select("id")
    .eq("id", data.user_id)
    .eq("org_id", data.org_id)
    .maybeSingle();
  if (!target) return;

  await sb.from("notifications").insert({
    ...data,
    channel: data.channel || "in_app",
    status: "unread",
  });

  if (process.env.RESEND_API_KEY) {
    try {
      const { data: userRecord } = await sb
        .from("users")
        .select("email, full_name")
        .eq("id", data.user_id)
        .maybeSingle();

      if (userRecord?.email) {
        await sendEmail(
          userRecord.email,
          data.title,
          `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#1A1D23">${esc(data.title)}</h2>
            <p style="color:#6B7080">${esc(data.body || '')}</p>
            <hr style="border:none;border-top:1px solid #E2E4E9;margin:24px 0">
            <p style="font-size:12px;color:#9CA0AB">Atllanta Business OS</p>
          </div>`
        );
      }
    } catch {}
  }
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
  return res.json();
}

export default async function handler(req, res) {
  // Vercel Cron calls with GET and sends CRON_SECRET as a bearer token.
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Use GET or POST" });
  }

  // Fail closed: this endpoint runs service-role recipes for every org, so it
  // must never be callable without the secret.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: "Server misconfigured: CRON_SECRET is not set" });
  }
  if ((req.headers.authorization || "") !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const sb = supabaseAdmin();

  // Rescue events stranded in 'processing' by a worker that died or whose
  // resolve_event call failed, and dead-letter any past their attempts.
  const { error: requeueError } = await sb.rpc("requeue_stale_events", {
    p_lease_seconds: 600,
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (requeueError) console.error("requeue_stale_events failed:", requeueError.message);

  const { data: events, error } = await sb
    .from("events")
    .select("*")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(BATCH_SIZE);

  if (error) return res.status(500).json({ error: error.message });
  if (!events?.length)
    return res.status(200).json({ processed: 0, failed: 0, skipped: 0, total: 0 });

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const event of events) {
    // Claim only if still pending. The browser processor claims through
    // claim_events(); whichever claims first runs the recipe, the other skips.
    const { data: claimed, error: claimError } = await sb
      .from("events")
      .update({ status: "processing", attempts: event.attempts + 1, locked_at: new Date().toISOString() })
      .eq("id", event.id)
      .eq("status", "pending")
      .eq("attempts", event.attempts)
      .select("id");

    if (claimError) {
      console.error("event claim failed:", event.id, claimError.message);
      skipped++;
      continue;
    }
    if (!claimed?.length) {
      skipped++;
      continue;
    }

    const recipe = recipes[event.event_type];
    try {
      // Tenant comes from the event row (stamped by publish_event), never from
      // the caller-supplied payload.
      if (recipe) await recipe(sb, { ...event, payload: { ...event.payload, org_id: event.org_id } });
      const { error: completeError } = await sb
        .from("events")
        .update({ status: "completed", processed_at: new Date().toISOString(), locked_at: null, last_error: null })
        .eq("id", event.id);
      if (completeError) console.error("event completion write failed:", event.id, completeError.message);
      processed++;
    } catch (err) {
      const newStatus = event.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending";
      const { error: failError } = await sb
        .from("events")
        .update({
          status: newStatus,
          locked_at: null,
          last_error: String(err?.message || err).slice(0, 500),
          ...(newStatus === "failed" ? { failed_at: new Date().toISOString() } : {}),
        })
        .eq("id", event.id);
      if (failError) console.error("event failure write failed:", event.id, failError.message);
      failed++;
    }
  }

  return res.status(200).json({ processed, failed, skipped, total: events.length });
}
