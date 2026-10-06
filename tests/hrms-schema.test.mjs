// Phase 4 item 1: src/db/schema/hrms.ts must describe the live HRMS tables
// exactly. LIVE below is the read-only snapshot taken on 2026-09-29 from
// information_schema (columns: name, udt type, nullable, has default) and the
// foreign keys with their ON DELETE rules. If the database changes, re-take
// the snapshot and update both.  Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as hrms from '../src/db/schema/hrms.ts';

// table -> [column, udt, nullable ('Y'|'N'), hasDefault (1|0)]
const LIVE = {
  announcements: [['id','uuid','N',1],['org_id','uuid','N',0],['author_id','uuid','N',0],['title','text','N',0],['body','text','N',0],['pinned','bool','Y',1],['created_at','timestamptz','Y',1],['updated_at','timestamptz','Y',1]],
  asset_assignments: [['id','uuid','N',1],['org_id','uuid','N',0],['asset_id','uuid','N',0],['user_id','uuid','N',0],['assigned_at','timestamptz','N',1],['returned_at','timestamptz','Y',0],['assigned_by','uuid','Y',0],['notes','text','Y',0]],
  assets: [['id','uuid','N',1],['org_id','uuid','N',0],['name','text','N',0],['type','text','N',1],['serial_number','text','Y',0],['purchase_date','date','Y',0],['purchase_cost','numeric','Y',0],['warranty_end','date','Y',0],['notes','text','Y',0],['status','text','N',1],['assigned_to','uuid','Y',0],['assigned_at','timestamptz','Y',0],['created_by','uuid','Y',0],['created_at','timestamptz','Y',1],['updated_at','timestamptz','Y',1]],
  attendance: [['id','uuid','N',1],['org_id','uuid','N',0],['user_id','uuid','N',0],['date','date','N',0],['check_in','timestamptz','Y',0],['check_out','timestamptz','Y',0],['check_in_lat','numeric','Y',0],['check_in_lng','numeric','Y',0],['check_out_lat','numeric','Y',0],['check_out_lng','numeric','Y',0],['status','text','Y',1],['total_hours','numeric','Y',0],['notes','text','Y',0],['created_at','timestamptz','Y',1],['check_in_selfie_path','text','Y',0],['check_out_selfie_path','text','Y',0],['check_in_location_id','uuid','Y',0],['check_out_location_id','uuid','Y',0]],
  attendance_regularizations: [['id','uuid','N',1],['org_id','uuid','N',0],['user_id','uuid','N',0],['attendance_id','uuid','N',0],['reason','text','N',0],['requested_check_in','timestamptz','Y',0],['requested_check_out','timestamptz','Y',0],['status','text','Y',1],['reviewed_by','uuid','Y',0],['reviewed_at','timestamptz','Y',0],['created_at','timestamptz','Y',1]],
  expense_categories: [['id','uuid','N',1],['org_id','uuid','N',0],['name','text','N',0],['code','text','N',0],['description','text','Y',0],['spending_limit','numeric','Y',0],['is_active','bool','Y',1],['created_at','timestamptz','Y',1]],
  expenses: [['id','uuid','N',1],['org_id','uuid','N',0],['user_id','uuid','N',0],['category_id','uuid','Y',0],['title','text','N',0],['amount','numeric','N',0],['currency','text','Y',1],['expense_date','date','N',0],['receipt_url','text','Y',0],['description','text','Y',0],['status','text','Y',1],['reviewed_by','uuid','Y',0],['reviewed_at','timestamptz','Y',0],['review_comment','text','Y',0],['reimbursed_at','timestamptz','Y',0],['created_at','timestamptz','Y',1],['updated_at','timestamptz','Y',1]],
  holidays: [['id','uuid','N',1],['org_id','uuid','N',0],['name','text','N',0],['date','date','N',0],['is_optional','bool','Y',1],['year','int4','N',0],['created_at','timestamptz','Y',1]],
  leave_balances: [['id','uuid','N',1],['org_id','uuid','N',0],['user_id','uuid','N',0],['leave_type_id','uuid','N',0],['year','int4','N',0],['opening_balance','numeric','Y',1],['accrued','numeric','Y',1],['used','numeric','Y',1],['balance','numeric','Y',0]],
  leave_requests: [['id','uuid','N',1],['org_id','uuid','N',0],['user_id','uuid','N',0],['leave_type_id','uuid','N',0],['start_date','date','N',0],['end_date','date','N',0],['days','numeric','N',0],['reason','text','Y',0],['document_url','text','Y',0],['status','text','Y',1],['reviewed_by','uuid','Y',0],['reviewed_at','timestamptz','Y',0],['review_comment','text','Y',0],['created_at','timestamptz','Y',1]],
  leave_types: [['id','uuid','N',1],['org_id','uuid','N',0],['name','text','N',0],['code','text','N',0],['annual_quota','int4','N',1],['carry_forward','bool','Y',1],['max_carry_forward','int4','Y',1],['max_consecutive_days','int4','Y',0],['requires_document','bool','Y',1],['is_paid','bool','Y',1],['is_active','bool','Y',1],['created_at','timestamptz','Y',1]],
  posts: [['id','uuid','N',1],['org_id','uuid','N',0],['author_id','uuid','N',0],['content','text','N',0],['type','text','N',1],['pinned','bool','Y',1],['reactions','jsonb','Y',1],['created_at','timestamptz','Y',1],['updated_at','timestamptz','Y',1]],
  work_locations: [['id','uuid','N',1],['org_id','uuid','N',0],['name','text','N',0],['address','text','Y',0],['lat','numeric','N',0],['lng','numeric','N',0],['radius_m','int4','N',1],['is_active','bool','N',1],['created_by','uuid','Y',0],['created_at','timestamptz','N',1]],
  work_schedules: [['id','uuid','N',1],['org_id','uuid','N',0],['name','text','N',0],['shift_start','time','N',1],['shift_end','time','N',1],['weekly_offs','_int4','Y',1],['is_default','bool','Y',1],['created_at','timestamptz','Y',1]],
};

