# Platform layer — the shared floor

Everything in `js/` plus the tenancy, identity and cross-cutting services every module
sits on. Read this once; it explains 80% of "how does this app do X".

---

## 1. Identity and tenancy

- **One user belongs to exactly one organisation.** `users` (id → `auth.users`, `org_id`,
  `full_name`, `email`, `phone`, `avatar_url`, `role`, `designation`, `department_id`,
  `team_id`, `reporting_manager_id`, `status`, `date_of_joining`).
- **Roles** (`users.role`): `owner`, `admin`, `manager`, `member`. No custom-permission
  UI — role checks live in `js/auth.js`, RLS policies, and `data-role` attributes on the
  sidebar in `index.html`.
- **`status`**: `active` | `on_notice` | `exited`. Exited users keep rows but must not
  be able to act (the AI gateway, for example, refuses them).
- **Tenant key is `org_id`.** Never `organization_id`, never `client_id` — the old agency
  tier is gone. `organizations` also holds `timezone`, `currency`, `date_format`,
  `plan_tier`, `payment_status`, `crm_enabled`, `partner_crm_enabled`, and the legacy
  credit columns (`credits_balance`, `credit_overage_mode`, `credits_included_monthly`)
  which v1.2.0 stopped using.
- **RLS everywhere.** The helper is `auth_org_id()` (SECURITY DEFINER, stable):
  `select org_id from users where id = auth.uid()`. Standard policy set per table:
  select/insert/update/delete all gated on `org_id = auth_org_id()`.
  Role-aware helpers exist for People data: `is_org_admin()`, `is_org_owner()`,
  `hr_can_approve()`, `hr_can_configure()`, `hr_visible_user_ids()`,
  `crm_user_is_manager_plus()`, `crm_user_is_org_admin()`, `is_platform_admin()`.
- **The browser only ever uses the `anon` key + RLS** (`js/supabase.js`). The
  service-role key exists only in `api/` and `lib/` — and there, RLS is bypassed, so the
  endpoint must check `org_id` itself.
- **The permanent test:** two orgs, data in both, user A cannot read B's rows on any
  table by any path under the anon key.

## 2. Routing and the app shell

- `index.html` is the shell: it imports every view module, calls `registerRoute(path, handler)`
  for each screen, then `initRouter(container)`.
- `js/router.js`: hash routing (`#/path?query`), `navigate()`, `currentRoute()`,
  `routeParams()`. It blocks disallowed routes (see §3), sets
  `document.documentElement.dataset.module` so the accent colour follows the module,
  and highlights the sidebar via `updateActiveNav`.
- Route → module accent map lives in `MODULE_BY_BASE` in `js/router.js`.
- **Adding a screen:** create `views/<area>/<screen>.js` exporting a default
  `async function(container)`, import it in `index.html`, register its route, and (if it
  should be toggleable) add its feature key to `js/features.js`.

## 3. Feature gating (`js/features.js`)

Two independent layers, both above RLS (which stays the real protection):

1. **Per-tenant platform gates**, from `organizations`: `crm_enabled` (generic CRM:
   `crm`, `crm_leads`, `crm_pipeline`) and `partner_crm_enabled` (the RTcompu partner
   pack: `crm_partners`, `crm_field_sales`, `crm_visits`, `crm_prospects`, `crm_events`,
   `crm_exports`, `crm_pjp`, `crm_sales`, `crm_reports`). **Org admins do not bypass
   these.** Set at bootstrap in `index.html` via `setCrmEnabled` / `setPartnerPack`.
2. **Per-role / per-user access**, from the `feature_access` table
   (`subject_type` role|user, `subject_key`, `feature_key`, `allowed`). Precedence:
   user override → role default → visible. Owners/admins bypass. `dashboard` is locked
   (always visible) so nobody is stranded.

`FEATURES` is the list of toggleable keys; `featureForRoute(path)` maps a route to its
key (with aliases: `employees|lifecycle|assets|letters → people`, `leave|attendance → me`,
`approvals → inbox`, `audit → admin`). Regression test: `tests/feature-gating.test.mjs`.

## 4. Events (the module boundary)

