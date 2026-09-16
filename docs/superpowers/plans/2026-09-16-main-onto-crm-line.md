# Port main onto the CRM line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `main`'s features onto `claude/gstack-skill-install-chnb41` (the branch production deploys), phase by phase, without ever shipping code that reads the dropped `memberships`/`clients` tenancy.

**Architecture:** Production already runs the CRM line, and the live database already carries main's backend (security RPCs, rate limits, webhooks, API keys, analytics). The work is therefore code-only and flows one way: each phase is a branch off the CRM line, merged back by PR, deployed to production on merge. Phase 0 is fully specified below. Phases 1–7 are scoped with verified inventories; each gets its own task-level plan, written against the code as it stands when the previous phase lands.

**Tech Stack:** Vanilla JS ES modules, Vercel functions (Node 24, 12-function Hobby cap), Supabase Postgres + RLS, `node:test` for unit tests, Playwright library for browser checks.

**Spec:** No separate spec. The decision record and verified facts below are the spec.

## Decision record (2026-09-16)

- PR #99 (`claude/crm-into-main`, main + CRM) is **not merged**. Signed in on its preview, `js/auth.js` requests `memberships` and Supabase returns 404; the org never resolves and the partner CRM is off for RTcompu. 18 files / 40 references on that branch use `memberships`.
- Direction chosen by the owner: **keep the CRM line as the base and port main onto it** (not the reverse).
- Keep `claude/crm-into-main` as a **reference source**, do not delete it. Its `views/crm/*`, `js/features.js` and `app.html` already reconcile main's CRM with the gen-2 partner screens; later phases copy from it where noted.

## Verified facts this plan depends on

Checked 2026-09-16 against production Supabase `nburswxjpukntgdwuyme` (shared by production and every preview) and the deployed code.

| Fact | Evidence |
|---|---|
| Production (`atllanta.vercel.app`) serves the CRM line | Latest Production deployment `2b8e7c4`; its `/js/auth.js` reads `from('users')` |
| `memberships`, `clients` tables and `jobs.client_id` do not exist | `to_regclass` / `information_schema` |
| No DB function references `memberships` or `client_id` | `pg_proc.prosrc` scan |
| Present: `publish_event`, `log_audit`, `claim_events`, `resolve_event` (2- and 3-arg), `claim_side_effect`, `apply_leave_usage`, `consume_credits`, `rate_limit_hit`, `requeue_stale_events`, `analytics_run_sql`, `enqueue_webhook_deliveries`, `is_org_admin`, `users_guard_admin_fields` | `pg_proc`; all executable by `authenticated` |
| Present tables: `feature_access`, `rate_limits`, `webhook_endpoints`, `webhook_deliveries`, `api_keys`, `event_side_effects`, `analytics_*`, `atllanta_leads`, `credit_ledger` | `to_regclass` |
| `events` and `audit_logs` have **only a SELECT policy** | `pg_policies` |
| The CRM line writes both with a direct `.insert()` (`js/events.js:9`, `js/audit.js:9`) → rejected by RLS. Newest `events` row 2026-08-05, newest `audit_logs` row 2026-08-29 | code + `max(created_at)` |
| The CRM line's browser processor sets `events.status` with direct `.update()` (`js/event-processor.js:52,59,67`) → silently no-ops under RLS | code + `pg_policies` |
| `claim_events` scopes to `auth_user_org_ids()`, so it returns nothing for the service role | function body |
| The CRM line's `api/event-processor.js` accepts **POST only**; Vercel Cron invokes with **GET** → the daily cron gets 405. It also runs unauthenticated when `CRON_SECRET` is unset | code, `vercel.json` crons |
| Groq shut down `llama-3.3-70b-versatile` on 2026-08-16, replacement `openai/gpt-oss-120b` | console.groq.com/docs/deprecations table; main commit `4ab02cc` |
| The CRM line still uses that model in 6 files: `api/ai-query.js:3`, `api/extract-candidate.js:8`, `api/match.js:12`, `api/parse-resume.js:13`, `api/screen-job.js:10`, `js/ai.js:6` | `git grep` |
| Columns main's browser processor needs exist: `notifications.email_status`, `jobs.hiring_manager_id`, `events.locked_at`, `events.last_error` | `information_schema` |

## Global Constraints

