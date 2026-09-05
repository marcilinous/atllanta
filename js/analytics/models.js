// Analytics data models — the curated catalogue the query builder explores.
//
// Each model maps a friendly name to a real table/view and declares which
// fields can be used as dimensions (group-by / breakout) and which as measures
// (things to aggregate). Every read runs through the RLS-scoped Supabase
// client, so listing a table here never widens what a user can see — RLS still
// limits rows to the caller. `feature` gates the model behind the same module
// visibility flags the sidebar uses (see js/features.js), so an org that has
// CRM turned off never sees CRM models.
//
// Field types drive the operators the filter UI offers and how values are
// bucketed/formatted: 'text' | 'number' | 'money' | 'date' | 'datetime' | 'bool'.

export const FIELD_TYPES = ['text', 'number', 'money', 'date', 'datetime', 'bool'];

// A field usable as a dimension (group-by) unless role says otherwise.
const dim = (name, label, type = 'text') => ({ name, label, type, dimension: true, measure: type === 'number' || type === 'money' });
const measureOnly = (name, label, type = 'number') => ({ name, label, type, dimension: false, measure: true });

export const MODELS = {
  employees: {
    key: 'employees', label: 'Employees', icon: '👥', table: 'users', feature: 'people',
    fields: [
      dim('status', 'Status'), dim('role', 'Role'), dim('designation', 'Designation'),
      dim('department_id', 'Department'), dim('date_of_joining', 'Joined', 'date'),
      dim('created_at', 'Created', 'datetime'),
    ],
  },
  attendance: {
    key: 'attendance', label: 'Attendance', icon: '🕒', table: 'attendance', feature: 'me',
    fields: [
      dim('date', 'Date', 'date'), dim('status', 'Status'), dim('user_id', 'Employee'),
      measureOnly('total_hours', 'Hours', 'number'),
    ],
  },
  leave_requests: {
    key: 'leave_requests', label: 'Leave requests', icon: '🌿', table: 'leave_requests', feature: 'me',
    fields: [
      dim('status', 'Status'), dim('user_id', 'Employee'), dim('start_date', 'Start date', 'date'),
      dim('created_at', 'Requested', 'datetime'), measureOnly('days', 'Days', 'number'),
    ],
  },
  jobs: {
    key: 'jobs', label: 'Jobs (openings)', icon: '💼', table: 'jobs', feature: 'recruitment',
    fields: [
      dim('status', 'Status'), dim('employment_type', 'Employment type'), dim('location', 'Location'),
      dim('created_at', 'Created', 'datetime'),
    ],
  },
  candidates: {
    key: 'candidates', label: 'Candidates', icon: '🧑‍💼', table: 'candidates', feature: 'recruitment',
    fields: [ dim('source', 'Source'), dim('created_at', 'Added', 'datetime') ],
  },
  applications: {
    key: 'applications', label: 'Job applications', icon: '📄', table: 'job_applications', feature: 'recruitment',
    fields: [
      dim('status', 'Stage'), dim('job_id', 'Job'), dim('created_at', 'Applied', 'datetime'),
      measureOnly('match_score', 'Match score', 'number'),
    ],
  },
  interviews: {
    key: 'interviews', label: 'Interviews', icon: '🎙️', table: 'interviews', feature: 'recruitment',
    fields: [
      dim('status', 'Status'), dim('round_name', 'Round'), dim('scheduled_at', 'Scheduled', 'datetime'),
      measureOnly('rating', 'Rating', 'number'),
    ],
  },
  expenses: {
    key: 'expenses', label: 'Expenses', icon: '💰', table: 'expenses', feature: 'finance',
    fields: [
      dim('status', 'Status'), dim('category_id', 'Category'), dim('expense_date', 'Date', 'date'),
      dim('user_id', 'Submitted by'), measureOnly('amount', 'Amount', 'money'),
    ],
  },
  tickets: {
    key: 'tickets', label: 'Helpdesk tickets', icon: '🎫', table: 'helpdesk_tickets', feature: 'helpdesk',
    fields: [
      dim('status', 'Status'), dim('priority', 'Priority'), dim('category_id', 'Category'),
      dim('created_at', 'Created', 'datetime'), dim('assigned_to', 'Assignee'),
    ],
  },
  // --- CRM ---
  accounts: {
    key: 'accounts', label: 'CRM · Accounts', icon: '🏢', table: 'crm_accounts', feature: 'crm',
    fields: [ dim('industry', 'Industry'), dim('created_at', 'Created', 'datetime') ],
  },
  leads: {
    key: 'leads', label: 'CRM · Leads', icon: '🎯', table: 'crm_leads', feature: 'crm_leads',
    fields: [
      dim('status', 'Status'), dim('rating', 'Rating'), dim('source', 'Source'),
      dim('owner_id', 'Owner'), dim('created_at', 'Created', 'datetime'),
    ],
  },
  opportunities: {
    key: 'opportunities', label: 'CRM · Deals', icon: '📈', table: 'crm_opportunities', feature: 'crm_pipeline',
    fields: [
      dim('status', 'Status'), dim('stage_id', 'Stage'), dim('owner_id', 'Owner'),
      dim('source', 'Source'), dim('close_date', 'Close date', 'date'),
      dim('created_at', 'Created', 'datetime'), dim('updated_at', 'Updated', 'datetime'),
      measureOnly('amount', 'Amount', 'money'), measureOnly('probability', 'Probability', 'number'),
    ],
  },
  visits: {
    key: 'visits', label: 'CRM · Field visits', icon: '📍', table: 'crm_visits', feature: 'crm_visits',
    fields: [
      dim('visited_at', 'Visited', 'datetime'), dim('account_id', 'Partner'),
      dim('visited_by', 'BDE'), dim('tally_serial_status', 'Tally serial'),
      dim('visit_status', 'Outcome'), dim('created_at', 'Logged', 'datetime'),
    ],
  },
};

