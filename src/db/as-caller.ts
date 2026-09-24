// The Supabase transaction pooler (see src/db/index.ts) logs every Drizzle
// connection in as `postgres`, which has BYPASSRLS and owns these tables —
// so row-level security never applies to a query on this connection unless
// we explicitly switch role for it. Every switch below is transaction-local
// (`set local role`, and set_config's third argument `true`): the pooler
// hands the physical connection to other clients as soon as this transaction
// ends, so a session-level `SET ROLE` would leak this caller's identity onto
// someone else's query. `asOwner` exists only so the audit_logs insert
// (which deliberately has no RLS INSERT policy — see src/db/transaction.ts)
// can run as the privileged role for that one statement, then hand control
// straight back to the caller's role.

import { sql, type SQL } from "drizzle-orm";

export interface TxCaller {
  id: string;
}

// Minimal structural shape of a Drizzle transaction that these helpers need.
export interface CallerTx {
  execute(query: SQL): PromiseLike<unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function actAsCaller(tx: CallerTx, caller: TxCaller): Promise<void> {
  if (!UUID_RE.test(caller.id)) {
    throw new Error("withTransaction needs a signed-in caller");
  }

  const claims = JSON.stringify({ sub: caller.id, role: "authenticated" });
  await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
  await tx.execute(sql`set local role authenticated`);
}

export async function asOwner<T>(tx: CallerTx, fn: () => Promise<T>): Promise<T> {
  await tx.execute(sql`set local role none`);
  try {
    return await fn();
  } finally {
    await tx.execute(sql`set local role authenticated`);
  }
}
