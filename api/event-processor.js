import { supabaseAdmin } from "../lib/supabaseServer.js";

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;

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

    const notifyIds = new Set();

    if (requester?.reporting_manager_id) {
      notifyIds.add(requester.reporting_manager_id);
    }

    if (days > 3) {
      const { data: hrUsers } = await sb
        .from("users")
        .select("id")
        .eq("org_id", org_id)
        .in("role", ["owner", "admin"]);
      (hrUsers || []).forEach((u) => notifyIds.add(u.id));
    }

    if (!notifyIds.size) {
      const { data: managers } = await sb
        .from("users")
        .select("id")
        .eq("org_id", org_id)
        .in("role", ["owner", "admin", "manager"]);
      (managers || []).forEach((u) => notifyIds.add(u.id));
    }

    notifyIds.delete(user_id);

    if (notifyIds.size) {
      const notifications = [...notifyIds].map((uid) => ({
        org_id,
        user_id: uid,
        title: "New leave request",
        body: `${name} has requested ${days} day${days !== 1 ? "s" : ""} of leave.`,
        module: "leave",
        entity_type: "leave_request",
        entity_id: leave_request_id,
        channel: "in_app",
        status: "unread",
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
    });
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
    });
  },

  "recruitment.candidate.shortlisted": async (sb, event) => {
    const { job_id, candidate_id, org_id, application_id } = event.payload;

    const [{ data: job }, { data: candidate }] = await Promise.all([
      sb.from("jobs").select("title, created_by").eq("id", job_id).single(),
      sb.from("candidates").select("full_name").eq("id", candidate_id).maybeSingle(),
    ]);

    const candidateName = candidate?.full_name || "A candidate";
    const jobTitle = job?.title || "a position";

    if (job?.created_by) {
      await createNotification(sb, {
        org_id,
        user_id: job.created_by,
        title: "Candidate shortlisted — schedule interview",
        body: `${candidateName} has been shortlisted for ${jobTitle}. Please schedule an interview.`,
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
        .filter((u) => u.id !== job?.created_by && u.id !== event.actor_id)
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
        channel: "in_app", status: "unread",
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
    });
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
      });
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
            }));
            await sb.from("notifications").insert(notifications);
          }
        }
      }
    }
  },
};

async function createNotification(sb, data) {
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
            <h2 style="color:#1A1D23">${data.title}</h2>
            <p style="color:#6B7080">${data.body || ''}</p>
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
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

  const authHeader = req.headers.authorization || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const sb = supabaseAdmin();

  const { data: events, error } = await sb
    .from("events")
    .select("*")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(BATCH_SIZE);

  if (error) return res.status(500).json({ error: error.message });
  if (!events?.length)
    return res.status(200).json({ processed: 0, message: "No pending events" });

  let processed = 0;
  let failed = 0;

  for (const event of events) {
    await sb
      .from("events")
      .update({ status: "processing", attempts: event.attempts + 1 })
      .eq("id", event.id);

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
      const newStatus =
        event.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending";
      await sb
        .from("events")
        .update({ status: newStatus })
        .eq("id", event.id);
      failed++;
    }
  }

  return res.status(200).json({ processed, failed, total: events.length });
}