- Never read or write `memberships`, `clients`, or `client_id`. Tenant key is `org_id`; the caller's org comes from `users.org_id` (CLAUDE.md §4).
- `anon` key + RLS only in browser code. Never `service_role` outside `api/` and `lib/`.
- Vercel functions stay at **12**. Adding one means folding another (main folded `extract-candidate` into `parse-resume.js?action=extract-candidate` to make room for `api/lead.js`).
- No new npm runtime dependencies. Supabase JS via CDN in the browser.
- No schema changes are expected. If one turns out to be needed: apply with the Supabase `apply_migration` tool, then save the file under the exact version recorded in `supabase_migrations.schema_migrations` (CLAUDE.md "Migration history").
- Keep the CRM line's design system (`css/tokens.css`, `DESIGN.md`, per-module accents). Do not take main's `tokens.css`.
- Previews use the **production database**. Verification that writes data needs the owner's consent first; prefer the rolled-back SQL checks given below.
- Each phase ends with: `npm run test:unit` green, `node tests/browser-verify.mjs` 21/21 against the preview (`BASE_URL=<preview>`), and a signed-in check on the preview by the owner.

---

## Phase map

| Phase | Scope | Why this order |
|---|---|---|
| **0** | Production fixes: event/audit writes via RPC, safe browser + server event processors, Groq model | Production is broken today; smallest change, no UI |
| 1 | Server platform: `lib/ratelimit.js`, `lib/email.js`, `lib/provisionMember.js`, `lib/langfuse.js`, `lib/supabaseServer.js`; hardened `api/*` (create-org, bulk-import, match, screen-job, parse-resume + fold extract-candidate, send-notification, schedule, google-auth, reports, ai-query); main's server event processor (side-effect ledger, requeue, webhooks dispatch, analytics alerts, email dispatch of `email_status='pending'`) | Security remediation (P0-01…P0-16, OPS-10) is server-side and independent of UI |
| 2 | Public site + shell: move app to `app.html`, landing at `index.html`, `404.html`, `robots.txt`, `sitemap.xml`, `og-image.png`, `login.html`, `manifest.json`, `sw.js`, `vercel.json` rewrites/headers | Changes every URL; do it once, before UI phases add routes |
| 3 | People/HR: geofenced attendance + selfie + `views/attendance/locations.js`, `views/hr/attendance-console.js`, graded HR access in `views/settings/users.js`, `views/settings/access.js`, `views/notifications.js`, offline outbox (`js/outbox.js`, `js/outbox-handlers.js`, `js/image.js`), error states in core views, `views/dashboard.js`, employees import/list | Depends on Phase 1 provisioning + Phase 2 shell |
| 4 | Recruitment + AI: candidate outreach, interview questions, matcher AI scoring, assistant on ai-query engine, shortlist, jobs | Depends on Phase 1 `api/*` |
| 5 | Integrations + founder tools: `views/settings/integrations.js` (webhooks, API keys), `supabase/functions/api-gateway`, `views/sales/leads.js` + `api/lead.js` (`atllanta_leads`), `test/tenant-isolation.sql` | Needs the 12-function slot freed in Phase 1 |
| 6 | CRM gen-1 screens missing on this line (`accounts`, `account-detail`, `contacts`, `contact-detail`, `lead-detail`, `lead-actions`, `opportunity-detail`, `activities`, `settings`, `common`, `telecalling*`, `coverage`, `opportunities-coverage`, `targets`, `visits`, `views/reports/crm.js`), taken from `claude/crm-into-main` per its CLAUDE.md §16 | Largest UI surface; §16 already decided which files are generic vs partner |
| 7 | Docs + tooling: merge CLAUDE.md §15/§16, `docs/HANDOVER.md`, `docs/architecture.html`, `docs/analytics-setup.md`, `mobile/`, `.agents/skills` | No runtime effect |

Every phase's own plan must start by re-running, for each file it touches: `git grep -n "memberships\|client_id\|organization_id" <file>` on the source version, and resolve each hit to `users`/`org_id` before copying.

---

## Phase 0 — production fixes

**Branch:** `claude/phase0-event-bus-groq`, created from `claude/gstack-skill-install-chnb41`, PR back into it.

**Pre-merge manual step (owner):** In Vercel → atllanta → Settings → Environment Variables, confirm `CRON_SECRET` exists for **Production**. Task 3 makes the endpoint refuse to run without it. Today the cron already fails (405), so this is not a regression, but without the variable the fix does nothing.

### Task 1: Write events and audit rows through the RPCs

**Files:**
- Modify: `js/events.js` (whole file, 18 lines)
- Modify: `js/audit.js` (whole file, 22 lines)
- Test: `tests/event-writes.test.mjs` (create)

**Interfaces:**
- Consumes: DB `publish_event(p_event_type text, p_payload jsonb default '{}', p_org_id uuid default null) returns uuid`; `log_audit(p_module text, p_entity_type text, p_entity_id uuid, p_action text, p_old jsonb default null, p_new jsonb default null, p_org_id uuid default null) returns uuid`
- Produces: unchanged exports `publishEvent(eventType, payload)` and `logAction(module, entityType, entityId, action, oldValues, newValues)` (208 call sites keep working)

- [ ] **Step 1: Write the failing test**

