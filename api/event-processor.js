import { supabaseAdmin } from "../lib/supabaseServer.js";

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 3;

const recipes = {
  "people.employee.created": async (sb, event) => {
    const { employee_id, org_id } = event.payload;
    const { data: leaveTypes } = await sb
      .from("leave_types")
      .select("id")
      .eq("org_id", org_id)
      .eq("is_active", true);

    if (leaveTypes?.length) {
      const year = new Date().getFullYear();
      const balances = leaveTypes.map((lt) => ({
        org_id,
        user_id: employee_id,
        leave_type_id: lt.id,
        year,
        opening_balance: 0,
        accrued: 0,
        used: 0,
      }));
      await sb.from("leave_balances").upsert(balances, {
        onConflict: "user_id,leave_type_id,year",
      });
    }

    await createNotification(sb, {
      org_id,
      user_id: event.actor_id,
      title: "New employee added",
      body: `A new team member has been added to the organization.`,
      module: "people",
      entity_type: "employee",
      entity_id: employee_id,
    });
  },

  "leave.request.created": async (sb, event) => {
    const { leave_request_id, user_id, org_id } = event.payload;

    const { data: requester } = await sb
      .from("users")
      .select("full_name, email")
      .eq("id", user_id)
      .maybeSingle();

    const { data: managers } = await sb
      .from("users")
      .select("id")
      .eq("org_id", org_id)
      .in("role", ["owner", "admin", "manager"]);

    if (managers?.length) {
      const notifications = managers.map((m) => ({
        org_id,
        user_id: m.id,
        title: "New leave request",
        body: `${requester?.full_name || requester?.email || "An employee"} has requested leave.`,
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
      .single();

    if (balance) {
      await sb
        .from("leave_balances")
        .update({ used: (parseFloat(balance.used) || 0) + parseFloat(days) })
        .eq("id", balance.id);
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
    const { job_id, candidate_id, org_id } = event.payload;

    const { data: job } = await sb
      .from("jobs")
      .select("title, created_by")
      .eq("id", job_id)
      .single();

    if (job?.created_by) {
      await createNotification(sb, {
        org_id,
        user_id: job.created_by,
        title: "Candidate shortlisted",
        body: `A candidate has been shortlisted for ${job.title || "a position"}.`,
        module: "recruitment",
        entity_type: "job_application",
        entity_id: candidate_id,
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
