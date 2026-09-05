// Analytics semantic layer — the curated catalogue the query builder explores.
//
// Each model maps a friendly name to a base table (+ alias) and declares:
//   • joins       — related tables, keyed, emitted only when a selected field
//                   needs them (so a query stays as narrow as possible).
//   • fields      — dimensions / measurable columns, each carrying the SQL
//                   expression that produces it (using the aliases below) and,
//                   if it lives on a joined table, the join key it needs.
//   • measures    — named, pre-written aggregate metrics (win rate, weighted
//                   pipeline, …) that a plain agg-over-column can't express.
//
// The compiler (js/analytics/compiler.js) turns a builder spec into one
// aggregate SQL statement from these definitions; it runs through the
// analytics_run_sql RPC, which is SECURITY INVOKER — so every table's RLS is
// enforced for the caller. Listing a table here never widens what a user sees.
//
// Field types drive filter operators and value formatting:
// 'text' | 'number' | 'money' | 'date' | 'datetime' | 'bool'.

export const FIELD_TYPES = ['text', 'number', 'money', 'date', 'datetime', 'bool'];

// dimension: usable as a group-by. measure: usable as sum/avg/etc. target.
const dim = (name, label, sql, type = 'text', join) => ({ name, label, sql, type, join, dimension: true, measure: type === 'number' || type === 'money' });
const num = (name, label, sql, type = 'number', join) => ({ name, label, sql, type, join, dimension: false, measure: true });

