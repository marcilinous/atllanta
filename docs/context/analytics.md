# Analytics module

Self-serve analytics across every module: saved questions, dashboards, alerts, and a
natural-language entry point. It owns no business tables — it reads other modules'
data through one RLS-safe RPC.

---

## 1. Screens

| Route | File | Purpose |
|---|---|---|
| `analytics` | `views/analytics/index.js` | library of saved questions and dashboards |
| `analytics/question` | `views/analytics/builder.js` (513) | question editor: visual builder or read-only SQL, live chart preview, alerts |
| `analytics/dashboard` | `views/analytics/dashboard.js` | arrange questions into a grid |
| `reports`, `reports/*` | `views/reports/index.js`, `expenses.js`, `helpdesk.js`, `recruitment.js`, `planner.js` | the older fixed reports; manager+ only; folds into this module over time |

## 2. The engine (`js/analytics/`, ~970 lines)

| File | Role |
|---|---|
| `models.js` (257) | the **semantic layer**: named models with base table, joins, dimensions, measures, and the feature key that gates them. Models: `employees`, `attendance`, `leave_requests`, `expenses`, `tickets`, `jobs`, `candidates`, `applications`, `interviews`, `leads`, `opportunities`, `accounts`, `visits` |
| `compiler.js` (159) | turns a builder spec into one aggregate `SELECT`. Table and column names come only from the model definitions; **only values** come from the user, escaped as SQL literals |
| `engine.js` (57) | runs either path (compiled spec or the user's own SELECT) and returns rows |
| `charts.js` (284) | six visualisation types, rendered without a chart library |
| `duck.js` (123) | optional DuckDB-Wasm in a sandboxed Web Worker for local slice/dice over rows **already fetched** — never a data-access path |
| `nl.js` (92) | natural language → spec: the browser sends the question plus a compact model catalogue to the AI function, then **validates the returned spec against the real models**, dropping anything hallucinated |

## 3. Security model (do not weaken this)

- Every query executes through the **`analytics_run_sql(query, max_rows)` RPC, which is
  SECURITY INVOKER** — so row-level security applies to the *caller*. Analytics can never
  surface a row the user could not see in the UI.
- The SQL mode accepts read-only `SELECT` only.
- The AI path proposes a spec; it never executes SQL directly, and the spec is validated
  before compilation.
- Model access respects feature gating: a model whose `feature` key is hidden for that
  user must not appear in the builder.
- `nl.js` calls the AI function, which is **disabled (503) until v1.4.0** — the
  natural-language entry point is therefore inert today. When it returns it must go
  through `lib/aiGateway.js` with the `analytics_ask` feature so its tokens are counted
  (see `ai.md`).

## 4. Tables

`analytics_questions` (name, description, mode, spec, viz), `analytics_dashboards`
(layout), `analytics_alerts` (question + condition + schedule). All org-scoped with the
standard four policies.

Note: migration `20260905134934_analytics_alerts` also creates `analytics_run_as`, which
production no longer has — removed by hand, possibly on purpose. Decide whether the
migration should still create it before replaying history anywhere.

## 5. Working notes

- Adding a model is usually better than writing a new fixed report: one entry in
  `models.js` gives users dimensions, measures, charts and alerts for free.
- Cross-module reads belong here or in a module's own API — never a direct table read
  from another module's view code.
- The legacy `views/reports/*` screens still query tables directly. They are the
  remaining module-boundary debt; retire them as their equivalents appear here.
