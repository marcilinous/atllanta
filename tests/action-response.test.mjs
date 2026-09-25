// Every Server Action returns one shape (CLAUDE.md §6): valid input yields
// { success: true, data }, a Zod failure yields per-field messages, and an
// unexpected throw is logged server-side but reported generically.
// Run: node --test tests/

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { action, ok, fail, ActionError, ACTION_ERROR } from '../src/lib/actions.ts';

const schema = z.object({ email: z.string().email(), age: z.number().min(18) });

let logged;
const realError = console.error;
beforeEach(() => { logged = []; console.error = (...a) => logged.push(a); });
afterEach(() => { console.error = realError; });

describe('ok / fail', () => {
  test('ok carries the data', () => {
    assert.deepEqual(ok({ id: 'x' }), { success: true, data: { id: 'x' } });
  });

  test('fail omits fieldErrors when there are none', () => {
    assert.deepEqual(fail('nope'), { success: false, error: 'nope' });
    assert.deepEqual(fail('nope', { email: ['bad'] }), {
      success: false, error: 'nope', fieldErrors: { email: ['bad'] },
    });
  });
});

describe('action()', () => {
  test('runs the handler on valid input and wraps the result', async () => {
    const run = action(schema, async (input) => ({ saved: input.email }));
    assert.deepEqual(await run({ email: 'a@b.com', age: 30 }), {
      success: true, data: { saved: 'a@b.com' },
    });
  });

  test('turns Zod issues into per-field messages and never runs the handler', async () => {
    let ran = false;
    const run = action(schema, async () => { ran = true; });
    const r = await run({ email: 'not-an-email', age: 12 });
    assert.equal(r.success, false);
    assert.equal(r.error, 'Please check the highlighted fields.');
    assert.deepEqual(Object.keys(r.fieldErrors).sort(), ['age', 'email']);
    assert.ok(r.fieldErrors.email.length > 0);
    assert.equal(ran, false);
  });

  test('a form-level failure reports a message without fieldErrors', async () => {
    const run = action(z.string(), async (s) => s);
    const r = await run(42);
    assert.equal(r.success, false);
    assert.equal(r.fieldErrors, undefined);
    assert.ok(r.error.length > 0);
  });

  test('an ActionError reaches the user unchanged', async () => {
    const run = action(schema, async () => {
      throw new ActionError('This email is already a member', { email: ['taken'] });
    });
    assert.deepEqual(await run({ email: 'a@b.com', age: 30 }), {
      success: false, error: 'This email is already a member', fieldErrors: { email: ['taken'] },
    });
    assert.equal(logged.length, 0, 'an expected error is not logged as a crash');
  });

  test('an unexpected throw is logged but reported generically', async () => {
    const run = action(schema, async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.1:6543 password=hunter2');
    });
    const r = await run({ email: 'a@b.com', age: 30 });
    assert.deepEqual(r, { success: false, error: ACTION_ERROR });
    assert.equal(JSON.stringify(r).includes('hunter2'), false, 'no internals reach the client');
    assert.equal(logged[0][0], '[action]');
  });
});
