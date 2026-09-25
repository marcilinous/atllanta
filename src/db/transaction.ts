// Every platform mutation writes its row and its audit_logs row together or
// not at all — a rename that lands without an audit entry (or an audit entry
// for a write that got rolled back) is worse than a mutation that fails
// outright. withTransaction is the one place that owns that guarantee:
// callers never reach for getDb().transaction(...) themselves, so there is
// exactly one code path that can commit a platform write.
//
// withTransaction also runs the whole transaction as the signed-in caller
// (see src/db/as-caller.ts): before `fn` runs, it sets the transaction-local
// role to `authenticated` and the transaction-local `request.jwt.claims`, so
// Postgres RLS — not application code — decides what every query inside
// `fn` can see or change.
//
// audit_logs deliberately has no RLS INSERT policy (clients must not be able
// to forge audit history), so the `audit` callback handed to `fn` is the only
// way to write an audit row: it briefly reverts to the owning role for that
// one insert (via asOwner) and always stamps `userId` from the verified
// caller, never from whatever the entry itself contains.
//
// A raw driver error can carry the connection string, SQL text or row
// contents (see src/db/index.ts) — none of that belongs in front of a
// caller. Anything unexpected is logged server-side with a `[db]` prefix and
// rethrown as a generic message. An `ActionError` thrown inside `fn` is
// already a message the user is meant to read (e.g. an RLS-filtered update
// that touched zero rows), so it passes through unchanged instead of being
// flattened into the generic one.
import "server-only";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getDb } from "./index";
import * as platformSchema from "./schema/platform";
import { auditLogs } from "./schema/platform";
import { ActionError } from "../lib/actions";
import { actAsCaller, asOwner, type TxCaller } from "./as-caller";

type Db = PostgresJsDatabase<typeof platformSchema>;

/** The transaction object Drizzle hands to a `db.transaction(...)` callback, scoped to the platform schema. */
export type PlatformTx = Parameters<Db["transaction"]>[0] extends (tx: infer Tx) => unknown
  ? Tx
  : never;

/** An audit_logs row, minus the columns the transaction owns: `id`, `createdAt` (both server-generated) and `userId` (always the verified caller, never the entry). */
export type AuditEntry = Omit<typeof auditLogs.$inferInsert, "id" | "userId" | "createdAt">;
export type AuditFn = (entry: AuditEntry) => Promise<void>;

export async function withTransaction<T>(
  caller: TxCaller,
  fn: (tx: PlatformTx, audit: AuditFn) => Promise<T>
): Promise<T> {
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      await actAsCaller(tx, caller);
      const audit: AuditFn = (entry) =>
        asOwner(tx, async () => {
          await tx.insert(auditLogs).values({ ...entry, userId: caller.id });
        });
      return fn(tx, audit);
    });
  } catch (err) {
    if (err instanceof ActionError) throw err;
    console.error("[db] transaction failed", err);
    throw new Error("Something went wrong. Please try again.");
  }
}
