// Semantic-layer SQL compiler — turns a builder spec into a single aggregate
// SELECT built from the model definitions (js/analytics/models.js). The result
// runs through the analytics_run_sql RPC, which is SECURITY INVOKER, so every
// referenced table's RLS is enforced for the caller.
//
// Only *values* come from the user (escaped as SQL literals); every table,
// column, and join expression comes from the trusted model catalogue. And the
// RPC is read-only + RLS-bounded regardless, so a query can never read a row
// the user couldn't already see, nor write anything.

import { getModel, getField, getNamedMeasure } from './models.js';

// ---- value escaping ---------------------------------------------------------
const sqlStr = v => `'${String(v ?? '').replace(/'/g, "''")}'`;
const sqlList = v => String(v ?? '').split(',').map(s => s.trim()).filter(Boolean).map(sqlStr).join(', ');
function sqlNum(v) { const n = Number(v); return isFinite(n) ? String(n) : null; }
const sqlInt = v => { const n = parseInt(v, 10); return isFinite(n) ? String(n) : '0'; };

const OP = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

// ---- measures ---------------------------------------------------------------
// A measure spec is either { agg, field } (standard) or { agg: 'm:<key>' }
// (a model-defined named measure). Resolve to a uniform shape.
export function measureAlias(m) {
  if (!m || !m.agg) return 'count';
  if (m.agg.startsWith('m:')) return 'nm_' + m.agg.slice(2);
  if (m.agg === 'count') return 'count';
  return `${m.agg}__${m.field}`;
}
export function measureLabelFor(model, m) {
  if (m.agg?.startsWith('m:')) return getNamedMeasure(model.key, m.agg.slice(2))?.label || m.agg.slice(2);
  if (m.agg === 'count') return 'Count';
  const f = getField(model.key, m.field);
  const verb = { sum: 'Sum of', avg: 'Avg', min: 'Min', max: 'Max', count_distinct: 'Distinct' }[m.agg] || m.agg;
  return `${verb} ${f ? f.label : m.field}`;
}
function measureResolve(model, m) {
  if (m.agg?.startsWith('m:')) {
    const nm = getNamedMeasure(model.key, m.agg.slice(2));
    if (!nm) return null;
    return { alias: 'nm_' + nm.key, label: nm.label, type: nm.type || 'number', sql: nm.sql, joins: nm.joins || [] };
  }
  if (m.agg === 'count') return { alias: 'count', label: 'Count', type: 'number', sql: 'count(*)', joins: [] };
  const f = getField(model.key, m.field);
  if (!f) return null;
  const inner = f.sql;
  const sql = m.agg === 'count_distinct' ? `count(distinct ${inner})` : `${m.agg}(${inner})`;
  const type = m.agg === 'count_distinct' ? 'number' : f.type;
  return { alias: measureAlias(m), label: measureLabelFor(model, m), type, sql, joins: f.join ? [f.join] : [] };
}

// ---- dimensions -------------------------------------------------------------
function bucket(expr, granularity) {
  const fmt = { day: 'YYYY-MM-DD', week: 'IYYY-"W"IW', month: 'YYYY-MM', quarter: 'YYYY-"Q"Q', year: 'YYYY' }[granularity];
  if (!fmt) return expr;
  const trunc = granularity === 'week' ? 'week' : granularity;
  return `to_char(date_trunc('${trunc}', ${expr}), '${fmt}')`;
}

