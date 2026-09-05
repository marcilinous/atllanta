// Analytics engine — turns a saved/interactive query spec into result rows.
//
// Builder specs run entirely client-side over the RLS-scoped Supabase client:
// we select the needed columns (RLS limits the rows to what the caller may
// see), then group/aggregate/sort in the browser. SQL specs go through the
// analytics_run_sql RPC, which is also RLS-enforced. Nothing here can read a
// row the user couldn't already see in the UI.

import sb from '../supabase.js';
import { getModel, getField } from './models.js';

const ROW_CAP = 5000; // safety cap on rows pulled for client-side aggregation.

// ---- id → label resolution ---------------------------------------------------
// Several dimensions are foreign keys (user_id, owner_id, department_id, …). We
// resolve them to human names with a handful of small lookup tables, fetched
// once per run and cached for the session.
const LOOKUPS = {
  user_id:       { table: 'users', label: r => r.full_name || r.email },
  owner_id:      { table: 'users', label: r => r.full_name || r.email },
  visited_by:    { table: 'users', label: r => r.full_name || r.email },
  assigned_to:   { table: 'users', label: r => r.full_name || r.email },
  reviewed_by:   { table: 'users', label: r => r.full_name || r.email },
  department_id: { table: 'departments', label: r => r.name },
  stage_id:      { table: 'crm_pipeline_stages', label: r => r.name },
  category_id:   { table: 'expense_categories', label: r => r.name },
  account_id:    { table: 'crm_accounts', label: r => r.name },
  job_id:        { table: 'jobs', label: r => r.title },
};
// Overrides where the same column name resolves to different tables per model
// (e.g. category_id → expense_categories for expenses, helpdesk_categories for
// tickets). Keyed by `${modelKey}.${field}`.
const MODEL_LOOKUPS = {
  'tickets.category_id': { table: 'helpdesk_categories', label: r => r.name },
};
function lookupCfg(modelKey, field) { return MODEL_LOOKUPS[`${modelKey}.${field}`] || LOOKUPS[field] || null; }
const _cache = {};

async function lookupMap(cfg) {
  if (!cfg) return null;
  if (_cache[cfg.table]) return _cache[cfg.table];
  const cols = cfg.table === 'users' ? 'id, full_name, email'
    : cfg.table === 'jobs' ? 'id, title' : 'id, name';
  const { data, error } = await sb.from(cfg.table).select(cols).limit(ROW_CAP);
  if (error) { _cache[cfg.table] = {}; return {}; }
  const map = {};
  for (const r of data || []) map[r.id] = cfg.label(r);
  _cache[cfg.table] = map;
  return map;
}
export function clearLookupCache() { for (const k of Object.keys(_cache)) delete _cache[k]; }

