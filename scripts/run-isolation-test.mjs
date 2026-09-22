// Runs the two-org isolation test (Phase 1 item 3) against the LOCAL Supabase:
//   npx supabase start        # once; Docker Desktop must be running
//   npm run test:isolation
//
// Everything happens inside one transaction that is always rolled back, so the
// local database keeps whatever else is in it, and the test can never touch
// production: the connection string below is the CLI's fixed local one.
//
// Exit code 1 on any failed assertion, so CI can run it unattended.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_DB = process.env.LOCAL_SUPABASE_DB_URL
  ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

if (!/(127\.0\.0\.1|localhost)/.test(LOCAL_DB)) {
  console.error('Refusing to run: this test only runs against a local database.');
  process.exit(1);
}

const schema = fs.readFileSync(path.join(ROOT, 'supabase/local/platform-schema.sql'), 'utf8');
const suite = fs.readFileSync(path.join(ROOT, 'supabase/tests/platform_tenant_isolation.test.sql'), 'utf8');

const sql = postgres(LOCAL_DB, { max: 1, onnotice: () => {} });

try {
  // postgres.js commits when the callback resolves, so the callback always
  // throws: the schema and fixtures must never outlive the run.
  const ROLLBACK = Symbol('rollback');
  let rows;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(schema);
      rows = await tx.unsafe(suite);
      const abort = new Error('rollback');
      abort.marker = ROLLBACK;
      throw abort;
    });
  } catch (err) {
    if (err?.marker !== ROLLBACK) throw err;
  }

  // A multi-statement script resolves to one Result per statement; the suite's
  // last SELECT is the verdict. Flatten and take the last row that carries it.
  const flat = (Array.isArray(rows) ? rows.flat() : [rows]).filter(Boolean);
  const result = flat.map((r) => r?.result).filter(Boolean).at(-1);
  if (result !== 'all platform isolation tests passed') {
    console.error('Isolation test did not report success:', result ?? rows);
    process.exit(1);
  }
  console.log(result);
} catch (err) {
  console.error('Isolation test failed:', err.message ?? err);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