Create `tests/event-writes.test.mjs`:

```js
// Event and audit writes must go through the SECURITY DEFINER RPCs.
// events and audit_logs have no INSERT policy, so a direct insert is
// rejected by RLS and the row is silently lost.  Run: node --test tests/
//
// js/events.js and js/audit.js import ./supabase.js (CDN + window) and
// ./auth.js, so both are copied next to stubs and imported from there.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let tmp, stub, events, audit;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-writes-'));
  fs.writeFileSync(path.join(tmp, 'supabase.js'), `
    export const calls = [];
    export default {
      rpc(name, args) { calls.push({ kind: 'rpc', name, args }); return Promise.resolve({ data: 'row-id', error: null }); },
      from(table) {
        calls.push({ kind: 'from', table });
        return { insert() { return Promise.resolve({ error: null }); } };
      },
    };
  `);
  fs.writeFileSync(path.join(tmp, 'auth.js'), `
    export function getUser() { return { id: 'user-1' }; }
    export function getOrg() { return { id: 'org-1' }; }
  `);
  for (const f of ['events.js', 'audit.js']) {
    fs.copyFileSync(path.join(ROOT, 'js', f), path.join(tmp, f));
  }
  stub = await import(pathToFileURL(path.join(tmp, 'supabase.js')).href);
  events = await import(pathToFileURL(path.join(tmp, 'events.js')).href);
  audit = await import(pathToFileURL(path.join(tmp, 'audit.js')).href);
});

after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });
beforeEach(() => { stub.calls.length = 0; });

describe('publishEvent', () => {
  test('calls publish_event with the org and payload', async () => {
    await events.publishEvent('leave.request.created', { leave_request_id: 'lr-1' });
    assert.deepEqual(stub.calls, [{
      kind: 'rpc', name: 'publish_event',
      args: { p_event_type: 'leave.request.created', p_payload: { leave_request_id: 'lr-1' }, p_org_id: 'org-1' },
    }]);
  });

  test('sends an empty object when there is no payload', async () => {
    await events.publishEvent('platform.ping');
    assert.deepEqual(stub.calls[0].args.p_payload, {});
  });

  test('never inserts into events directly', async () => {
    await events.publishEvent('x.y.z', {});
    assert.equal(stub.calls.some(c => c.kind === 'from'), false);
  });
});

describe('logAction', () => {
  test('calls log_audit with every field', async () => {
    await audit.logAction('people', 'user', 'u-9', 'update', { a: 1 }, { a: 2 });
    assert.deepEqual(stub.calls, [{
      kind: 'rpc', name: 'log_audit',
      args: { p_module: 'people', p_entity_type: 'user', p_entity_id: 'u-9', p_action: 'update', p_old: { a: 1 }, p_new: { a: 2 }, p_org_id: 'org-1' },
    }]);
  });

  test('passes null for missing old/new values', async () => {
    await audit.logAction('crm', 'lead', 'l-1', 'delete');
    assert.equal(stub.calls[0].args.p_old, null);
    assert.equal(stub.calls[0].args.p_new, null);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/event-writes.test.mjs`
Expected: FAIL — `calls publish_event with the org and payload` shows `kind: 'from', table: 'events'` instead of the rpc; 4 of 5 fail (`passes null…` fails on `calls[0].args` being undefined).

- [ ] **Step 3: Replace `js/events.js`**

```js
import sb from './supabase.js';
import { getOrg } from './auth.js';

export async function publishEvent(eventType, payload) {
  const org = getOrg();
  if (!org) return;

  // Events are written through a trusted RPC that stamps the actor (auth.uid())
  // and validates org membership server-side. The events table has no INSERT
  // policy, so a direct insert is rejected by RLS.
  const { error } = await sb.rpc('publish_event', {
    p_event_type: eventType,
    p_payload: payload ?? {},
    p_org_id: org.id,
  });

  if (error) console.error('Event publish failed:', error.message);
}
```

- [ ] **Step 4: Replace `js/audit.js`**

```js
import sb from './supabase.js';
import { getOrg } from './auth.js';

export async function logAction(module, entityType, entityId, action, oldValues, newValues) {
  const org = getOrg();
  if (!org) return;

  // Audit rows are written through a trusted RPC that stamps the actor
  // (auth.uid()) and validates org membership server-side. audit_logs has no
  // INSERT policy, so a direct insert is rejected by RLS. The log stays
  // append-only.
  const { error } = await sb.rpc('log_audit', {
    p_module: module,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_action: action,
    p_old: oldValues || null,
    p_new: newValues || null,
    p_org_id: org.id,
  });

  if (error) console.error('Audit log failed:', error.message);
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `node --test tests/event-writes.test.mjs`
Expected: 5 pass, 0 fail.

- [ ] **Step 6: Confirm the RPCs accept a real signed-in caller, without persisting anything**

Run through the Supabase `execute_sql` tool (project `nburswxjpukntgdwuyme`). First pick any active user id: `select id from users where status = 'active' limit 1;` then substitute it:

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '<user-id>', 'role', 'authenticated')::text, true);
select publish_event('plan.phase0.check', '{}'::jsonb) as event_id,
       log_audit('platform', 'check', null, 'phase0') as audit_id;
rollback;
```

