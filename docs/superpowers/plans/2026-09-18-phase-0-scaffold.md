# Phase 0 — Next.js scaffold on the shared deployment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js + TypeScript + Drizzle + Tailwind/shadcn skeleton inside
this repo, deployed as the **single** Vercel deployment for `atllanta.vercel.app`, with
the frozen legacy app still serving every user exactly as it does today.

**Architecture:** Next.js owns the deployment. The legacy static app moves under
`public/` (its absolute `/js`, `/css`, `/views` paths keep working) and `/` rewrites to
`public/index.html`, so nothing users touch changes. The 12 legacy serverless endpoints
move behind **one** catch-all Node API route that dispatches to the existing handler
modules unchanged, which keeps the deployment inside the function cap. Nothing new is
user-visible at the end of Phase 0: the new stack exists, builds, deploys and talks to
the database, and serves one internal health page.

**Tech Stack:** Next.js (App Router, React 19, Node 24), TypeScript strict, Drizzle ORM
+ Drizzle Kit against the existing Supabase Postgres, Tailwind CSS + shadcn/ui,
`node:test` for the legacy suite (unchanged).

**Spec:** `CLAUDE.md` (target architecture) and `TRANSITION.md` (Phase 0 checklist,
verified baseline, owner decisions). Legacy rules: `docs/legacy/CLAUDE-legacy.md`.
Module map: `docs/context/`.

## Global Constraints

- **Production must not change behaviour in this phase.** Same URLs, same screens, same
  sign-in. `BASE_URL=<url> node tests/browser-verify.mjs` → 22/22 before and after.
- **`npm run test:unit` (110 tests at v1.2.0) keeps passing**, with test file paths
  updated only where a file physically moved.
- **The legacy app is frozen** (`legacy-frozen` = `a7431b2`): the only legacy edits
  allowed here are the mechanical moves this plan names. No behaviour changes, no
  refactors, no "while I'm here".
- **One Vercel deployment, one domain.** No new project, no subdomain.
- **Function budget:** the deployment must build with **at most 12 serverless
  functions**. Legacy endpoints collapse to one catch-all; Next adds its own.
- **No schema changes.** Drizzle is introspection-only in Phase 0: no `db:push`, no
  generated migration is applied. The database is shared with the live app.
- **Secrets stay server-side.** `SUPABASE_SERVICE_ROLE_KEY` may never be imported into a
  client component or exposed through `NEXT_PUBLIC_*`.
- **Design tokens come from `css/tokens.css`** (DESIGN.md is the authority); Tailwind is
  configured against those values rather than its default palette.
- Every task ends green: `npm run build`, `npm run test:unit`, and a preview deploy.

## File map

| Path | Responsibility |
|---|---|
| `package.json` | Next scripts (`dev`, `build`, `start`, `typecheck`) + existing test scripts |
| `next.config.mjs` | rewrites: `/` and legacy pages → `public/`; legacy `/api/*` → the catch-all |
| `tsconfig.json`, `next-env.d.ts` | TypeScript strict config |
| `app/layout.tsx`, `app/(health)/health/page.tsx` | app shell + the one internal page Phase 0 ships |
| `pages/api/[...legacy].js` | single Node route that dispatches to the legacy handlers |
| `public/` | the legacy app: `index.html`, `login.html`, `css/`, `js/`, `views/`, `sw.js`, `manifest.json`, icons, `version.json` |
| `server/legacy/` | the 12 legacy handler modules, moved from `api/`, otherwise untouched |
| `lib/` | unchanged server helpers (`supabaseServer.js`, `aiGateway.js`, `langfuse.js`, `googleMeet.js`) |
| `src/db/index.ts`, `src/db/schema/platform.ts` | Drizzle client + introspected platform schema |
| `drizzle.config.ts` | Drizzle Kit config (introspect only) |
| `tailwind.config.ts`, `app/globals.css`, `components/ui/` | Tailwind + shadcn base mapped to the design tokens |
| `tests/scaffold.test.mjs` | guards: no service-role key in client bundles, legacy assets present, function budget |