// The aggregation functions the builder offers, keyed by id.
export const AGGREGATIONS = [
  { id: 'count', label: 'Count of rows', needsField: false },
  { id: 'count_distinct', label: 'Distinct count of', needsField: true, types: ['text', 'number', 'money', 'date', 'datetime', 'bool'] },
  { id: 'sum', label: 'Sum of', needsField: true, types: ['number', 'money'] },
  { id: 'avg', label: 'Average of', needsField: true, types: ['number', 'money'] },
  { id: 'min', label: 'Minimum of', needsField: true, types: ['number', 'money', 'date', 'datetime'] },
  { id: 'max', label: 'Maximum of', needsField: true, types: ['number', 'money', 'date', 'datetime'] },
];

// Operators offered per field type. `value` says how many value inputs the UI
// needs: 0 (none), 1 (single), or 'n' (comma list).
export const OPERATORS = {
  text:     [
    { id: 'eq', label: 'is', value: 1 }, { id: 'neq', label: 'is not', value: 1 },
    { id: 'contains', label: 'contains', value: 1 },
    { id: 'in', label: 'is one of', value: 'n' },
    { id: 'is_null', label: 'is empty', value: 0 }, { id: 'not_null', label: 'is not empty', value: 0 },
  ],
  number:   [
    { id: 'eq', label: '=', value: 1 }, { id: 'neq', label: '≠', value: 1 },
    { id: 'gt', label: '>', value: 1 }, { id: 'gte', label: '≥', value: 1 },
    { id: 'lt', label: '<', value: 1 }, { id: 'lte', label: '≤', value: 1 },
    { id: 'is_null', label: 'is empty', value: 0 }, { id: 'not_null', label: 'is not empty', value: 0 },
  ],
  date:     [
    { id: 'last_n_days', label: 'in the last (days)', value: 1 },
    { id: 'gte', label: 'on or after', value: 1 }, { id: 'lte', label: 'on or before', value: 1 },
    { id: 'eq', label: 'on', value: 1 },
    { id: 'is_null', label: 'is empty', value: 0 }, { id: 'not_null', label: 'is not empty', value: 0 },
  ],
  bool:     [ { id: 'is_true', label: 'is true', value: 0 }, { id: 'is_false', label: 'is false', value: 0 } ],
};
// money and datetime reuse number/date operators.
OPERATORS.money = OPERATORS.number;
OPERATORS.datetime = OPERATORS.date;

// Time-bucket granularities for a date/datetime dimension.
export const GRANULARITIES = [
  { id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' }, { id: 'year', label: 'Year' },
];

export function getModel(key) { return MODELS[key] || null; }
export function getField(modelKey, name) {
  return (MODELS[modelKey]?.fields || []).find(f => f.name === name) || null;
}
export function operatorsForType(type) { return OPERATORS[type] || OPERATORS.text; }
