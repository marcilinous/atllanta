import sb from './supabase.js';
import { getUser } from './auth.js';

let unreadCount = 0;
let onCountChange = null;
let onNew = null;
let realtimeChannel = null;

export function onUnreadChange(callback) {
  onCountChange = callback;
}

// Fired with the new notification row whenever one arrives over realtime.
export function onNewNotification(callback) {
  onNew = callback;
}

// Resolve a notification to the in-app route that best lets the recipient act
// on or view it. Outcome notices ("… approved/rejected", "Your …") point at
// the recipient's own pages; action-required ones point at the Inbox.
export function notifTarget(n) {
  const id = n.entity_id;
  const isOutcome = /approv|reject|your\b|updated/i.test(n.title || '');

  switch (n.entity_type) {
    case 'job': return id ? `recruitment/job?id=${id}` : 'recruitment';
    case 'candidate': return id ? `recruitment/candidate?id=${id}` : 'recruitment';
    case 'job_application': return 'recruitment';
    case 'employee':
    case 'user': return id ? `employees/profile?id=${id}` : 'employees';
    case 'leave_request': return isOutcome ? 'leave/balances' : 'inbox';
    case 'attendance_regularization': return isOutcome ? 'attendance/report' : 'inbox';
    case 'attendance': return 'attendance/report';
    case 'expense': return 'finance';
    case 'helpdesk_ticket': return 'helpdesk';
    case 'announcement': return 'announcements';
    case 'opportunity': return 'crm/opportunities';
    case 'lead': return 'crm/leads';
    case 'account': return id ? `crm/account?id=${id}` : 'crm/accounts';
    case 'contact': return 'crm/contacts';
  }

  switch (n.module) {
    case 'leave': return isOutcome ? 'leave/balances' : 'inbox';
    case 'attendance': return 'attendance/report';
    case 'recruitment': return 'recruitment';
    case 'people': return 'employees';
    case 'finance': return 'finance';
    case 'helpdesk': return 'helpdesk';
    case 'platform': return 'announcements';
    case 'crm': return 'crm';
    default: return 'dashboard';
  }
}

export async function fetchUnreadCount() {
  const user = getUser();
  if (!user) return 0;

  const { count, error } = await sb
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('status', 'unread');

  if (error) return unreadCount;
  unreadCount = count || 0;
  if (onCountChange) onCountChange(unreadCount);
  return unreadCount;
}

export async function fetchNotifications(limit = 20) {
  const user = getUser();
  if (!user) return [];

  const { data, error } = await sb
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('sent_at', { ascending: false })
    .limit(limit);

  if (error) return [];
  return data || [];
}

export async function markRead(id) {
  const { error } = await sb.from('notifications').update({ status: 'read' }).eq('id', id);
  if (!error) await fetchUnreadCount();
}

export async function markAllRead() {
  const user = getUser();
  if (!user) return;
  const { error } = await sb.from('notifications').update({ status: 'read' }).eq('user_id', user.id).eq('status', 'unread');
  if (!error) await fetchUnreadCount();
}

export function subscribeRealtime() {
  const user = getUser();
  if (!user || realtimeChannel) return;

  realtimeChannel = sb
    .channel('notifications-realtime')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
      (payload) => {
        unreadCount++;
        if (onCountChange) onCountChange(unreadCount);
        if (onNew) onNew(payload.new);
      }
    )
    .subscribe();
}

export function unsubscribeRealtime() {
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}