---

### Task 1: Prove the deployment shape before building on it

A spike. Its output is evidence in the report, not code we keep beyond the scaffold.

**Files:** none permanent — work on branch `claude/phase-0-spike`.

- [ ] **Step 1: Record today's baseline**

```bash
gh api repos/marcilinous/atllanta/deployments --jq '.[0].id' >/dev/null   # sanity: gh works
curl -s https://atllanta.vercel.app/version.json          # {"version":"1.2.0"}
BASE_URL=https://atllanta.vercel.app node tests/browser-verify.mjs   # 22 passed
```

- [ ] **Step 2: Scaffold a throwaway Next app in the repo root**

```bash
npx create-next-app@latest . --ts --app --tailwind --eslint --no-src-dir --import-alias "@/*" --use-npm --yes
```
Keep the generated `app/`, `next.config`, `tsconfig.json`; do not delete any legacy file.

- [ ] **Step 3: Move the legacy app under `public/` and the endpoints behind one route**

```bash
git mv index.html login.html reset-password.html privacy.html terms.html schedule.html public/
git mv css js views sw.js manifest.json version.json icon-192.svg icon-512.svg public/
mkdir -p server/legacy && git mv api/*.js server/legacy/
```
Add `pages/api/[...legacy].js`:

```js
// One function for every legacy endpoint. Vercel counts functions, not routes,
// and the 12 legacy handlers keep their exact (req, res) signature.
const handlers = {
  "parse-resume": () => import("../../server/legacy/parse-resume.js"),
  "extract-candidate": () => import("../../server/legacy/extract-candidate.js"),
  match: () => import("../../server/legacy/match.js"),
  "screen-job": () => import("../../server/legacy/screen-job.js"),
  schedule: () => import("../../server/legacy/schedule.js"),
  "google-auth": () => import("../../server/legacy/google-auth.js"),
  "event-processor": () => import("../../server/legacy/event-processor.js"),
  "create-org": () => import("../../server/legacy/create-org.js"),
  "bulk-import": () => import("../../server/legacy/bulk-import.js"),
  reports: () => import("../../server/legacy/reports.js"),
  "send-notification": () => import("../../server/legacy/send-notification.js"),
  "ai-query": () => import("../../server/legacy/ai-query.js"),
};

export const config = { api: { bodyParser: { sizeLimit: "5mb" } } };

export default async function handler(req, res) {
  const [name] = req.query.legacy || [];
  const load = handlers[name];
  if (!load) return res.status(404).json({ error: "Not found" });
  const mod = await load();
  return mod.default(req, res);
}
```

`next.config.mjs`:

```js
const legacyPages = ["login", "reset-password", "privacy", "terms", "schedule"];

export default {
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/index.html" },
        ...legacyPages.map((p) => ({ source: `/${p}`, destination: `/${p}.html` })),
      ],
    };
  },
};
```

- [ ] **Step 4: Answer the three questions this spike exists for**

```bash
npm run build                      # must succeed
BASE_URL=http://localhost:3000 node tests/browser-verify.mjs   # after `npm start`
```
Then deploy the branch and record, in the report:
1. **Function count** on the preview (Vercel deployment → Functions). Must be ≤ 12.
2. **Legacy parity** on the preview: `/` serves the legacy shell, `/login` works,
   `/version.json` reads 1.2.0, `/api/ai-query` returns 503, `/api/extract-candidate`
   without a token returns 401, and `BASE_URL=<preview> node tests/browser-verify.mjs`
   passes 22/22.
3. **Cron**: `vercel.json`'s `crons` entry still targets `/api/event-processor` and the
   catch-all answers it (call it with the `CRON_SECRET` header on the preview).

- [ ] **Step 5: Report, then stop**

Write findings to the task report. **If the function count exceeds 12, or legacy parity
fails, stop and report — do not proceed to Task 2.** Either is a plan-level problem the
controller must rule on (consolidate further, or raise the cap with the owner).

### Task 2: Land the scaffold and the relocation for real