Expected: one row with two non-null uuids. `rollback` discards both rows.

- [ ] **Step 7: Commit**

```bash
git add js/events.js js/audit.js tests/event-writes.test.mjs
git commit -m "Write events and audit rows through the RPCs, since RLS rejects direct inserts"
```

### Task 2: Replace the browser event processor with the claim-based one

**Files:**
- Modify: `js/event-processor.js` (whole file) — replace with `origin/main:js/event-processor.js`, which uses only `./supabase.js` and `getUser`/`getOrg` from `./auth.js` (both exported on this line, `js/auth.js:50-51`)
- Test: `tests/event-processor-browser.test.mjs` (create)

**Interfaces:**
- Consumes: DB `claim_events(batch_size int default 20) returns setof events`, `resolve_event(event_id uuid, new_status text[, p_error text])`, `claim_side_effect(p_event_id uuid, p_effect_key text) returns boolean`, `apply_leave_usage(p_user_id uuid, p_leave_type_id uuid, p_year int, p_days numeric)`
- Produces: unchanged exports `startEventProcessor()`, `stopEventProcessor()` (imported by `index.html:151`)

- [ ] **Step 1: Write the failing test**

Create `tests/event-processor-browser.test.mjs`:

```js
// The browser event processor must claim events through claim_events and
// finish them through resolve_event. events has no UPDATE policy, so direct
// status updates are silently dropped and the same event would be processed
// (notifications sent, leave deducted) on every poll.  Run: node --test tests/

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let tmp, loads = 0;

// Shared, per-test state read by the stub client.
const S = globalThis.__eventTest = { calls: [], queue: [], firstTime: true, failTable: null };

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-proc-'));
  fs.writeFileSync(path.join(tmp, 'supabase.js'), `
    const S = globalThis.__eventTest;
    function chain(table) {
      const ops = [];
      const c = {};
      for (const m of ['select','insert','update','upsert','delete','eq','in','gte','lt','order','limit','single','maybeSingle']) {
        c[m] = (...a) => { ops.push([m, ...a]); return c; };
      }
      c.then = (resolve, reject) => {
        S.calls.push({ kind: 'from', table, ops });
        if (S.failTable === table) return reject(new Error('boom'));
        const data = table === 'users' ? { reporting_manager_id: null, full_name: 'Test User' } : null;
        return resolve({ data, error: null, count: 0 });
      };
      return c;
    }
    export default {
      from: (t) => chain(t),
      rpc(name, args) {
        S.calls.push({ kind: 'rpc', name, args });
        if (name === 'claim_events') return Promise.resolve({ data: S.queue.splice(0), error: null });
        if (name === 'claim_side_effect') return Promise.resolve({ data: S.firstTime, error: null });
        if (name === 'apply_leave_usage') return Promise.resolve({ data: 3, error: null });
        return Promise.resolve({ data: null, error: null });
      },
    };
  `);
  fs.writeFileSync(path.join(tmp, 'auth.js'), `
    export function getUser() { return { id: 'user-1' }; }
    export function getOrg() { return { id: 'org-1' }; }
  `);
});

after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

beforeEach(() => { S.calls = []; S.queue = []; S.firstTime = true; S.failTable = null; });

// Load a fresh copy of the processor (module state such as `processing` and
// the interval must not leak between tests), run one poll, then stop it.
async function runOnce(event) {
  const file = path.join(tmp, `event-processor-${++loads}.js`);
  fs.copyFileSync(path.join(ROOT, 'js', 'event-processor.js'), file);
  const P = await import(pathToFileURL(file).href);
  S.queue = [event];
  P.startEventProcessor();
  const deadline = Date.now() + 2000;
  while (!S.calls.some(c => c.name === 'resolve_event') && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10));
  }
  P.stopEventProcessor();
}

const rpcs = (name) => S.calls.filter(c => c.kind === 'rpc' && c.name === name);

describe('claiming and resolving', () => {
  test('claims through claim_events and never updates events directly', async () => {
    await runOnce({ id: 'ev-1', event_type: 'leave.request.rejected', attempts: 1, payload: { user_id: 'u-2', leave_request_id: 'lr-1' } });
    assert.equal(rpcs('claim_events').length, 1);
    assert.equal(S.calls.some(c => c.kind === 'from' && c.table === 'events'), false);
    assert.deepEqual(rpcs('resolve_event')[0].args, { event_id: 'ev-1', new_status: 'completed' });
  });

  test('a failing handler re-queues the event with the error', async () => {
    S.failTable = 'notifications';
    await runOnce({ id: 'ev-2', event_type: 'leave.request.rejected', attempts: 1, payload: { user_id: 'u-2', leave_request_id: 'lr-1' } });
    const args = rpcs('resolve_event')[0].args;
    assert.equal(args.event_id, 'ev-2');
    assert.equal(args.new_status, 'pending');
    assert.match(args.p_error, /boom/);
  });

  test('a third failed attempt marks the event failed', async () => {
    S.failTable = 'notifications';
    await runOnce({ id: 'ev-3', event_type: 'leave.request.rejected', attempts: 3, payload: { user_id: 'u-2', leave_request_id: 'lr-1' } });
    assert.equal(rpcs('resolve_event')[0].args.new_status, 'failed');
  });
});

describe('leave approval is applied at most once', () => {
  const approved = { id: 'ev-4', event_type: 'leave.request.approved', attempts: 1,
    payload: { user_id: 'u-2', approved_by: 'u-3', leave_request_id: 'lr-1', leave_type_id: 'lt-1', days: '2' } };

  test('first run claims the side effect, then applies the usage', async () => {
    await runOnce(approved);
    const order = S.calls.filter(c => c.kind === 'rpc').map(c => c.name);
    assert.ok(order.indexOf('claim_side_effect') < order.indexOf('apply_leave_usage'));
    assert.deepEqual(rpcs('claim_side_effect')[0].args, { p_event_id: 'ev-4', p_effect_key: 'leave_used' });
    assert.deepEqual(rpcs('apply_leave_usage')[0].args, { p_user_id: 'u-2', p_leave_type_id: 'lt-1', p_year: new Date().getFullYear(), p_days: 2 });
  });

  test('a retry whose side effect was already claimed does not deduct again', async () => {
    S.firstTime = false;
    await runOnce(approved);
    assert.equal(rpcs('apply_leave_usage').length, 0);
    assert.equal(S.calls.some(c => c.kind === 'from' && c.table === 'leave_balances'), false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/event-processor-browser.test.mjs`
