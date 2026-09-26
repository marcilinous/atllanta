// The 13 org_modules / role_permissions module keys and the five
// role_permissions permission levels, mirrored exactly from the CHECK
// constraints in supabase/migrations/20260926063815_roles_and_org_modules.sql.
// No `server-only` import here: this file is imported directly by node:test
// tests (tests/roles-and-org-modules.test.mjs) as well as by server code.

export const MODULE_KEYS = [
  'people',
  'me',
  'inbox',
  'documents',
  'finance',
  'announcements',
  'recruitment',
  'crm',
  'crm_partner',
  'analytics',
  'helpdesk',
  'projects',
  'ai',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const PERMISSIONS = ['view', 'create', 'edit', 'delete', 'approve'] as const;
export type Permission = (typeof PERMISSIONS)[number];