**Files:** as Task 1 Steps 2–3, plus `package.json`, `.vercelignore`, `tests/`.

- [ ] **Step 1: Bring the spike's tree onto a clean branch** `claude/phase-0-scaffold`,
      committing in two commits: (a) the Next scaffold, (b) the legacy relocation.

- [ ] **Step 2: Fix every path the move broke**

```bash
grep -rn "\.\./api/\|'api/\|\"api/" tests/*.mjs | head -20
```
Test files copy handlers into a temp dir; update those paths from `api/<name>.js` to
`server/legacy/<name>.js`. `tests/vercelignore.test.mjs` and
`tests/service-worker.test.mjs` reference `/css`, `/js`, `sw.js` — update to their
`public/` locations. Do not change what any test asserts, only where it looks.

- [ ] **Step 3: Update `.vercelignore` and `package.json`**

`.vercelignore` keeps `/docs`, `/supabase`, `/tests`, `CLAUDE.md`, `TRANSITION.md`,
`DESIGN.md`, `README.md`, `.superpowers`, `playwright.config.js`. **`server/`, `lib/`,
`app/`, `pages/`, `public/` and `src/` must not be ignored** — a wrong line here breaks
the build, which is why `tests/vercelignore.test.mjs` exists.

`package.json` scripts: `dev`, `build`, `start`, `typecheck` (`tsc --noEmit`),
plus the existing `test:unit`, `test:e2e`, `test:browser`.

- [ ] **Step 4: Guard the new shape with tests** — add `tests/scaffold.test.mjs`:

```js
// The scaffold must not leak server secrets into the browser bundle, and the
// legacy app must still be served from public/. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');

test('the legacy shell and its assets live under public/', () => {
  for (const p of ['public/index.html', 'public/login.html', 'public/sw.js',
                   'public/version.json', 'public/js/router.js', 'public/css/tokens.css',
                   'public/views/dashboard.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), `missing ${p}`);
  }
});

test('every legacy endpoint is reachable through the catch-all', () => {
  const route = fs.readFileSync(path.join(ROOT, 'pages/api/[...legacy].js'), 'utf8');
  for (const name of fs.readdirSync(path.join(ROOT, 'server/legacy')).filter(f => f.endsWith('.js'))) {
    assert.ok(route.includes(`server/legacy/${name}`), `${name} not wired into the catch-all`);
  }
});

test('no server-only secret is referenced from app/ or components/', () => {
  const offenders = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) {
        const src = fs.readFileSync(p, 'utf8');
        if (src.includes('SUPABASE_SERVICE_ROLE_KEY') || src.includes('GROQ_API_KEY')) offenders.push(p);
      }
    }
  };
  walk(path.join(ROOT, 'app'));
  walk(path.join(ROOT, 'components'));
  assert.deepEqual(offenders, []);
});
```

- [ ] **Step 5: Verify, commit, preview**

```bash
npm run build && npm run typecheck && npm run test:unit
```
Push, then on the preview URL: `/version.json` = 1.2.0, `/` = legacy shell,
`BASE_URL=<preview> node tests/browser-verify.mjs` = 22/22, function count ≤ 12.

### Task 3: Drizzle against the existing database (read-only)

**Files:** `drizzle.config.ts`, `src/db/index.ts`, `src/db/schema/platform.ts`,
`.env.example`.

- [ ] **Step 1: Install and configure**

```bash
npm i drizzle-orm postgres && npm i -D drizzle-kit
```

```ts
// drizzle.config.ts — introspection only in Phase 0. Never run db:push here:
// the legacy app owns this schema until its screens are retired.
import type { Config } from "drizzle-kit";
export default {
  schema: "./src/db/schema/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  schemaFilter: ["public"],
} satisfies Config;
```

- [ ] **Step 2: Introspect the live schema into typed tables**

```bash
npx drizzle-kit introspect
```
Keep **only** the platform tables in `src/db/schema/platform.ts` for now
(`organizations`, `users`, `departments`, `teams`, `invitations`, `audit_logs`,
`events`, `notifications`, `files`, `feature_access`). Delete the rest of the
introspected output — later phases introspect their own tables.

