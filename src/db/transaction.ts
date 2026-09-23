// Every platform mutation writes its row and its audit_logs row together or
// not at all — a rename that lands without an audit entry (or an audit entry
// for a write that got rolled back) is worse than a mutation that fails
// outright. withTransaction is the one place that owns that guarantee:
// callers never reach for getDb().transaction(...) themselves, so there is
// exactly one code path that can commit a platform write.
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
import { ActionError } from "../lib/actions";

type Db = PostgresJsDatabase<typeof platformSchema>;

/** The transaction object Drizzle hands to a `db.transaction(...)` callback, scoped to the platform schema. */
export type PlatformTx = Parameters<Db["transaction"]>[0] extends (tx: infer Tx) => unknown
  ? Tx
  : never;

export async function withTransaction<T>(fn: (tx: PlatformTx) => Promise<T>): Promise<T> {
  const db = getDb();
  try {
    return await db.transaction(fn);
  } catch (err) {
    if (err instanceof ActionError) throw err;
    console.error("[db] transaction failed", err);
    throw new Error("Something went wrong. Please try again.");
  }
}
