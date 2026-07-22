import sb from './supabase.js';
import { getUser, getOrg } from './auth.js';

export async function logAction(module, entityType, entityId, action, oldValues, newValues) {
  const user = getUser();
  const org = getOrg();
  if (!org) return;

  const { error } = await sb.from('audit_logs').insert({
    org_id: org.id,
    user_id: user?.id,
    module,
    entity_type: entityType,
    entity_id: entityId,
    action,
    old_values: oldValues || null,
    new_values: newValues || null,
  });

  if (error) console.error('Audit log failed:', error.message);
}
