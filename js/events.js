import sb from './supabase.js';
import { getUser, getOrg } from './auth.js';

export async function publishEvent(eventType, payload) {
  const user = getUser();
  const org = getOrg();
  if (!org) return;

  const { error } = await sb.from('events').insert({
    org_id: org.id,
    event_type: eventType,
    actor_id: user?.id,
    payload,
    status: 'pending'
  });

  if (error) console.error('Event publish failed:', error.message);
}
