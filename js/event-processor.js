import sb from './supabase.js';
import { getUser, getOrg } from './auth.js';

let processing = false;
let intervalId = null;
const POLL_INTERVAL = 30000;
const BATCH_SIZE = 20;

export function startEventProcessor() {
  if (intervalId) return;
  processEvents();
  intervalId = setInterval(processEvents, POLL_INTERVAL);
}

export function stopEventProcessor() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

async function processEvents() {
  if (processing) return;
  const user = getUser();
  const org = getOrg();
  if (!user || !org) return;

  processing = true;
  try {
    const { data: events, error } = await sb
      .from('events')
      .select('*')
      .eq('org_id', org.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (error || !events?.length) return;

    for (const event of events) {
      await processOne(event, org);
    }
  } catch (e) {
    console.error('Event processor error:', e);
  } finally {
    processing = false;
  }
}

async function processOne(event, org) {
  try {
    await sb.from('events').update({ status: 'processing' }).eq('id', event.id);

    const handler = HANDLERS[event.event_type];
    if (handler) {
      await handler(event.payload, org, event.actor_id);
    }

    await sb.from('events').update({
      status: 'completed',
      processed_at: new Date().toISOString(),
      attempts: (event.attempts || 0) + 1
    }).eq('id', event.id);
  } catch (e) {
    console.error(`Event ${event.event_type} failed:`, e);
    const attempts = (event.attempts || 0) + 1;
    await sb.from('events').update({
      status: attempts >= 3 ? 'failed' : 'pending',
      attempts
    }).eq('id', event.id);
  }
}

async function notify(orgId, userId, title, body, module, entityType, entityId) {
  if (!userId) return;
  await sb.from('notifications').insert({
    org_id: orgId,
    user_id: userId,
    title,
    body,
    module,
    entity_type: entityType || null,
    entity_id: entityId || null,
    channel: 'in_app',
    status: 'unread'
  });
}

async function notifyByRole(orgId, roles, title, body, module, entityType, entityId) {
  const { data: users } = await sb
    .from('users')
    .select('id')
    .eq('org_id', orgId)
    .in('role', roles)
    .eq('status', 'active');

  if (!users?.length) return;
  const rows = users.map(u => ({
    org_id: orgId,
    user_id: u.id,
    title,
    body,
    module,
    entity_type: entityType || null,
    entity_id: entityId || null,
    channel: 'in_app',
    status: 'unread'
  }));
  await sb.from('notifications').insert(rows);
}

async function getManager(userId) {
  const { data } = await sb
    .from('users')
    .select('reporting_manager_id')
    .eq('id', userId)
    .single();
  return data?.reporting_manager_id;
}

async function getUserName(userId) {
  if (!userId) return 'Someone';
  const { data } = await sb.from('users').select('full_name').eq('id', userId).single();
  return data?.full_name || 'Someone';
}

const HANDLERS = {

  'leave.request.created': async (p, org) => {
    const managerId = await getManager(p.user_id);
    const name = await getUserName(p.user_id);
    if (managerId) {
      await notify(org.id, managerId, 'New leave request', `${name} has applied for leave`, 'leave', 'leave_request', p.leave_request_id);
    }
    await notifyByRole(org.id, ['admin', 'owner'], 'New leave request', `${name} has applied for leave`, 'leave', 'leave_request', p.leave_request_id);
  },

  'leave.request.approved': async (p, org) => {
    const approverName = await getUserName(p.approved_by);
    await notify(org.id, p.user_id, 'Leave approved', `Your leave request was approved by ${approverName}`, 'leave', 'leave_request', p.leave_request_id);

    if (p.days && p.leave_type_id && p.user_id) {
      const year = new Date().getFullYear();
      const days = parseFloat(p.days) || 0;
      if (days > 0) {
        const { data: bal } = await sb
          .from('leave_balances')
          .select('id, used')
          .eq('user_id', p.user_id)
          .eq('leave_type_id', p.leave_type_id)
          .eq('year', year)
          .single();

        if (bal) {
          await sb.from('leave_balances').update({
            used: (parseFloat(bal.used) || 0) + days
          }).eq('id', bal.id);
        } else {
          await sb.from('leave_balances').insert({
            org_id: org.id,
            user_id: p.user_id,
            leave_type_id: p.leave_type_id,
            year,
            opening_balance: 0,
            accrued: 0,
            used: days
          });
        }
      }
    }
  },

  'leave.request.rejected': async (p, org) => {
    await notify(org.id, p.user_id, 'Leave rejected', 'Your leave request was rejected', 'leave', 'leave_request', p.leave_request_id);
  },

  'attendance.checkin.completed': async (p, org) => {
    const { data: schedule } = await sb
      .from('work_schedules')
      .select('shift_start')
      .eq('org_id', org.id)
      .eq('is_default', true)
      .single();

    if (!schedule) return;

    const checkTime = new Date(p.time || p.check_in_time);
    const [h, m] = schedule.shift_start.split(':').map(Number);
    const shiftStart = new Date(checkTime);
    shiftStart.setHours(h, m + 15, 0, 0);

    if (checkTime > shiftStart) {
      const today = new Date();
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
      const { count } = await sb
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', p.user_id)
        .eq('org_id', org.id)
        .eq('status', 'late')
        .gte('date', monthStart);

      if ((count || 0) >= 2) {
        const managerId = await getManager(p.user_id);
        const name = await getUserName(p.user_id);
        if (managerId) {
          await notify(org.id, managerId, 'Frequent late arrivals', `${name} has been late ${(count || 0) + 1} times this month`, 'attendance', 'user', p.user_id);
        }
      }
    }
  },

  'attendance.regularization.created': async (p, org) => {
    const managerId = await getManager(p.user_id);
    const name = await getUserName(p.user_id);
    if (managerId) {
      await notify(org.id, managerId, 'Regularization request', `${name} has requested attendance regularization`, 'attendance', 'attendance_regularization', p.regularization_id);
    }
  },

  'attendance.regularization.approved': async (p, org) => {
    await notify(org.id, p.user_id, 'Regularization approved', 'Your attendance regularization was approved', 'attendance', 'attendance_regularization', p.regularization_id);
  },

  'people.employee.created': async (p, org) => {
    const year = new Date().getFullYear();
    const { data: types } = await sb
      .from('leave_types')
      .select('id, annual_quota')
      .eq('org_id', org.id)
      .eq('is_active', true);

    if (types?.length) {
      const balances = types.map(t => ({
        org_id: org.id,
        user_id: p.employee_id,
        leave_type_id: t.id,
        year,
        opening_balance: 0,
        accrued: t.annual_quota || 0,
        used: 0
      }));
      await sb.from('leave_balances').insert(balances);
    }

    const managerId = await getManager(p.employee_id);
    if (managerId) {
      const name = p.name || await getUserName(p.employee_id);
      await notify(org.id, managerId, 'New team member', `${name} has joined your team`, 'people', 'user', p.employee_id);
    }

    await notifyByRole(org.id, ['admin', 'owner'], 'New employee added', `${p.name || 'A new employee'} has been added to the organization`, 'people', 'user', p.employee_id);
  },

  'recruitment.candidate.shortlisted': async (p, org) => {
    const { data: job } = await sb.from('jobs').select('title, created_by').eq('id', p.job_id).single();
    if (job?.created_by) {
      await notify(org.id, job.created_by, 'Candidate shortlisted', `A candidate has been shortlisted for ${job.title || 'a position'}`, 'recruitment', 'job_application', p.application_id);
    }
  },

  'helpdesk.ticket.created': async (p, org) => {
    const name = await getUserName(p.user_id);
    let notified = false;

    if (p.category_id) {
      const { data: handlers } = await sb
        .from('helpdesk_category_handlers')
        .select('user_id')
        .eq('category_id', p.category_id);

      if (handlers?.length) {
        const rows = handlers
          .filter(h => h.user_id !== p.user_id)
          .map(h => ({
            org_id: org.id,
            user_id: h.user_id,
            title: 'New helpdesk ticket',
            body: `${name} raised: ${p.title || p.subject || 'a new ticket'}`,
            module: 'helpdesk',
            entity_type: 'helpdesk_ticket',
            entity_id: p.ticket_id,
            channel: 'in_app',
            status: 'unread'
          }));
        if (rows.length) {
          await sb.from('notifications').insert(rows);
          notified = true;
        }
      }
    }

    if (!notified) {
      await notifyByRole(org.id, ['admin', 'owner'], 'New helpdesk ticket', `${name} raised: ${p.title || p.subject || 'a new ticket'}`, 'helpdesk', 'helpdesk_ticket', p.ticket_id);
    }
  },

  'helpdesk.ticket.updated': async (p, org) => {
    if (p.user_id && p.status) {
      await notify(org.id, p.user_id, 'Ticket updated', `Your helpdesk ticket has been ${p.status}`, 'helpdesk', 'helpdesk_ticket', p.ticket_id);
    }
  },

  'platform.announcement.created': async (p, org) => {
    const { data: users } = await sb
      .from('users')
      .select('id')
      .eq('org_id', org.id)
      .eq('status', 'active');

    if (users?.length) {
      const rows = users.map(u => ({
        org_id: org.id,
        user_id: u.id,
        title: 'New announcement',
        body: p.title || 'A new announcement has been posted',
        module: 'platform',
        entity_type: 'announcement',
        entity_id: null,
        channel: 'in_app',
        status: 'unread'
      }));
      await sb.from('notifications').insert(rows);
    }
  },

  'finance.expense.created': async (p, org) => {
    await notifyByRole(org.id, ['admin', 'owner'], 'New expense claim', `An expense of ${p.amount || '—'} has been submitted for approval`, 'finance', 'expense', p.expense_id);
  },

  'finance.expense.approved': async (p, org) => {
    if (p.user_id) {
      await notify(org.id, p.user_id, 'Expense approved', `Your expense claim has been approved`, 'finance', 'expense', p.expense_id);
    }
  },

  'recruitment.job.created': async (p, org) => {
    await notifyByRole(org.id, ['admin', 'owner'], 'New job posted', `A new position has been created: ${p.title || 'Untitled'}`, 'recruitment', 'job', null);
  },

  'people.employees.bulk_imported': async (p, org) => {
    await notifyByRole(org.id, ['admin', 'owner'], 'Bulk import complete', `${p.count || 0} employees were imported successfully`, 'people', null, null);
  },

  'recruitment.candidates.bulk_uploaded': async (p, org) => {
    await notifyByRole(org.id, ['admin', 'owner'], 'Resumes uploaded', `${p.count || 0} candidate resumes were uploaded`, 'recruitment', null, null);
  }
};
