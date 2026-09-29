// v1.9.1: attendance integrity. Before this, any member could mark a
// colleague present, rewrite their own check-in time, submit or approve
// their own regularisation, and create work schedules (confirmed on
// production in a rolled-back probe). These checks pin the migration; the
// same 16 scenarios were run against production with it applied inside an
// always-rolled-back transaction. Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'supabase', 'migrations');
const file = fs.readdirSync(dir).find((f) => f.endsWith('_attendance_integrity.sql'));
const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
const fn = (name) => sql.slice(sql.indexOf(`create or replace function public.${name}()`), sql.indexOf('$function$;', sql.indexOf(`create or replace function public.${name}()`)));

test('you can only check in yourself, now, as present', () => {
  assert.match(sql, /create policy att_insert on public\.attendance\s+for insert with check \(org_id = auth_org_id\(\) and user_id = auth\.uid\(\)\);/);
  const g = fn('attendance_guard');
  assert.match(g, /if auth\.uid\(\) is null then\s+return new;/, 'server code is exempt');
  assert.match(g, /abs\(extract\(epoch from \(new\.check_in - now\(\)\)\)\) > 900/);
  assert.match(g, /coalesce\(new\.status, 'present'\) <> 'present' or new\.check_out is not null/);
});

test('on your own row only the check-out changes, once, now', () => {
  const g = fn('attendance_guard');
  assert.match(g, /if old\.user_id = auth\.uid\(\) then/);
  for (const col of ['check_in', 'status', 'notes', 'check_in_location_id']) {
    assert.match(g, new RegExp(`new\\.${col} is distinct from old\\.${col}`), col);
  }
  assert.match(g, /if old\.check_out is not null then\s+raise exception 'You have already checked out'/);
  assert.match(g, /new\.check_out - now\(\)\)\)\) > 900/);
});

test('someone else\'s row: an owner\'s or admin\'s needs an admin; nothing moves between people or days', () => {
  const g = fn('attendance_guard');
  assert.match(g, /new\.user_id is distinct from old\.user_id\s+or new\.date is distinct from old\.date/);
  assert.match(g, /if v_owner_role in \('owner', 'admin'\) and not is_org_admin\(\) then/);
});

test('regularisations: your own attendance, pending; nobody approves their own; reviewer stamped', () => {
  assert.match(sql, /create policy attreg_insert[\s\S]*?and user_id = auth\.uid\(\)[\s\S]*?coalesce\(status, 'pending'\) = 'pending'[\s\S]*?exists \(select 1 from public\.attendance a where a\.id = attendance_id and a\.user_id = auth\.uid\(\)\)/);
  const g = fn('attendance_regularizations_guard');
  assert.match(g, /if old\.user_id = auth\.uid\(\) then\s+raise exception 'You cannot approve or reject your own regularisation'/);
  assert.match(g, /if v_requester_role in \('owner', 'admin'\) then\s+if not is_org_admin\(\) then/);
  assert.match(g, /new\.reviewed_by := auth\.uid\(\);\s+new\.reviewed_at := now\(\);/);
});

test('work schedules: owners and admins only', () => {
  for (const p of ['ws_insert', 'ws_update']) {
    const body = sql.slice(sql.indexOf(`create policy ${p} on public.work_schedules`)).split(';')[0];
    assert.match(body, /hr_can_configure\(\)/, p);
  }
});

test('the legacy check-in and check-out still fit the rules', () => {
  const dash = fs.readFileSync(path.join(ROOT, 'public', 'views', 'attendance', 'dashboard.js'), 'utf8');
  assert.match(dash, /user_id: user\.id, date: todayStr, check_in: now, status: 'present'/);
  assert.match(dash, /check_out: now\.toISOString\(\), total_hours:/);
  const me = fs.readFileSync(path.join(ROOT, 'public', 'views', 'me', 'index.js'), 'utf8');
  assert.match(me, /user_id: user\.id, date: todayStr, check_in: new Date\(\)\.toISOString\(\), status: 'present'/);
});