// ---- filters ----------------------------------------------------------------
function filterSql(model, f) {
  const field = getField(model.key, f.field);
  if (!field) return null;
  const e = field.sql;
  const numeric = field.type === 'number' || field.type === 'money';
  switch (f.op) {
    case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte': {
      if (numeric) { const n = sqlNum(f.value); return n === null ? null : `${e} ${OP[f.op]} ${n}`; }
      if (field.type === 'date' || field.type === 'datetime') {
        if (!f.value) return null;
        return f.op === 'eq' ? `${e}::date = ${sqlStr(f.value)}` : `${e} ${OP[f.op]} ${sqlStr(f.value)}`;
      }
      return `${e} ${OP[f.op]} ${sqlStr(f.value)}`;
    }
    case 'contains': return f.value ? `${e} ilike ${sqlStr('%' + f.value + '%')}` : null;
    case 'in': { const l = sqlList(f.value); return l ? `${e} in (${l})` : null; }
    case 'is_null': return `${e} is null`;
    case 'not_null': return `${e} is not null`;
    case 'is_true': return `${e} is true`;
    case 'is_false': return `${e} is false`;
    case 'last_n_days': return `${e} >= (now() - interval '${sqlInt(f.value)} days')`;
    default: return null;
  }
}

// ---- compile ----------------------------------------------------------------
// spec: { model, dimensions:[{field,granularity}], measures:[{agg,field}|{agg:'m:key'}],
//         filters:[{field,op,value}], sort:{by,dir}, limit }
// Returns { sql, columns:[{key,label,type,isDimension?}] }.
export function compile(spec) {
  const model = getModel(spec.model);
  if (!model) throw new Error('Unknown data model');

  const dimensions = spec.dimensions || [];
  const measures = (spec.measures && spec.measures.length) ? spec.measures : [{ agg: 'count' }];
  const neededJoins = new Set();

  // dimensions
  const dimCols = [], dimSelect = [];
  dimensions.forEach((d, i) => {
    const f = getField(model.key, d.field);
    if (!f) return;
    if (f.join) neededJoins.add(f.join);
    const isTemporal = f.type === 'date' || f.type === 'datetime';
    const expr = (isTemporal && d.granularity) ? bucket(f.sql, d.granularity) : f.sql;
    dimSelect.push(`${expr} as "dim${i}"`);
    dimCols.push({ key: `dim${i}`, label: f.label, type: f.type, isDimension: true, temporal: isTemporal });
  });

  // measures
  const measCols = [], measSelect = [];
  measures.forEach(m => {
    const r = measureResolve(model, m);
    if (!r) return;
    r.joins.forEach(j => neededJoins.add(j));
    measSelect.push(`${r.sql} as "${r.alias}"`);
    measCols.push({ key: r.alias, label: r.label, type: r.type });
  });
  if (!measSelect.length) { measSelect.push('count(*) as "count"'); measCols.push({ key: 'count', label: 'Count', type: 'number' }); }

  // filters
  const where = [];
  (spec.filters || []).forEach(f => {
    const field = getField(model.key, f.field);
    if (field?.join) neededJoins.add(field.join);
    const s = filterSql(model, f);
    if (s) where.push(s);
  });

  // joins (emit only what's needed)
  const joinSql = [...neededJoins].map(k => model.joins?.[k]).filter(Boolean).join('\n  ');

  const columns = [...dimCols, ...measCols];
  const nDims = dimCols.length;

  // order by (ordinal positions — avoids alias-quoting issues)
  let orderBy;
  if (spec.sort?.by) {
    const idx = columns.findIndex(c => c.key === spec.sort.by);
    const dir = spec.sort.dir === 'asc' ? 'asc' : 'desc';
    orderBy = idx >= 0 ? `${idx + 1} ${dir}` : null;
  }
  if (!orderBy) {
    if (nDims && dimCols[0].temporal) orderBy = '1 asc';
    else if (measCols.length) orderBy = `${nDims + 1} desc`;
    else if (nDims) orderBy = '1 asc';
  }

  const limit = Math.min(Math.max(Number(spec.limit) || 50, 1), 1000);

  let sql = `select ${[...dimSelect, ...measSelect].join(', ')}\nfrom ${model.base}`;
  if (joinSql) sql += `\n  ${joinSql}`;
  if (where.length) sql += `\nwhere ${where.join(' and ')}`;
  if (nDims) sql += `\ngroup by ${dimCols.map((_, i) => i + 1).join(', ')}`;
  if (orderBy) sql += `\norder by ${orderBy}`;
  sql += `\nlimit ${limit}`;

  return { sql, columns };
}
