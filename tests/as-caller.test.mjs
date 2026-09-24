// actAsCaller/asOwner switch a Drizzle transaction's Postgres role so RLS
// applies to the signed-in caller instead of the pooler's postgres/BYPASSRLS
// login (see src/db/as-caller.ts). Every assertion here is about the exact
// statements executed: role switches must be transaction-local
// (`set local role`, never a session-level `set role`/`reset role`), and the
// caller id must reach Postgres only as a bound parameter, never spliced into
// SQL text.
// Run: node --test tests/

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { actAsCaller, asOwner } from '../src/db/as-caller.ts';
import { PgDialect } from 'drizzle-orm/pg-core';

const UUID = '11111111-1111-1111-1111-111111111111';
const VALID_CALLER = { id: UUID };

function createTx(calls) {
  return {
    async execute(query) {
      const { sql, params } = new PgDialect().sqlToQuery(query);
      calls.push({ sql, params });
      return undefined;
    },
  };
}

describe('actAsCaller', () => {
  let calls;

  beforeEach(() => {
    calls = [];
  });

  test('runs exactly two transaction-local statements in order', async () => {
    const tx = createTx(calls);
    await actAsCaller(tx, VALID_CALLER);
    assert.strictEqual(calls.length, 2);

    const [first, second] = calls;

    // first statement: set_config carrying the JWT claims
    assert.ok(/set_config/.test(first.sql), 'first sql should contain set_config');
    const expectedClaims = JSON.stringify({ sub: UUID, role: 'authenticated' });
    assert.ok(
      first.params.includes(expectedClaims),
      'first params should include the JWT claims JSON string'
    );

    // second statement: the transaction-local role switch
    assert.strictEqual(second.sql.trim().toLowerCase(), 'set local role authenticated');
  });

  test('the caller id reaches Postgres only as a bound parameter, never in SQL text', async () => {
    const tx = createTx(calls);
    await actAsCaller(tx, VALID_CALLER);
    assert.ok(
      calls.every((c) => !c.sql.includes(UUID)),
      'the UUID must never appear in rendered SQL text'
    );
  });

  test('every role statement is transaction-local, never a session-level set/reset role', async () => {
    const tx = createTx(calls);
    await actAsCaller(tx, VALID_CALLER);
    for (const c of calls) {
      const low = c.sql.toLowerCase();
      if (low.includes('role')) {
        assert.ok(low.includes('set local role'), `role statement must be set local role: ${c.sql}`);
      }
    }
  });

  test('rejects a caller with a non-UUID id and executes nothing', async () => {
    for (const bad of ['', 'abc', "x' or 1=1 --"]) {
      const tx = createTx(calls);
      await assert.rejects(() => actAsCaller(tx, { id: bad }), /signed-in caller/);
      assert.strictEqual(calls.length, 0, 'no statement should have run for an invalid caller id');
    }
  });
});

describe('asOwner', () => {
  let calls;

  beforeEach(() => {
    calls = [];
  });

  test('reverts to owner, runs the callback, then restores the caller role — and returns its value', async () => {
    const tx = createTx(calls);
    const callbackMarker = { sql: 'callback-marker', params: [] };

    const result = await asOwner(tx, async () => {
      calls.push(callbackMarker);
      return 123;
    });

    assert.strictEqual(result, 123);
    assert.strictEqual(calls.length, 3);

    const [first, middle, last] = calls;
    assert.strictEqual(first.sql.trim().toLowerCase(), 'set local role none');
    assert.deepEqual(middle, callbackMarker);
    assert.strictEqual(last.sql.trim().toLowerCase(), 'set local role authenticated');

    for (const c of calls) {
      const low = c.sql.toLowerCase();
      if (low.includes('role')) {
        assert.ok(low.includes('set local role'), `role statement must be set local role: ${c.sql}`);
      }
    }
  });

  test('still restores the caller role when the callback throws, and rethrows the same error', async () => {
    const tx = createTx(calls);
    const err = new Error('boom');

    await assert.rejects(
      () =>
        asOwner(tx, async () => {
          calls.push({ sql: 'callback-marker', params: [] });
          throw err;
        }),
      err
    );

    assert.strictEqual(calls.length, 3);

    const [first, middle, last] = calls;
    assert.strictEqual(first.sql.trim().toLowerCase(), 'set local role none');
    assert.deepEqual(middle, { sql: 'callback-marker', params: [] });
    assert.strictEqual(last.sql.trim().toLowerCase(), 'set local role authenticated');
  });
});
