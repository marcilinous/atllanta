// Event and audit writes must go through the SECURITY DEFINER RPCs.
// events and audit_logs have no INSERT policy, so a direct insert is
// rejected by RLS and the row is silently lost.  Run: node --test tests/
//
// js/events.js and js/audit.js import ./supabase.js (CDN + window) and
// ./auth.js, so both are copied next to stubs and imported from there.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let tmp, stub, events, audit;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-writes-'));
  fs.writeFileSync(path.join(tmp, 'supabase.js'), `
    export const calls = [];
    export default {
      rpc(name, args) { calls.push({ kind: 'rpc', name, args }); return Promise.resolve({ data: 'row-id', error: null }); },
      from(table) {
        calls.push({ kind: 'from', table });
        return { insert() { return Promise.resolve({ error: null }); } };
      },
    };
  `);
  fs.writeFileSync(path.join(tmp, 'auth.js'), `
    export function getUser() { return { id: 'user-1' }; }
    export function getOrg() { return { id: 'org-1' }; }
  `);
  for (const f of ['events.js', 'audit.js']) {
    fs.copyFileSync(path.join(ROOT, 'js', f), path.join(tmp, f));
  }
  stub = await import(pathToFileURL(path.join(tmp, 'supabase.js')).href);
  events = await import(pathToFileURL(path.join(tmp, 'events.js')).href);
  audit = await import(pathToFileURL(path.join(tmp, 'audit.js')).href);
});

after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => { stub.calls.length = 0; });

describe('publishEvent', () => {
  test('calls publish_event with the org and payload', async () => {
    await events.publishEvent('leave.request.created', { leave_request_id: 'lr-1' });
    assert.deepEqual(stub.calls, [{
      kind: 'rpc', name: 'publish_event',
      args: { p_event_type: 'leave.request.created', p_payload: { leave_request_id: 'lr-1' }, p_org_id: 'org-1' },
    }]);
  });

  test('sends an empty object when there is no payload', async () => {
    await events.publishEvent('platform.ping');
    assert.deepEqual(stub.calls[0].args.p_payload, {});
  });

  test('never inserts into events directly', async () => {
    await events.publishEvent('x.y.z', {});
    assert.equal(stub.calls.some(c => c.kind === 'from'), false);
  });
});

describe('logAction', () => {
  test('calls log_audit with every field', async () => {
    await audit.logAction('people', 'user', 'u-9', 'update', { a: 1 }, { a: 2 });
    assert.deepEqual(stub.calls, [{
      kind: 'rpc', name: 'log_audit',
      args: { p_module: 'people', p_entity_type: 'user', p_entity_id: 'u-9', p_action: 'update', p_old: { a: 1 }, p_new: { a: 2 }, p_org_id: 'org-1' },
    }]);
  });

  test('passes null for missing old/new values', async () => {
    await audit.logAction('crm', 'lead', 'l-1', 'delete');
    assert.equal(stub.calls[0].args.p_old, null);
    assert.equal(stub.calls[0].args.p_new, null);
  });
});
