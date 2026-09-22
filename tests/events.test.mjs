// The event bus goes through the database's security-definer RPCs: publishing
// never inserts directly (the events table has no INSERT policy), and draining
// claims, runs subscribers, then resolves each event.
// Run: node --test tests/

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { publishEvent } from '../src/lib/events/publish.ts';
import { drainEvents, subscribers } from '../src/lib/events/drain.ts';

let logged;
const realError = console.error;
beforeEach(() => { logged = []; console.error = (...a) => logged.push(a); });
afterEach(() => {
  console.error = realError;
  for (const k of Object.keys(subscribers)) delete subscribers[k];
});

// Records every rpc call; `replies` maps fn name -> {data, error}.
function client(replies = {}) {
  const calls = [];
  return {
    calls,
    async rpc(fn, args) {
      calls.push({ fn, args });
      const r = replies[fn];
      return typeof r === 'function' ? r(args) : (r ?? { data: null, error: null });
    },
  };
}

const event = (over = {}) => ({
  id: 'e-1', org_id: 'org-1', event_type: 'people.employee.updated',
  payload: { employee_id: 'u-1' }, attempts: 1, ...over,
});

describe('publishEvent', () => {
  test('publishes through the publish_event RPC and returns the new id', async () => {
    const c = client({ publish_event: { data: 'evt-123', error: null } });
    const r = await publishEvent(c, { eventType: 'people.employee.updated', orgId: 'org-1', payload: { a: 1 } });
    assert.deepEqual(r, { success: true, data: 'evt-123' });
    assert.deepEqual(c.calls[0], {
      fn: 'publish_event',
      args: { p_event_type: 'people.employee.updated', p_payload: { a: 1 }, p_org_id: 'org-1' },
    });
  });

  test('defaults the payload to an empty object', async () => {
    const c = client({ publish_event: { data: 'evt-1', error: null } });
    await publishEvent(c, { eventType: 'x.y.z', orgId: 'org-1' });
    assert.deepEqual(c.calls[0].args.p_payload, {});
  });

  test('refuses a blank event type or org without calling the database', async () => {
    const c = client();
    assert.equal((await publishEvent(c, { eventType: '  ', orgId: 'org-1' })).success, false);
    assert.equal((await publishEvent(c, { eventType: 'x.y.z', orgId: ' ' })).success, false);
    assert.equal(c.calls.length, 0);
  });

  test('reports an RPC error generically and logs the detail', async () => {
    const c = client({ publish_event: { data: null, error: { message: 'permission denied for org 42' } } });
    const r = await publishEvent(c, { eventType: 'x.y.z', orgId: 'org-1' });
    assert.equal(r.success, false);
    assert.equal(r.error.includes('permission denied'), false);
    assert.equal(logged[0][0], '[events] publish failed');
  });

  test('treats a missing event id as a failure', async () => {
    const c = client({ publish_event: { data: null, error: null } });
    assert.equal((await publishEvent(c, { eventType: 'x.y.z', orgId: 'org-1' })).success, false);
  });
});

describe('drainEvents', () => {
  test('claims a batch and completes events that have no subscribers', async () => {
    const c = client({ claim_events: { data: [event(), event({ id: 'e-2' })], error: null } });
    const r = await drainEvents(c, 5);
    assert.deepEqual(r, { success: true, data: { claimed: 2, completed: 2, failed: 0 } });
    assert.deepEqual(c.calls[0], { fn: 'claim_events', args: { batch_size: 5 } });
    assert.deepEqual(c.calls[1], { fn: 'resolve_event', args: { event_id: 'e-1', new_status: 'completed' } });
  });

  test('runs a subscriber for its own event type only', async () => {
    const seen = [];
    subscribers['people.employee.updated'] = [async (e) => { seen.push(e.id); }];
    subscribers['crm.lead.created'] = [async () => { throw new Error('must not run'); }];
    const c = client({ claim_events: { data: [event()], error: null } });
    const r = await drainEvents(c);
    assert.deepEqual(seen, ['e-1']);
    assert.deepEqual(r.data, { claimed: 1, completed: 1, failed: 0 });
  });

  test('a throwing subscriber fails that event with a truncated reason', async () => {
    subscribers['people.employee.updated'] = [async () => { throw new Error('x'.repeat(900)); }];
    const c = client({ claim_events: { data: [event()], error: null } });
    const r = await drainEvents(c);
    assert.deepEqual(r.data, { claimed: 1, completed: 1 - 1, failed: 1 });
    const resolve = c.calls.find((x) => x.fn === 'resolve_event');
    assert.equal(resolve.args.new_status, 'failed');
    assert.equal(resolve.args.p_error.length, 500);
    assert.equal(logged[0][0], '[events] handler failed');
  });

  test('reports a claim failure generically', async () => {
    const c = client({ claim_events: { data: null, error: { message: 'deadlock detected' } } });
    const r = await drainEvents(c);
    assert.equal(r.success, false);
    assert.equal(r.error.includes('deadlock'), false);
  });

  test('an empty or unexpected claim result drains nothing', async () => {
    const c = client({ claim_events: { data: null, error: null } });
    assert.deepEqual((await drainEvents(c)).data, { claimed: 0, completed: 0, failed: 0 });
  });

  test('skips rows that are not shaped like events', async () => {
    const c = client({ claim_events: { data: [{ id: 'e-9' }, event()], error: null } });
    assert.deepEqual((await drainEvents(c)).data, { claimed: 1, completed: 1, failed: 0 });
  });
});