export const MODELS = {
  employees: {
    key: 'employees', label: 'Employees', icon: '👥', feature: 'people',
    base: 'users u',
    joins: { dept: 'left join departments d on d.id = u.department_id' },
    fields: [
      dim('status', 'Status', 'u.status'),
      dim('role', 'Role', 'u.role'),
      dim('designation', 'Designation', 'u.designation'),
      dim('department', 'Department', 'd.name', 'text', 'dept'),
      dim('date_of_joining', 'Joined', 'u.date_of_joining', 'date'),
      dim('created_at', 'Created', 'u.created_at', 'datetime'),
    ],
  },
  attendance: {
    key: 'attendance', label: 'Attendance', icon: '🕒', feature: 'me',
    base: 'attendance a',
    joins: { emp: 'left join users u on u.id = a.user_id' },
    fields: [
      dim('date', 'Date', 'a.date', 'date'),
      dim('status', 'Status', 'a.status'),
      dim('employee', 'Employee', 'coalesce(u.full_name, u.email)', 'text', 'emp'),
      num('total_hours', 'Hours', 'a.total_hours', 'number'),
    ],
    measures: [
      { key: 'present_rate', label: 'Present rate %', type: 'number', sql: "round(100.0 * count(*) filter (where a.status = 'present') / nullif(count(*), 0), 1)" },
    ],
  },
  leave_requests: {
    key: 'leave_requests', label: 'Leave requests', icon: '🌿', feature: 'me',
    base: 'leave_requests lr',
    joins: { emp: 'left join users u on u.id = lr.user_id' },
    fields: [
      dim('status', 'Status', 'lr.status'),
      dim('employee', 'Employee', 'coalesce(u.full_name, u.email)', 'text', 'emp'),
      dim('start_date', 'Start date', 'lr.start_date', 'date'),
      dim('created_at', 'Requested', 'lr.created_at', 'datetime'),
      num('days', 'Days', 'lr.days', 'number'),
    ],
  },
  jobs: {
    key: 'jobs', label: 'Jobs (openings)', icon: '💼', feature: 'recruitment',
    base: 'jobs j',
    fields: [
      dim('status', 'Status', 'j.status'),
      dim('employment_type', 'Employment type', 'j.employment_type'),
      dim('location', 'Location', 'j.location'),
      dim('created_at', 'Created', 'j.created_at', 'datetime'),
    ],
  },
  candidates: {
    key: 'candidates', label: 'Candidates', icon: '🧑‍💼', feature: 'recruitment',
    base: 'candidates c',
    fields: [
      dim('source', 'Source', 'c.source'),
      dim('created_at', 'Added', 'c.created_at', 'datetime'),
    ],
  },
  applications: {
    key: 'applications', label: 'Job applications', icon: '📄', feature: 'recruitment',
    base: 'job_applications ja',
    joins: { job: 'left join jobs jb on jb.id = ja.job_id' },
    fields: [
      dim('status', 'Stage', 'ja.status'),
      dim('job', 'Job', 'jb.title', 'text', 'job'),
      dim('created_at', 'Applied', 'ja.created_at', 'datetime'),
      num('match_score', 'Match score', 'ja.match_score', 'number'),
    ],
  },
  interviews: {
    key: 'interviews', label: 'Interviews', icon: '🎙️', feature: 'recruitment',
    base: 'interviews i',
    fields: [
      dim('status', 'Status', 'i.status'),
      dim('round_name', 'Round', 'i.round_name'),
      dim('scheduled_at', 'Scheduled', 'i.scheduled_at', 'datetime'),
      num('rating', 'Rating', 'i.rating', 'number'),
    ],
  },
  expenses: {
    key: 'expenses', label: 'Expenses', icon: '💰', feature: 'finance',
    base: 'expenses e',
    joins: {
      cat: 'left join expense_categories ec on ec.id = e.category_id',
      emp: 'left join users u on u.id = e.user_id',
    },
    fields: [
      dim('status', 'Status', 'e.status'),
      dim('category', 'Category', 'ec.name', 'text', 'cat'),
      dim('expense_date', 'Date', 'e.expense_date', 'date'),
      dim('submitter', 'Submitted by', 'coalesce(u.full_name, u.email)', 'text', 'emp'),
      num('amount', 'Amount', 'e.amount', 'money'),
    ],
    measures: [
      { key: 'approved_amount', label: 'Approved amount', type: 'money', sql: "sum(e.amount) filter (where e.status = 'approved')" },
    ],
  },
  tickets: {
    key: 'tickets', label: 'Helpdesk tickets', icon: '🎫', feature: 'helpdesk',
    base: 'helpdesk_tickets ht',
    joins: {
      cat: 'left join helpdesk_categories hc on hc.id = ht.category_id',
      assignee: 'left join users u on u.id = ht.assigned_to',
    },
    fields: [
      dim('status', 'Status', 'ht.status'),
      dim('priority', 'Priority', 'ht.priority'),
      dim('category', 'Category', 'hc.name', 'text', 'cat'),
      dim('assignee', 'Assignee', 'coalesce(u.full_name, u.email)', 'text', 'assignee'),
      dim('created_at', 'Created', 'ht.created_at', 'datetime'),
    ],
    measures: [
      { key: 'resolved_rate', label: 'Resolved rate %', type: 'number', sql: "round(100.0 * count(*) filter (where ht.status in ('resolved','closed')) / nullif(count(*), 0), 1)" },
    ],
  },
  // --- CRM ---
  accounts: {
    key: 'accounts', label: 'CRM · Accounts', icon: '🏢', feature: 'crm',
    base: 'crm_accounts acc',
    fields: [
      dim('industry', 'Industry', 'acc.industry'),
      dim('tier', 'Tier', 'acc.tier'),
      dim('billing_city', 'City', 'acc.billing_city'),
      dim('region', 'Region', 'acc.region'),
      dim('created_at', 'Created', 'acc.created_at', 'datetime'),
    ],
  },
  leads: {
    key: 'leads', label: 'CRM · Leads', icon: '🎯', feature: 'crm_leads',
    base: 'crm_leads l',
    joins: { owner: 'left join users u on u.id = l.owner_id' },
    fields: [
      dim('status', 'Status', 'l.status'),
      dim('rating', 'Rating', 'l.rating'),
      dim('source', 'Source', 'l.source'),
      dim('owner', 'Owner', 'coalesce(u.full_name, u.email)', 'text', 'owner'),
      dim('created_at', 'Created', 'l.created_at', 'datetime'),
    ],
    measures: [
      { key: 'conversion_rate', label: 'Conversion rate %', type: 'number', sql: "round(100.0 * count(*) filter (where l.status = 'converted') / nullif(count(*), 0), 1)" },
    ],
  },
  opportunities: {
    key: 'opportunities', label: 'CRM · Deals', icon: '📈', feature: 'crm_pipeline',
    base: 'crm_opportunities o',
    joins: {
      owner: 'left join users u on u.id = o.owner_id',
      stage: 'left join crm_pipeline_stages s on s.id = o.stage_id',
    },
    fields: [
      dim('status', 'Status', 'o.status'),
      dim('stage', 'Stage', 's.name', 'text', 'stage'),
      dim('owner', 'Owner', 'coalesce(u.full_name, u.email)', 'text', 'owner'),
      dim('source', 'Source', 'o.source'),
      dim('close_date', 'Close date', 'o.close_date', 'date'),
      dim('created_at', 'Created', 'o.created_at', 'datetime'),
      dim('updated_at', 'Updated', 'o.updated_at', 'datetime'),
      num('amount', 'Amount', 'o.amount', 'money'),
      num('probability', 'Probability', 'o.probability', 'number'),
    ],
    measures: [
      { key: 'open_amount', label: 'Open pipeline', type: 'money', sql: "sum(o.amount) filter (where o.status = 'open')" },
      { key: 'won_amount', label: 'Won amount', type: 'money', sql: "sum(o.amount) filter (where o.status = 'won')" },
      { key: 'weighted', label: 'Weighted pipeline', type: 'money', sql: "sum(o.amount * coalesce(o.probability, 0) / 100.0) filter (where o.status = 'open')" },
      { key: 'win_rate', label: 'Win rate %', type: 'number', sql: "round(100.0 * count(*) filter (where o.status = 'won') / nullif(count(*) filter (where o.status in ('won','lost')), 0), 1)" },
    ],
  },
  visits: {
    key: 'visits', label: 'CRM · Field visits', icon: '📍', feature: 'crm_visits',
    base: 'crm_visits v',
    joins: {
      partner: 'left join crm_accounts acc on acc.id = v.account_id',
      bde: 'left join users u on u.id = v.visited_by',
    },
    fields: [
      dim('visited_at', 'Visited', 'v.visited_at', 'datetime'),
      dim('created_at', 'Logged', 'v.created_at', 'datetime'),
      dim('partner', 'Partner', 'acc.name', 'text', 'partner'),
      dim('bde', 'BDE', 'coalesce(u.full_name, v.visited_by_name)', 'text', 'bde'),
      dim('visit_status', 'Outcome', 'v.visit_status'),
      dim('tally_serial_status', 'Tally serial', 'v.tally_serial_status'),
    ],
  },
};

