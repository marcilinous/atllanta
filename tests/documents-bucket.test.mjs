// The `documents` storage bucket (missing in production until this
// migration; every legacy upload targets it). Pins the access rules, which
// were run against production in an always-rolled-back transaction (12
// scenarios). Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'supabase', 'migrations');
const file = fs.readdirSync(dir).find((f) => f.endsWith('_documents_bucket.sql'));
const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
const policy = (name) => sql.slice(sql.indexOf(`create policy ${name} on storage.objects`)).split(';')[0];

test('a private bucket with a size limit', () => {
  assert.match(sql, /insert into storage\.buckets \(id, name, public, file_size_limit\)\s+values \('documents', 'documents', false, 10485760\)/);
});

test('every policy is for signed-in users and this bucket and folder only', () => {
  const names = [...sql.matchAll(/create policy (\w+) on storage\.objects/g)].map((m) => m[1]);
  assert.equal(names.length, 9);
  for (const n of names) {
    const p = policy(n);
    assert.match(p, /to authenticated/, n);
    assert.match(p, /bucket_id = 'documents' and split_part\(name, '\/', 1\) = '(leave-docs|expenses|employees)'/, n);
  }
});

test('leave documents: upload only into your own org and your own folder', () => {
  const p = policy('documents_leave_insert');
  assert.match(p, /storage_path_uuid\(split_part\(name, '\/', 2\)\) = auth_org_id\(\)/);
  assert.match(p, /storage_path_uuid\(split_part\(name, '\/', 3\)\) = auth\.uid\(\)/);
});

test('expense receipts: read by the uploader or an approver; employee documents managed by managers and up', () => {
  assert.match(policy('documents_expenses_read'), /\(owner = auth\.uid\(\) or hr_can_approve\(\)\)/);
  assert.match(policy('documents_employees_insert'), /hr_can_approve\(\)/);
  assert.match(policy('documents_employees_read'), /in \(select hr_visible_user_ids\(\)\)/);
});

test('a path segment that is not a uuid matches nothing, instead of erroring', () => {
  assert.match(sql, /exception when others then\s+return null;/);
});
