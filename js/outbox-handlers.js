// Outbox job handlers — how each queued offline mutation is replayed.
//
// Imported once at app boot so a queued job flushes no matter which view is
// open when connectivity returns. Handlers must be idempotent: attendance rows
// carry a client-generated id and a unique(user_id, date) key, so re-running an
// insert as an upsert can't create duplicates.

import sb from './supabase.js';
import { registerHandler } from './outbox.js';
import { logAction } from './audit.js';
import { publishEvent } from './events.js';

const ATT_BUCKET = 'attendance-selfies';
const VISIT_BUCKET = 'visit-selfies';
const thumbOf = (p) => (p ? p.replace(/\.jpg$/, '_thumb.jpg') : p);

async function uploadPunchSelfie(orgId, attId, kind, blobs) {
  if (!blobs || !blobs.full) return null;
  const full = `${orgId}/${attId}_${kind}.jpg`;
  const a = await sb.storage.from(ATT_BUCKET).upload(full, blobs.full, { contentType: 'image/jpeg', upsert: true });
  if (blobs.thumb) {
    await sb.storage.from(ATT_BUCKET).upload(thumbOf(full), blobs.thumb, { contentType: 'image/jpeg', upsert: true });
  }
  return a.error ? null : full;
}

// Register all known handlers. Safe to call more than once.
export function registerOutboxHandlers() {
  registerHandler('attendance.checkin', async (payload, blobs) => {
    const { error } = await sb.from('attendance').upsert(payload.row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    const path = await uploadPunchSelfie(payload.row.org_id, payload.row.id, 'in', blobs);
    if (path) await sb.from('attendance').update({ check_in_selfie_path: path }).eq('id', payload.row.id);
    await logAction('attendance', 'attendance', payload.row.id, 'check_in', null,
      { date: payload.row.date, check_in: payload.row.check_in, queued_offline: true });
    await publishEvent('attendance.checkin.completed',
      { user_id: payload.row.user_id, org_id: payload.row.org_id, check_in_time: payload.row.check_in });
  });

  registerHandler('attendance.checkout', async (payload, blobs) => {
    const { error } = await sb.from('attendance').update(payload.updates).eq('id', payload.id);
    if (error) throw new Error(error.message);
    const path = await uploadPunchSelfie(payload.org_id, payload.id, 'out', blobs);
    if (path) await sb.from('attendance').update({ check_out_selfie_path: path }).eq('id', payload.id);
    await logAction('attendance', 'attendance', payload.id, 'check_out', null,
      { check_out: payload.updates.check_out, total_hours: payload.updates.total_hours, queued_offline: true });
  });

  registerHandler('crm.visit.logged', async (payload, blobs) => {
    const { error } = await sb.from('crm_visits').upsert(payload.row, { onConflict: 'id' });
    if (error) throw new Error(error.message);
    if (blobs && blobs.full) {
      const full = `${payload.row.org_id}/${payload.row.id}.jpg`;
      const a = await sb.storage.from(VISIT_BUCKET).upload(full, blobs.full, { contentType: 'image/jpeg', upsert: true });
      if (blobs.thumb) await sb.storage.from(VISIT_BUCKET).upload(thumbOf(full), blobs.thumb, { contentType: 'image/jpeg', upsert: true });
      if (!a.error) await sb.from('crm_visits').update({ selfie_path: full }).eq('id', payload.row.id);
    }
    await logAction('crm', 'visit', payload.row.id, 'logged', null,
      { account_id: payload.row.account_id, status: payload.row.visit_status, queued_offline: true });
    await publishEvent('crm.visit.logged',
      { visit_id: payload.row.id, account_id: payload.row.account_id, status: payload.row.visit_status });
  });
}