Expected: FAIL — every test times out waiting for `resolve_event` (the current file never calls it), and `claims through claim_events…` reports `claim_events` count 0.

- [ ] **Step 3: Take main's processor**

```bash
git show origin/main:js/event-processor.js > js/event-processor.js
```

Check it matches what this plan was written against:

```bash
git grep -c "memberships\|client_id" -- js/event-processor.js   # expect: no output
grep -c "rpc('claim_events'\|rpc('resolve_event'\|rpc('claim_side_effect'\|rpc('apply_leave_usage'" js/event-processor.js   # expect: 5
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/event-processor-browser.test.mjs`
Expected: 5 pass, 0 fail.

- [ ] **Step 5: Run the whole unit suite**

Run: `npm run test:unit`
Expected: all files pass (feature-gating 10, event-writes 5, event-processor-browser 5).

- [ ] **Step 6: Commit**

```bash
git add js/event-processor.js tests/event-processor-browser.test.mjs
git commit -m "Claim events through claim_events so the browser processor stops re-running them"
```

### Task 3: Make the server processor reachable by cron, authenticated, and exclusive

**Files:**
- Modify: `api/event-processor.js` — only the `handler` function (currently lines 407–468). Recipes above it are unchanged.
- Test: `tests/event-processor-api.test.mjs` (create)

**Interfaces:**
- Consumes: `supabaseAdmin()` from `lib/supabaseServer.js:12`; env `CRON_SECRET`
- Produces: `GET|POST /api/event-processor` → `200 { processed, failed, skipped, total }`; `401` wrong/missing bearer; `500` when `CRON_SECRET` unset; `405` other methods

- [ ] **Step 1: Write the failing test**

Create `tests/event-processor-api.test.mjs`:

```js
// The cron endpoint must (1) accept GET, which is how Vercel Cron calls it,
// (2) refuse to run without CRON_SECRET, and (3) claim each event with a
// conditional update so it never runs a recipe the browser processor already
// claimed.  Run: node --test tests/

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const S = globalThis.__apiTest = { calls: [], pending: [], claimWins: true };
let tmp, handler;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atllanta-api-'));
  fs.mkdirSync(path.join(tmp, 'api'));
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.writeFileSync(path.join(tmp, 'lib', 'supabaseServer.js'), `
    const S = globalThis.__apiTest;
    function chain(table) {
      const ops = [];
      const c = {};
      for (const m of ['select','insert','update','upsert','eq','in','lt','gte','order','limit','single','maybeSingle']) {
        c[m] = (...a) => { ops.push([m, ...a]); return c; };
      }
      c.then = (resolve) => {
        S.calls.push({ table, ops });
        const names = ops.map(o => o[0]);
        if (table === 'events' && names[0] === 'select') return resolve({ data: S.pending, error: null });
        if (table === 'events' && names[0] === 'update' && names.includes('select')) {
          return resolve({ data: S.claimWins ? [{ id: 'ev-1' }] : [], error: null });
        }
        return resolve({ data: null, error: null });
      };
      return c;
    }
    export function supabaseAdmin() { return { from: (t) => chain(t) }; }
    export const SUPABASE_URL = 'https://stub.supabase.co';
  `);
  fs.copyFileSync(path.join(ROOT, 'api', 'event-processor.js'), path.join(tmp, 'api', 'event-processor.js'));
  handler = (await import(pathToFileURL(path.join(tmp, 'api', 'event-processor.js')).href)).default;
});

after(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); delete process.env.CRON_SECRET; });

beforeEach(() => {
  S.calls = []; S.pending = []; S.claimWins = true;
  process.env.CRON_SECRET = 'test-secret';
  delete process.env.RESEND_API_KEY;   // recipes must never reach Resend from a test
});

function res() {
  return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}
const req = (method, auth) => ({ method, headers: auth ? { authorization: auth } : {} });

describe('access', () => {
  test('refuses to run when CRON_SECRET is not set', async () => {
    delete process.env.CRON_SECRET;
    const r = res();
    await handler(req('GET', 'Bearer anything'), r);
    assert.equal(r.statusCode, 500);
    assert.equal(S.calls.length, 0);
  });

  test('rejects a missing or wrong bearer token', async () => {
    const a = res(); await handler(req('GET'), a);
    const b = res(); await handler(req('GET', 'Bearer nope'), b);
    assert.equal(a.statusCode, 401);
    assert.equal(b.statusCode, 401);
    assert.equal(S.calls.length, 0);
  });

  test('accepts GET with the right token, which is how Vercel Cron calls it', async () => {
    const r = res();
    await handler(req('GET', 'Bearer test-secret'), r);
    assert.equal(r.statusCode, 200);
  });

  test('rejects other methods', async () => {
    const r = res();
    await handler(req('PUT', 'Bearer test-secret'), r);
    assert.equal(r.statusCode, 405);
  });
});

describe('claiming', () => {
  const event = { id: 'ev-1', event_type: 'people.employee.created', attempts: 0,
    payload: { employee_id: 'u-1', org_id: 'org-1' } };

  test('claims with a conditional update on status = pending', async () => {
    S.pending = [event];
    await handler(req('GET', 'Bearer test-secret'), res());
    const claim = S.calls.find(c => c.table === 'events' && c.ops[0][0] === 'update');
    assert.ok(claim, 'expected a claim update');
    assert.deepEqual(claim.ops.filter(o => o[0] === 'eq'), [['eq', 'id', 'ev-1'], ['eq', 'status', 'pending']]);
    assert.ok(claim.ops.some(o => o[0] === 'select'));
  });

  test('skips an event another processor already claimed', async () => {
    S.pending = [event];
    S.claimWins = false;
    const r = res();
    await handler(req('GET', 'Bearer test-secret'), r);
    assert.equal(S.calls.some(c => c.table === 'leave_types'), false, 'recipe must not run');
    assert.deepEqual(r.body, { processed: 0, failed: 0, skipped: 1, total: 1 });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/event-processor-api.test.mjs`
Expected: FAIL — `refuses to run when CRON_SECRET is not set` gets 405 (GET rejected); `accepts GET…` gets 405; the claiming tests find no conditional `eq('status','pending')`.

- [ ] **Step 3: Replace the `handler` function in `api/event-processor.js`**

Replace everything from `export default async function handler(req, res) {` to the end of the file with:

```js
export default async function handler(req, res) {
  // Vercel Cron calls with GET and sends CRON_SECRET as a bearer token.
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Use GET or POST" });
  }

  // Fail closed: this endpoint runs service-role recipes for every org, so it
  // must never be callable without the secret.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return res.status(500).json({ error: "Server misconfigured: CRON_SECRET is not set" });
  }
  if ((req.headers.authorization || "") !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const sb = supabaseAdmin();

  const { data: events, error } = await sb
    .from("events")
    .select("*")
    .eq("status", "pending")
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at")
    .limit(BATCH_SIZE);

  if (error) return res.status(500).json({ error: error.message });
  if (!events?.length)
    return res.status(200).json({ processed: 0, failed: 0, skipped: 0, total: 0 });

  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const event of events) {
    // Claim only if still pending. The browser processor claims through
    // claim_events(); whichever claims first runs the recipe, the other skips.
    const { data: claimed, error: claimError } = await sb
      .from("events")
      .update({ status: "processing", attempts: event.attempts + 1, locked_at: new Date().toISOString() })
      .eq("id", event.id)
      .eq("status", "pending")
      .select("id");

    if (claimError || !claimed?.length) {
      skipped++;
      continue;
    }

    const recipe = recipes[event.event_type];
    try {
      if (recipe) await recipe(sb, event);
      await sb
        .from("events")
        .update({ status: "completed", processed_at: new Date().toISOString(), locked_at: null, last_error: null })
        .eq("id", event.id);
      processed++;
    } catch (err) {
      const newStatus = event.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending";
      await sb
        .from("events")
        .update({
          status: newStatus,
          locked_at: null,
          last_error: String(err?.message || err).slice(0, 500),
          ...(newStatus === "failed" ? { failed_at: new Date().toISOString() } : {}),
        })
        .eq("id", event.id);
      failed++;
    }
  }

  return res.status(200).json({ processed, failed, skipped, total: events.length });
}
```

Note the empty-queue response changed from `{ processed: 0, message }` to `{ processed: 0, failed: 0, skipped: 0, total: 0 }`. Nothing reads it except the cron log (`git grep -n "api/event-processor"` finds only `vercel.json`).

- [ ] **Step 4: Confirm `failed_at` exists before relying on it**

Run through `execute_sql`: `select column_name from information_schema.columns where table_schema='public' and table_name='events' and column_name in ('failed_at','locked_at','last_error');`
Expected: 3 rows. If `failed_at` is missing, delete the `...(newStatus === "failed" ? …)` line and re-run Step 5.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `node --test tests/event-processor-api.test.mjs`
Expected: 6 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add api/event-processor.js tests/event-processor-api.test.mjs
git commit -m "Let Vercel Cron reach the event processor, fail closed without CRON_SECRET, and claim events exclusively"
```

### Task 4: Switch Groq to the replacement model

**Files:**
- Modify: `api/ai-query.js:3`, `api/extract-candidate.js:8`, `api/match.js:12`, `api/parse-resume.js:13`, `api/screen-job.js:10`, `js/ai.js:6`
- Test: `tests/groq-model.test.mjs` (create)

**Interfaces:**
- Consumes: Groq chat completions API, env `GROQ_API_KEY` (unchanged)
- Produces: no interface change

- [ ] **Step 1: Write the failing test**

Create `tests/groq-model.test.mjs`:

```js
// Groq shut down llama-3.3-70b-versatile on 2026-08-16; every call to it
// fails. Guard against it coming back through a merge.  Run: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RETIRED = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const REPLACEMENT = 'openai/gpt-oss-120b';

function sources(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(e => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return sources(rel);
    return /\.(js|mjs|ts)$/.test(e.name) ? [rel] : [];
  });
}

test('no source file uses a retired Groq model', () => {
  const hits = [];
  for (const file of [...sources('api'), ...sources('js'), ...sources('lib')]) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const model of RETIRED) if (text.includes(model)) hits.push(`${file}: ${model}`);
  }
  assert.deepEqual(hits, []);
});