- [ ] **Step 3: The client**

```ts
// src/db/index.ts — server-only. Uses the pooled connection string; RLS still
// applies to whatever role the connection uses, so this never replaces the
// per-request Supabase client for user-scoped reads.
import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/platform";

const client = postgres(process.env.DATABASE_URL!, { prepare: false });
export const db = drizzle(client, { schema });
```

- [ ] **Step 4: Prove it reads, without writing**

Add `app/(health)/health/page.tsx`: a server component that counts organisations and
users through Drizzle and renders the two numbers plus the app version. No mutations.
Add `DATABASE_URL` (Supabase pooled connection string, port 6543) to `.env.example` and
to Vercel for Production and Preview.

- [ ] **Step 5: Verify and commit** — `npm run build`, `npm run typecheck`, then on the
      preview `/health` shows 5 organisations and 67 users (today's live numbers).

### Task 4: Tailwind and shadcn on the existing design tokens

**Files:** `tailwind.config.ts`, `app/globals.css`, `components/ui/*`, `app/layout.tsx`.

- [ ] **Step 1: Map the tokens** — read `css/tokens.css` (now `public/css/tokens.css`)
      and `DESIGN.md` §2–§4, then express the same palette, spacing scale, radii and
      typography as Tailwind theme values. Dark mode uses the `[data-theme="dark"]`
      selector the legacy app already sets, via `darkMode: ['selector', '[data-theme="dark"]']`.

- [ ] **Step 2: Install the shadcn base**

```bash
npx shadcn@latest init
npx shadcn@latest add button input label card dialog table badge
```
Accept the tokens from Step 1; do not accept shadcn's default palette.

- [ ] **Step 3: Prove parity visually** — extend `/health` with one row of each
      component, then compare against the legacy screens at `/` for colour, radius and
      spacing. Record the comparison in the report (screenshots or measured values).

- [ ] **Step 4: Verify and commit** — `npm run build`, `npm run typecheck`,
      `npm run test:unit`.

### Task 5: Close Phase 0 in the record

**Files:** `TRANSITION.md`, `docs/context/index.md`, `docs/context/ops.md`,
`docs/context/journal.md`.

- [ ] **Step 1:** Check off Phase 0 items 3, 4 and 5; add Notes naming the commits and
      the verified function count; mark the phase `✅ Done` and bump `Current State` to
      `v0.1.0` **only when Phase 1 completes** — Phase 0 has no version of its own.
- [ ] **Step 2:** Update `docs/context/ops.md` (build and deploy now go through Next;
      new commands; where legacy files live) and `docs/context/index.md` §2 (repo map).
- [ ] **Step 3:** Add a journal entry: the deployment shape, the catch-all trick, the
      function count, and the two risks recorded below.
- [ ] **Step 4:** Commit, push, open the PR for the owner.

---

## Risks carried into Phase 1 and 2 (record, don't fix here)

1. **Two session stores.** The legacy app uses `@supabase/supabase-js` from a CDN with
   its default **localStorage** session; Next Server Components need the session in
   **cookies** (`@supabase/ssr`). Until that is reconciled, a user signed into the
   legacy app is anonymous to a new-stack page. Phase 2 must switch the legacy client to
   cookie storage (a small, surgical legacy change) or accept a second sign-in. Decide
   before the first user-facing Next screen ships.
2. **The service worker precaches `/` and `/index.html`.** Returning visitors can be
   served the legacy shell from cache after a module cuts over. Every cutover must bump
   `CACHE_NAME` and, for the first Next route that replaces a legacy screen, add a
   navigation-scope rule (or unregister and re-register the worker).
3. **Function budget is now shared.** Every new Next route handler counts against the
   same cap as the legacy catch-all. Check the count on each preview before merging.
4. **Cron depends on the catch-all.** `/api/event-processor` runs daily at 03:00 UTC; if
   the dispatch table loses that key, events stop draining silently. `tests/scaffold.test.mjs`
   guards it.
