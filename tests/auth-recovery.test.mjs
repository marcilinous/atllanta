// Phase 2 item 3: server-side recovery-token verification.
// Run: node --test tests/

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { recoveryTokenSchema } from '../src/lib/auth/schemas.ts';
import { verifyRecoveryToken, RECOVERY_REDIRECT, RECOVERY_LINK_INVALID } from '../src/lib/auth/recovery.ts';
import { ActionError } from '../src/lib/actions.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('recoveryTokenSchema', () => {
  test('accepts a normal hex-looking token', () => {
    assert.equal(recoveryTokenSchema.safeParse({ tokenHash: 'a1b2c3d4e5f6' }).success, true);
  });

  test('accepts a token prefixed "pkce_" with url-safe characters', () => {
    assert.equal(recoveryTokenSchema.safeParse({ tokenHash: 'pkce_abcDEF123-_45' }).success, true);
  });

  test('rejects an empty string', () => {
    assert.equal(recoveryTokenSchema.safeParse({ tokenHash: '' }).success, false);
  });

  test('rejects a whitespace-only string', () => {
    assert.equal(recoveryTokenSchema.safeParse({ tokenHash: '   ' }).success, false);
  });

  test('rejects a string longer than 512 characters', () => {
    assert.equal(recoveryTokenSchema.safeParse({ tokenHash: 'a'.repeat(513) }).success, false);
  });

  test('rejects a token containing a slash', () => {
    assert.equal(recoveryTokenSchema.safeParse({ tokenHash: 'abc/def' }).success, false);
  });

  test('rejects a token containing a question mark', () => {
    assert.equal(recoveryTokenSchema.safeParse({ tokenHash: 'abc?def' }).success, false);
  });

  test('rejects a token containing a space', () => {
    assert.equal(recoveryTokenSchema.safeParse({ tokenHash: 'abc def' }).success, false);
  });
});

function fakeClient(reply) {
  const calls = [];
  return {
    calls,
    auth: {
      async verifyOtp(params) {
        calls.push(params);
        return reply;
      },
    },
  };
}

describe('verifyRecoveryToken', () => {
  test('calls verifyOtp with exactly { type: "recovery", token_hash }', async () => {
    const client = fakeClient({ error: null });
    await verifyRecoveryToken(client, 'tok-123');
    assert.deepEqual(client.calls, [{ type: 'recovery', token_hash: 'tok-123' }]);
  });

  test('returns { next: RECOVERY_REDIRECT } when verifyOtp succeeds', async () => {
    const client = fakeClient({ error: null });
    const result = await verifyRecoveryToken(client, 'tok-123');
    assert.deepEqual(result, { next: RECOVERY_REDIRECT });
  });

  test('throws an ActionError with RECOVERY_LINK_INVALID when verifyOtp errors', async () => {
    const client = fakeClient({ error: { message: 'Token has expired or is invalid' } });
    await assert.rejects(
      () => verifyRecoveryToken(client, 'tok-123'),
      (err) => {
        assert.ok(err instanceof ActionError);
        assert.equal(err.message, RECOVERY_LINK_INVALID);
        assert.equal(err.message.includes('tok-123'), false, 'the token must never appear in the error');
        return true;
      }
    );
  });
});

describe('public/reset-password.html', () => {
  const html = readFileSync(path.join(__dirname, '../public/reset-password.html'), 'utf8');

  test('imports the shared cookie-based client', () => {
    assert.ok(html.includes("from '/js/supabase.js'"));
  });

  test('no longer creates its own supabase-js client', () => {
    assert.equal(html.includes('createClient('), false);
  });

  test('no longer loads supabase-js from the CDN', () => {
    assert.equal(html.includes('supabase-js@'), false);
  });
});