test('every Groq caller names the replacement model', () => {
  const callers = ['api/ai-query.js', 'api/extract-candidate.js', 'api/match.js', 'api/parse-resume.js', 'api/screen-job.js', 'js/ai.js'];
  for (const file of callers) {
    assert.ok(fs.readFileSync(path.join(ROOT, file), 'utf8').includes(REPLACEMENT), `${file} should use ${REPLACEMENT}`);
  }
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test tests/groq-model.test.mjs`
Expected: FAIL — first test lists the 6 files; second fails on `api/ai-query.js`.

- [ ] **Step 3: Replace the model name**

```bash
sed -i 's#llama-3\.3-70b-versatile#openai/gpt-oss-120b#g' api/ai-query.js api/extract-candidate.js api/match.js api/parse-resume.js api/screen-job.js js/ai.js
git diff --stat   # expect: 6 files changed, 6 insertions(+), 6 deletions(-)
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --test tests/groq-model.test.mjs`
Expected: 2 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add api/ai-query.js api/extract-candidate.js api/match.js api/parse-resume.js api/screen-job.js js/ai.js tests/groq-model.test.mjs
git commit -m "Move Groq calls to openai/gpt-oss-120b; llama-3.3-70b-versatile was shut down on 2026-08-16"
```

### Task 5: Verify on the preview, then merge

**Files:** none changed unless a check fails.

- [ ] **Step 1: Push and open the PR into the production branch**

```bash
git push -u origin claude/phase0-event-bus-groq
gh pr create --base claude/gstack-skill-install-chnb41 --title "Phase 0: restore the event bus, audit log and AI on production" --body "<summary of Tasks 1-4 and the verified facts table>"
```

- [ ] **Step 2: Wait for the Vercel preview, then run the browser gating check against it**

This line's `tests/browser-verify.mjs` hardcodes `http://localhost:3000` and `index.html`. The version on `claude/crm-into-main` (commit `aba5506`) reads `BASE_URL`, detects `app.html` vs `index.html`, and carries both a `users` and a `memberships` fixture row, so it runs unchanged here. Take it first:

```bash
git show origin/claude/crm-into-main:tests/browser-verify.mjs > tests/browser-verify.mjs
npx serve . -p 3099 &    # local sanity run on a free port; port 3000 may be held by another checkout
BASE_URL=http://localhost:3099 node tests/browser-verify.mjs   # expect: app shell: index.html … 21 passed, 0 failed
git add tests/browser-verify.mjs
git commit -m "Let the browser gating check target any server and either app shell"
git push
```

Then, once the preview for that push is ready:

Run: `BASE_URL=<preview url> node tests/browser-verify.mjs`
Expected: `app shell: index.html` and `21 passed, 0 failed`.

- [ ] **Step 3: Confirm the preview's cron endpoint behaves**

Run: `curl -s -w " [%{http_code}]\n" <preview url>/api/event-processor`
Expected: `{"error":"Server misconfigured: CRON_SECRET is not set"} [500]` if Preview has no `CRON_SECRET`, otherwise `{"error":"Unauthorized"} [401]`. Either proves the method gate and fail-closed path. Do **not** call the production endpoint.

- [ ] **Step 4: Signed-in AI check on the preview (owner present, read-only)**

The owner signs in on the preview. Open the AI assistant and ask a read-only question ("how many employees are active?"). Expected: a normal answer, not an error toast.
If the answer is empty or cut off, `gpt-oss-120b` spent its token budget on reasoning: add `reasoning_effort: "low"` next to `max_tokens` in the request body of the failing endpoint, re-run `node --test tests/groq-model.test.mjs`, commit `"Keep gpt-oss-120b reasoning short so answers fit the token budget"`, push, and repeat this step.

- [ ] **Step 5: Signed-in event check (owner consents to one real write)**

With the owner's consent, perform one ordinary action that publishes an event and would be done anyway (for example, posting an announcement the owner intends to post). Then run through `execute_sql`:

```sql
select event_type, status, attempts, last_error, created_at
from events order by created_at desc limit 3;
select module, action, created_at from audit_logs order by created_at desc limit 3;
```

Expected: the new event row exists with `status = 'completed'` within ~30 seconds (claimed by the browser processor), `last_error` null; and any audit row the action writes is present.

- [ ] **Step 6: Merge**

Only after Steps 2–5 pass and the owner has confirmed `CRON_SECRET` exists for Production: merge the PR. Production redeploys from `claude/gstack-skill-install-chnb41`.

- [ ] **Step 7: Confirm the first real cron run (next day, 03:00 UTC)**

Vercel → atllanta → Logs, filter `/api/event-processor`. Expected: a `200` with `{ processed, failed, skipped, total }`, not `405`.

---

## Self-review

- **Coverage:** every production defect in the verified-facts table has a task — RLS-rejected inserts (Task 1), dropped status updates and double side effects (Task 2), cron 405 + fail-open secret + claim race (Task 3), retired model (Task 4). Merge gating and consent-bound checks are in Task 5. Phases 1–7 are scoped, not tasked, by design; each needs its own plan.
- **Placeholders:** Task 5 Step 1 `--body` and the preview URL are filled at execution time from real output; no code step is left undefined.
- **Names:** `publishEvent`, `logAction`, `startEventProcessor`, `stopEventProcessor`, `supabaseAdmin`, RPC argument names (`p_event_type`, `p_payload`, `p_org_id`, `p_module`, `p_entity_type`, `p_entity_id`, `p_action`, `p_old`, `p_new`, `batch_size`, `event_id`, `new_status`, `p_error`, `p_event_id`, `p_effect_key`, `p_user_id`, `p_leave_type_id`, `p_year`, `p_days`) match the live `pg_proc` signatures queried on 2026-09-16.

## Known risks carried forward

- **Emails from browser-claimed events:** main's browser processor marks notifications `email_status='pending'` and relies on main's server dispatcher to send them. This line's server processor does not dispatch those, so events claimed in the browser produce in-app notifications only until Phase 1 ports the dispatcher. Events the server claims still email as today.
- **`gpt-oss-120b` token budgets:** main ships `max_tokens: 300` for candidate extraction. Unverified whether reasoning tokens exhaust it; Task 5 Step 4 is the check.
- **`CRON_SECRET` on Production** is unconfirmed; the Vercel env listing was not accessible from this session.
