// Natural-language → builder spec. The browser sends the question plus a
// compact catalogue of the semantic models to the ai-query function (which
// holds the Groq key), gets back a proposed spec, and validates it here against
// the real model definitions — so any hallucinated model/field/op is dropped
// before it ever reaches the compiler. Execution still goes through the
// RLS-safe analytics_run_sql RPC, so the AI can only surface permitted rows.

import { getAuthToken } from '../ui.js';
import { MODELS, getModel, getField, getNamedMeasure, AGGREGATIONS, GRANULARITIES, operatorsForType } from './models.js';
import { measureAlias } from './compiler.js';

const VIZ_IDS = ['number', 'table', 'bar', 'row', 'line', 'pie'];

// Compact model catalogue the LLM plans against.
export function buildCatalog() {
  return Object.values(MODELS).map(m => ({
    key: m.key,
    label: m.label,
    dimensions: m.fields.filter(f => f.dimension).map(f => ({ name: f.name, temporal: f.type === 'date' || f.type === 'datetime' })),
    measures: m.fields.filter(f => f.measure).map(f => f.name),
    namedMeasures: (m.measures || []).map(nm => nm.key),
    filters: m.fields.map(f => f.name),
  }));
}

// Sanitise a raw LLM spec against the real catalogue. Returns { spec, viz,
// explanation } or null if the model is unusable.
export function validateSpec(raw) {
  const model = getModel(raw?.model);
  if (!model) return null;
  const spec = { model: model.key, dimensions: [], measures: [], filters: [], sort: null, limit: 50, vizTheme: 'mono' };

  for (const d of (raw.dimensions || []).slice(0, 3)) {
    const f = getField(model.key, d?.field);
    if (!f || !f.dimension) continue;
    const dim = { field: f.name };
    if (f.type === 'date' || f.type === 'datetime') dim.granularity = GRANULARITIES.some(g => g.id === d.granularity) ? d.granularity : 'month';
    spec.dimensions.push(dim);
  }

  for (const m of (raw.measures || []).slice(0, 4)) {
    const agg = typeof m?.agg === 'string' ? m.agg : null;
    if (!agg) continue;
    if (agg.startsWith('m:')) { if (getNamedMeasure(model.key, agg.slice(2))) spec.measures.push({ agg }); continue; }
    if (agg === 'count') { spec.measures.push({ agg: 'count' }); continue; }
    const def = AGGREGATIONS.find(a => a.id === agg);
    if (!def) continue;
    const f = getField(model.key, m.field);
    if (def.needsField && (!f || !f.measure || (def.types && !def.types.includes(f.type)))) continue;
    spec.measures.push(def.needsField ? { agg, field: f.name } : { agg });
  }
  if (!spec.measures.length) spec.measures = [{ agg: 'count' }];

  for (const fl of (raw.filters || []).slice(0, 6)) {
    const f = getField(model.key, fl?.field);
    if (!f) continue;
    const op = operatorsForType(f.type).find(o => o.id === fl.op);
    if (!op) continue;
    const filt = { field: f.name, op: op.id };
    if (op.value) filt.value = fl.value ?? '';
    spec.filters.push(filt);
  }

  const viz = VIZ_IDS.includes(raw.viz) ? raw.viz : (spec.dimensions.length ? 'bar' : 'number');

  // Validate sort against the columns this spec will actually produce.
  const keys = [...spec.dimensions.map((_, i) => `dim${i}`), ...spec.measures.map(measureAlias)];
  if (raw.sort?.by && keys.includes(raw.sort.by)) {
    spec.sort = { by: raw.sort.by, dir: raw.sort.dir === 'asc' ? 'asc' : 'desc' };
  }
  spec.limit = Math.min(Math.max(Number(raw.limit) || 50, 1), 1000);

  const explanation = typeof raw.explanation === 'string' ? raw.explanation.slice(0, 240) : '';
  return { spec, viz, explanation };
}

// Ask the AI to turn a question into a validated spec.
export async function askAI(question) {
  const token = await getAuthToken();
  const resp = await fetch('/api/ai-query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ mode: 'analytics', query: question, catalog: buildCatalog() }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.error || 'AI request failed');
  if (json.error) throw new Error(json.error);
  const v = validateSpec(json.spec);
  if (!v) throw new Error('The AI returned an unrecognized query. Try rephrasing.');
  return v;
}