// "table.column -> ref_table ON DELETE rule"
const LIVE_FKS = [
  'announcements.author_id -> users no action', 'announcements.org_id -> organizations no action',
  'asset_assignments.asset_id -> assets cascade', 'asset_assignments.assigned_by -> users no action',
  'asset_assignments.org_id -> organizations no action', 'asset_assignments.user_id -> users no action',
  'assets.assigned_to -> users no action', 'assets.created_by -> users no action', 'assets.org_id -> organizations no action',
  'attendance.check_in_location_id -> work_locations set null', 'attendance.check_out_location_id -> work_locations set null',
  'attendance.org_id -> organizations cascade', 'attendance.user_id -> users no action',
  'attendance_regularizations.attendance_id -> attendance cascade', 'attendance_regularizations.org_id -> organizations cascade',
  'attendance_regularizations.user_id -> users no action',
  'expense_categories.org_id -> organizations no action',
  'expenses.category_id -> expense_categories no action', 'expenses.org_id -> organizations no action',
  'expenses.reviewed_by -> users no action', 'expenses.user_id -> users no action',
  'holidays.org_id -> organizations cascade',
  'leave_balances.leave_type_id -> leave_types cascade', 'leave_balances.org_id -> organizations cascade',
  'leave_balances.user_id -> users no action',
  'leave_requests.leave_type_id -> leave_types no action', 'leave_requests.org_id -> organizations cascade',
  'leave_requests.user_id -> users no action',
  'leave_types.org_id -> organizations cascade', 'posts.org_id -> organizations cascade',
  'work_locations.org_id -> organizations cascade', 'work_schedules.org_id -> organizations cascade',
].sort();

// Drizzle's SQL type -> Postgres udt_name.
const UDT = { uuid: 'uuid', text: 'text', boolean: 'bool', integer: 'int4', numeric: 'numeric',
  'timestamp with time zone': 'timestamptz', date: 'date', time: 'time', jsonb: 'jsonb', 'integer[]': '_int4' };

const tables = Object.values(hrms).filter((v) => v && typeof v === 'object' && Symbol.for('drizzle:Name') in v);
const configs = tables.map((t) => getTableConfig(t));

test('declares exactly the 14 live HRMS tables', () => {
  assert.deepEqual(configs.map((c) => c.name).sort(), Object.keys(LIVE).sort());
});

for (const [name, cols] of Object.entries(LIVE)) {
  test(`${name}: columns, types, nullability and defaults match the live table`, () => {
    const cfg = configs.find((c) => c.name === name);
    const declared = cfg.columns.map((c) => [
      c.name,
      UDT[c.getSQLType()] ?? c.getSQLType(),
      c.notNull ? 'N' : 'Y',
      c.hasDefault && !c.generated ? 1 : 0,
    ]);
    // Compare as sets of rows: column order in Drizzle is declaration order.
    const key = (r) => r.join('|');
    assert.deepEqual(declared.map(key).sort(), cols.map(key).sort());
  });
}

test('foreign keys and their ON DELETE rules match the live database (32)', () => {
  const declared = configs.flatMap((cfg) =>
    cfg.foreignKeys.map((fk) => {
      const ref = fk.reference();
      const refTable = getTableConfig(ref.foreignTable).name;
      return `${cfg.name}.${ref.columns[0].name} -> ${refTable} ${fk.onDelete ?? 'no action'}`;
    })
  ).sort();
  assert.equal(declared.length, 32);
  assert.deepEqual(declared, LIVE_FKS);
});

test('leave_balances.balance is generated, never written', () => {
  const cfg = configs.find((c) => c.name === 'leave_balances');
  const balance = cfg.columns.find((c) => c.name === 'balance');
  assert.ok(balance.generated, 'balance must be declared as generated');
});

test('the live unique constraints are declared', () => {
  const uniques = configs.flatMap((cfg) => cfg.uniqueConstraints.map((u) => `${cfg.name}:${u.columns.map((c) => c.name).join(',')}`)).sort();
  assert.deepEqual(uniques, [
    'attendance:user_id,date',
    'expense_categories:org_id,code',
    'leave_balances:user_id,leave_type_id,year',
    'leave_types:org_id,code',
  ]);
});

test('status lists equal the live CHECK constraints', () => {
  assert.deepEqual([...hrms.LEAVE_REQUEST_STATUSES], ['pending', 'approved', 'rejected', 'cancelled']);
  assert.deepEqual([...hrms.EXPENSE_STATUSES], ['pending', 'approved', 'rejected', 'reimbursed']);
  assert.deepEqual([...hrms.ATTENDANCE_STATUSES], ['present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'weekly_off']);
  const checks = configs.flatMap((cfg) => cfg.checks.map((c) => c.name)).sort();
  assert.deepEqual(checks, [
    'assets_status_check', 'assets_type_check', 'attendance_regularizations_status_check',
    'attendance_status_check', 'expenses_amount_positive', 'expenses_status_check', 'leave_requests_status_check',
    'posts_type_check',
  ]);
});
