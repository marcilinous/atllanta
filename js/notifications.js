import sb from './supabase.js';
import { getUser } from './auth.js';

let unreadCount = 0;
let onCountChange = null;

export function onUnreadChange(callback) {
  onCountChange = callback;
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
