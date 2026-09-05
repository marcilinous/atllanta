// Analytics engine — executes a saved/interactive query spec and returns
// result rows for the charts.
//
// Both paths run in Postgres through the analytics_run_sql RPC (SECURITY
// INVOKER → RLS enforced for the caller):
//   • builder specs are compiled to aggregate SQL by compiler.js;
//   • SQL specs run the user's own read-only SELECT.
// Aggregation, joins, and time-bucketing happen server-side, so there is no
// client row cap and cross-model joins (owner/stage/category names, etc.) work.

import sb from '../supabase.js';
import { compile } from './compiler.js';

const MAX_ROWS = 5000;

// ---- run a builder spec -----------------------------------------------------
// Returns { columns:[{key,label,type,isDimension?}], rows, rowCount, capped, sql }.
export async function runBuilder(spec) {
  const { sql, columns } = compile(spec);
  const { data, error } = await sb.rpc('analytics_run_sql', { query: sql, max_rows: MAX_ROWS });
  if (error) throw new Error(prettyError(error.message));
  const rows = Array.isArray(data) ? data : [];
  return { columns, rows, rowCount: rows.length, capped: rows.length >= MAX_ROWS, sql };
}

// ---- run a raw SQL spec -----------------------------------------------------
export async function runSql(sqlText, maxRows = 1000) {
  const cap = Math.min(Math.max(Number(maxRows) || 1000, 1), MAX_ROWS);
  const { data, error } = await sb.rpc('analytics_run_sql', { query: sqlText, max_rows: cap });
  if (error) throw new Error(prettyError(error.message));
  const arr = Array.isArray(data) ? data : [];
  const keys = arr.length ? Object.keys(arr[0]) : [];
  const columns = keys.map(k => ({ key: k, label: k, type: inferType(arr, k) }));
  return { columns, rows: arr, rowCount: arr.length, capped: arr.length >= cap };
}

function inferType(rows, key) {
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined) continue;
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'bool';
    return 'text';
  }
  return 'text';
}

// Surface the useful part of a Postgres error to the builder/SQL editor.
function prettyError(msg) {
  return (msg || 'Query failed').replace(/^.*?:\s*/, '').trim() || 'Query failed';
}

// Dispatch on a stored question's mode.
export async function runQuestion(q) {
  if (q.mode === 'sql') return runSql(q.spec?.sql || '', q.spec?.maxRows || 1000);
  return runBuilder(q.spec || {});
}