Modules never read each other's tables. They publish events and react.

- **Publish:** `js/events.js` `publishEvent(type, payload)` → the `publish_event` RPC
  (SECURITY DEFINER) → a row in `events` (`org_id`, `event_type`, `actor_id`, `payload`,
  `status`, `attempts`). Type format is `module.entity.action`.
- **Process:** `js/event-processor.js` runs in the browser after sign-in;
  `api/event-processor.js` is the serverless drain (batch 10, max 3 attempts) and the
  daily cron target (`vercel.json`: `0 3 * * *`, protected by `CRON_SECRET`).
- **Exactly-once effects:** `claim_events(batch_size)` leases rows, `claim_side_effect(event_id, effect_key)`
  records each side effect in `event_side_effects`, `resolve_event(...)` closes it,
  `requeue_stale_events(lease_seconds, max_attempts)` recovers stuck ones.
- **Live event types** (grep `publishEvent(` for the current list): attendance
  checkin/checkout/regularization, leave request created/approved/rejected and balance
  adjusted, people employee/department/asset events and bulk imports, documents
  file uploaded/deleted, finance expense created/approved, helpdesk ticket
  created/updated, crm lead created/updated, crm visit logged, crm pjp planned,
  crm event executed, crm partner deleted.
- `events` has no INSERT policy on purpose — writes go through the definer RPC.

## 5. Other platform services

| Concern | Where | Notes |
|---|---|---|
| Auth | `js/auth.js`, `login.html`, `reset-password.html` | email/password + Google OAuth; `SIGNED_OUT` and `PASSWORD_RECOVERY` handled |
| Notifications | `js/notifications.js`, `api/send-notification.js`, `notifications` table | in-app + email (Resend); realtime subscription for the unread badge |
| Audit | `js/audit.js` → `log_audit(...)` definer RPC → `audit_logs` | append-only; `entity_id` is NOT NULL — passing null makes the call fail silently |
| Files | Supabase Storage + `files` table | `entity_type`/`entity_id` link a file to any row |
| Global search | `js/search.js` | Postgres FTS (`tsvector` + GIN) on `users`, `candidates`, `jobs` |
| AI panel | `js/ai.js` | the in-app assistant surface; its backend is off until v1.4.0 (see `ai.md`) |
| CSV | `js/csv.js` | shared export/import helper |
| UI kit | `js/ui.js` | `esc, toast, openModal, closeModal, formatDate, timeAgo, initials, avColor, scoreBar, stagePill, showError, loadingSkeleton, backButton, getAuthToken, getOrgId, orgId` |
| Public API | `api_keys`, `webhook_endpoints`, `webhook_deliveries`, `rate_limits` | outbound webhooks are enqueued by `enqueue_webhook_deliveries`; `rate_limit_hit(key, limit, window)` guards abuse |

## 6. Conventions that reviewers enforce

- Tables and columns `snake_case`; JS files `kebab-case`; functions `camelCase`;
  CSS classes `kebab-case`; events `module.entity.action`.
- `const` by default, `let` when reassigned, never `var`; `async/await`; early returns.
- **Every Supabase call checks `error`.** Loads → 503, missing row → 404, write → 500.
- Compose CSS classes from `css/tokens.css` + `css/components.css`. No token-laced
  inline `style=""`, no emoji as icons (inline SVG only). See `DESIGN.md`.
- User-supplied strings pass `esc()` before `innerHTML`; `toast()` and `textContent`
  are already safe.

## 7. Gotchas that have bitten before

- `audit_logs.entity_id` is NOT NULL — roughly a dozen `logAction` calls pass null and
  fail silently. Fix when you touch them.
- The service-role client in `api/` bypasses RLS: an endpoint that forgets an `org_id`
  check is a cross-tenant leak. v1.2.0 fixed two of these in matching and JD parsing.
- `.single()` on zero rows returns a PGRST116 **error**, not an empty result. Use
  `.maybeSingle()` for lookups, or a missing row turns into a 503.
- Preview deployments share the **production** database. Any write on a preview is real.
- `core.autocrlf=true` on this machine: compare file bytes with `git show <rev>:<path>`,
  never the working copy.