// ---- date bucketing ---------------------------------------------------------
function bucketDate(value, granularity) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d)) return null;
  const y = d.getFullYear();
  const m = d.getMonth();
  if (granularity === 'year') return `${y}`;
  if (granularity === 'quarter') return `${y}-Q${Math.floor(m / 3) + 1}`;
  if (granularity === 'month') return `${y}-${String(m + 1).padStart(2, '0')}`;
  if (granularity === 'week') {
    const onejan = new Date(y, 0, 1);
    const week = Math.ceil((((d - onejan) / 86400000) + onejan.getDay() + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
  }
  return d.toISOString().slice(0, 10); // day
}

// ---- server-side filtering --------------------------------------------------
// We push what Supabase does cheaply (equality, comparisons, date windows)
// down to the query so the row cap bites less often.
function applyFilters(query, model, filters) {
  for (const f of filters || []) {
    const field = getField(model.key, f.field);
    if (!field) continue;
    const col = f.field;
    switch (f.op) {
      case 'eq': query = query.eq(col, f.value); break;
      case 'neq': query = query.neq(col, f.value); break;
      case 'gt': query = query.gt(col, f.value); break;
      case 'gte': query = query.gte(col, f.value); break;
      case 'lt': query = query.lt(col, f.value); break;
      case 'lte': query = query.lte(col, f.value); break;
      case 'contains': query = query.ilike(col, `%${f.value}%`); break;
      case 'in': query = query.in(col, String(f.value).split(',').map(s => s.trim()).filter(Boolean)); break;
      case 'is_null': query = query.is(col, null); break;
      case 'not_null': query = query.not(col, 'is', null); break;
      case 'is_true': query = query.is(col, true); break;
      case 'is_false': query = query.is(col, false); break;
      case 'last_n_days': {
        const since = new Date(); since.setDate(since.getDate() - (Number(f.value) || 0));
        query = query.gte(col, since.toISOString());
        break;
      }
      default: break;
    }
  }
  return query;
}

// ---- aggregation ------------------------------------------------------------
function aggregate(rows, agg, fieldName) {
  if (agg === 'count') return rows.length;
  const vals = rows.map(r => r[fieldName]).filter(v => v !== null && v !== undefined && v !== '');
  if (agg === 'count_distinct') return new Set(vals).size;
  const nums = vals.map(Number).filter(v => !isNaN(v));
  if (!nums.length) return (agg === 'min' || agg === 'max') ? null : 0;
  if (agg === 'sum') return nums.reduce((s, n) => s + n, 0);
  if (agg === 'avg') return nums.reduce((s, n) => s + n, 0) / nums.length;
  if (agg === 'min') return Math.min(...nums);
  if (agg === 'max') return Math.max(...nums);
  return null;
}

// Produce a measure column key + label from a measure spec.
export function measureKey(m) {
  return m.agg === 'count' ? 'count' : `${m.agg}__${m.field}`;
}
export function measureLabel(m, model) {
  if (m.agg === 'count') return 'Count';
  const f = getField(model.key, m.field);
  const name = f ? f.label : m.field;
  const verb = { sum: 'Sum of', avg: 'Avg', min: 'Min', max: 'Max', count_distinct: 'Distinct' }[m.agg] || m.agg;
  return `${verb} ${name}`;
}

// ---- run a builder spec -----------------------------------------------------
// Returns { columns:[{key,label,type}], rows:[{...}], rowCount, capped }.
export async function runBuilder(spec) {
  const model = getModel(spec.model);
  if (!model) throw new Error('Unknown data model');

  const dimensions = spec.dimensions || [];
  const measures = spec.measures?.length ? spec.measures : [{ agg: 'count' }];

  // Columns we must pull: every dimension + every measure field.
  const need = new Set(['id']);
  dimensions.forEach(d => need.add(d.field));
  measures.forEach(m => { if (m.field) need.add(m.field); });
  const selectCols = [...need].join(', ');

  let query = sb.from(model.table).select(selectCols);
  query = applyFilters(query, model, spec.filters);
  query = query.limit(ROW_CAP);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  let rows = data || [];
  const capped = rows.length >= ROW_CAP;

  // Resolve id-dimensions to labels.
  const resolvers = {};
  for (const d of dimensions) {
    const cfg = lookupCfg(model.key, d.field);
    if (cfg) resolvers[d.field] = await lookupMap(cfg);
  }

  // No dimensions → single aggregate row (scalar / number card).
  if (!dimensions.length) {
    const row = {};
    measures.forEach(m => { row[measureKey(m)] = aggregate(rows, m.agg, m.field); });
    return {
      columns: measures.map(m => ({ key: measureKey(m), label: measureLabel(m, model), type: 'number' })),
      rows: [row], rowCount: rows.length, capped,
    };
  }

  // Group rows by the composite dimension key.
  const groups = new Map();
  for (const r of rows) {
    const keyParts = dimensions.map(d => {
      const field = getField(model.key, d.field);
      let v = r[d.field];
      if ((field?.type === 'date' || field?.type === 'datetime') && d.granularity) v = bucketDate(v, d.granularity);
      if (v === null || v === undefined || v === '') return '∅';
      if (resolvers[d.field]) return resolvers[d.field][v] || '—';
      return String(v);
    });
    const gkey = keyParts.join(' ▸ ');
    if (!groups.has(gkey)) groups.set(gkey, { parts: keyParts, rows: [] });
    groups.get(gkey).rows.push(r);
  }

  const columns = [
    ...dimensions.map((d, i) => {
      const f = getField(model.key, d.field);
      return { key: `dim${i}`, label: f ? f.label : d.field, type: f?.type || 'text', isDimension: true };
    }),
    ...measures.map(m => ({ key: measureKey(m), label: measureLabel(m, model), type: 'number' })),
  ];

  let outRows = [...groups.values()].map(g => {
    const row = {};
    dimensions.forEach((d, i) => { row[`dim${i}`] = g.parts[i]; });
    measures.forEach(m => { row[measureKey(m)] = aggregate(g.rows, m.agg, m.field); });
    return row;
  });

  // Sort: explicit spec.sort, else by first measure desc for a natural ranking.
  const sortKey = spec.sort?.by || measureKey(measures[0]);
  const dir = spec.sort?.dir === 'asc' ? 1 : -1;
  const isDimSort = columns.find(c => c.key === sortKey)?.isDimension;
  outRows.sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (isDimSort) return String(av).localeCompare(String(bv)) * dir;
    return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
  });

  const limit = Number(spec.limit) || 50;
  const total = outRows.length;
  outRows = outRows.slice(0, limit);

  return { columns, rows: outRows, rowCount: rows.length, groupCount: total, capped };
}

// ---- run a raw SQL spec -----------------------------------------------------
export async function runSql(sqlText, maxRows = 1000) {
  const { data, error } = await sb.rpc('analytics_run_sql', { query: sqlText, max_rows: maxRows });
  if (error) throw new Error(error.message);
  const arr = Array.isArray(data) ? data : [];
  const keys = arr.length ? Object.keys(arr[0]) : [];
  const columns = keys.map(k => ({ key: k, label: k, type: inferType(arr, k) }));
  return { columns, rows: arr, rowCount: arr.length, capped: arr.length >= maxRows };
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

// Dispatch on a stored question's mode.
export async function runQuestion(q) {
  if (q.mode === 'sql') return runSql(q.spec?.sql || '', q.spec?.maxRows || 1000);
  return runBuilder(q.spec || {});
}
