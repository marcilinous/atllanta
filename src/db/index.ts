// Server-only Drizzle client for the shared Supabase Postgres.
//
// Uses the pooled connection string (Supabase transaction pooler, port
// 6543); RLS still applies to whatever role the connection uses, so this
// never replaces the per-request Supabase client for user-scoped reads.
//
// DATABASE_URL is not set in every environment yet (Phase 0: the owner has
// to add it once they have the database password). Importing this module
// must never throw and must never attempt a network connection when the
// variable is absent — the postgres.js client lazily connects on first
// query, and if we let it construct with a missing/garbage connection
// string it could still try to dial a default host during static build.
// So construction is deferred behind getDb(), which throws a plain, generic
// error (never the connection string or a driver error) that callers such
// as app/(health)/health/page.tsx catch and turn into a "not configured"
// state.
import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as platformSchema from "./schema/platform";

type Db = PostgresJsDatabase<typeof platformSchema>;

let cached: Db | null | undefined;

function buildClient(): Db | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema: platformSchema });
}

/** Whether the connection string is set at all. Never exposes its value. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * TEMPORARY (Phase 0): yes/no facts about the connection string's shape, for
 * diagnosing ERR_INVALID_URL without logging any part of the value.
 */
export function describeDatabaseUrlShape(): Record<string, boolean | number> {
  const v = process.env.DATABASE_URL ?? "";
  const rest = v.replace(/^postgres(ql)?:\/\//, "");
  const lastAt = rest.lastIndexOf("@");
  const userinfo = lastAt >= 0 ? rest.slice(0, lastAt) : "";
  const password = userinfo.includes(":") ? userinfo.slice(userinfo.indexOf(":") + 1) : "";
  return {
    schemeOk: /^postgres(ql)?:\/\//.test(v),
    surroundingWhitespace: v !== v.trim(),
    innerWhitespace: /\s/.test(v.trim()),
    quoted: /^["']|["']$/.test(v.trim()),
    startsWithVarName: v.trim().startsWith("DATABASE_URL"),
    brackets: /[[\]]/.test(v),
    atCount: (rest.match(/@/g) ?? []).length,
    passwordHasHashQuestionSlash: /[#?/]/.test(password),
    passwordHasBadPercent: /%(?![0-9A-Fa-f]{2})/.test(password),
    port6543: /:6543\//.test(v),
  };
}

/**
 * Returns the Drizzle client, or throws a generic error if DATABASE_URL is
 * not configured. Never leaks the connection string or a raw driver error.
 */
export function getDb(): Db {
  if (cached === undefined) cached = buildClient();
  if (!cached) throw new Error("Database is not configured");
  return cached;
}