// Standard aggregations offered per measurable field.
export const AGGREGATIONS = [
  { id: 'count', label: 'Count of rows', needsField: false },
  { id: 'count_distinct', label: 'Distinct count of', needsField: true, types: ['text', 'number', 'money', 'date', 'datetime', 'bool'] },
  { id: 'sum', label: 'Sum of', needsField: true, types: ['number', 'money'] },
  { id: 'avg', label: 'Average of', needsField: true, types: ['number', 'money'] },
  { id: 'min', label: 'Minimum of', needsField: true, types: ['number', 'money', 'date', 'datetime'] },
  { id: 'max', label: 'Maximum of', needsField: true, types: ['number', 'money', 'date', 'datetime'] },
];

export const OPERATORS = {
  text: [
    { id: 'eq', label: 'is', value: 1 }, { id: 'neq', label: 'is not', value: 1 },
    { id: 'contains', label: 'contains', value: 1 },
    { id: 'in', label: 'is one of', value: 'n' },
    { id: 'is_null', label: 'is empty', value: 0 }, { id: 'not_null', label: 'is not empty', value: 0 },
  ],
  number: [
    { id: 'eq', label: '=', value: 1 }, { id: 'neq', label: '≠', value: 1 },
    { id: 'gt', label: '>', value: 1 }, { id: 'gte', label: '≥', value: 1 },
    { id: 'lt', label: '<', value: 1 }, { id: 'lte', label: '≤', value: 1 },
    { id: 'is_null', label: 'is empty', value: 0 }, { id: 'not_null', label: 'is not empty', value: 0 },
  ],
  date: [
    { id: 'last_n_days', label: 'in the last (days)', value: 1 },
    { id: 'gte', label: 'on or after', value: 1 }, { id: 'lte', label: 'on or before', value: 1 },
    { id: 'eq', label: 'on', value: 1 },
    { id: 'is_null', label: 'is empty', value: 0 }, { id: 'not_null', label: 'is not empty', value: 0 },
  ],
  bool: [{ id: 'is_true', label: 'is true', value: 0 }, { id: 'is_false', label: 'is false', value: 0 }],
};
OPERATORS.money = OPERATORS.number;
OPERATORS.datetime = OPERATORS.date;

export const GRANULARITIES = [
  { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' }, { id: 'year', label: 'Year' },
];

export function getModel(key) { return MODELS[key] || null; }
export function getField(modelKey, name) {
  return (MODELS[modelKey]?.fields || []).find(f => f.name === name) || null;
}
export function getNamedMeasure(modelKey, key) {
  return (MODELS[modelKey]?.measures || []).find(m => m.key === key) || null;
}
export function operatorsForType(type) { return OPERATORS[type] || OPERATORS.text; }
