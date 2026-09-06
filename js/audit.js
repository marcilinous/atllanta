import sb from './supabase.js';
import { getOrg } from './auth.js';

export async function logAction(module, entityType, entityId, action, oldValues, newValues) {
  const org = getOrg();
  if (!org) return;

  // Audit rows are written through a trusted RPC that stamps the actor
  // (auth.uid()) and validates org membership server-side, so the actor and
  // tenant on an audit record can't be forged. The log stays append-only.
  const { error } = await sb.rpc('log_audit', {
    p_module: module,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_action: action,
    p_old: oldValues || null,
    p_new: newValues || null,
    p_org_id: org.id,
  });

  if (error) console.error('Audit log failed:', error.message);
}
