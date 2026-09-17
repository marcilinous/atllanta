import sb from './supabase.js';
import { getOrg } from './auth.js';

export async function publishEvent(eventType, payload) {
  const org = getOrg();
  if (!org) return;

  // Events are written through a trusted RPC that stamps the actor (auth.uid())
  // and validates org membership server-side. The events table has no INSERT
  // policy, so a direct insert is rejected by RLS.
  const { error } = await sb.rpc('publish_event', {
    p_event_type: eventType,
    p_payload: payload ?? {},
    p_org_id: org.id,
  });

  if (error) console.error('Event publish failed:', error.message);
}
