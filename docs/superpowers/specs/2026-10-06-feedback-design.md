# Private in-app feedback — design

- **Date:** 2026-10-06
- **Status:** design approved in conversation by the owner (approach A).
  This file is for the owner's review before the implementation plan.
- **Release:** v1.15.0 (MINOR — a new feature).
- **Part of:** the owner's four-piece sequence, piece **3 of 4**:
  1. sign-up — v1.12.0, live;
  2. trial — v1.13.0, live;
  3. **feedback** — this spec;
  4. home page — v1.14.x, live, moved ahead by the owner.

## 1. Why

The owner wants to hear from the people using Atllanta: trial companies
deciding whether to stay, and existing staff. That feedback should be
**private**, read only by the platform owner and never shown publicly.
Nothing like it exists today. The only "feedback" in the codebase is
interview feedback in Recruitment, which is unrelated.

## 2. Decisions (owner, 2026-10-05 / 2026-10-06)

| Question | Decision |
|---|---|
| Who writes | Anyone signed in, existing staff and trial companies alike. |
| Who reads | **Only the platform owner.** Not even the sender's company admins. Nothing public. |
| What an entry holds | **Type** (Idea / Problem / Praise), an **optional 1–5 rating**, and a **message**. |
| Where it is sent from | The **account menu in both apps**, and the **`/paused` page**, so blocked companies can say why they didn't continue. |
| Approach | **A:** one `/feedback` page that both apps link to, one guarded `submit_feedback()` database function that stamps the sender itself, and platform-only read functions. |
| Replies, threads, attachments, public testimonials | Out of scope. |

## 3. Sending feedback

### `/feedback` (new stack: `app/(auth)/feedback/page.tsx` and a client form)

- **Not signed in** → `/login`. No `users` row → `/start`.
- **The form:**
  - **Type:** three choice buttons, Idea, Problem and Praise. Required.
  - **Rating:** five stars, optional, clearable.
  - **Message:** required, 1–2,000 characters (trimmed), with a counter.
- **The page the person came from** is passed as `?from=<path>`, kept only
  if it is a same-site path, and stored as `page`.
- **Submit** calls the Server Action `submitFeedback`.
  - On success: "Thanks — this goes straight to the Atllanta team." with a
    **Back** link to `from` (or `/`).
  - On failure: the message is shown in place.
- **Works for blocked companies.** The page does *not* redirect blocked
  people to `/paused`, and the database function does not use
  `auth_org_id()`.

### Entry points

- **Legacy shell (`public/index.html`):** a "Send feedback" item in the
  account menu, above Sign out. It does a full page load to
  `/feedback?from=<current hash route>`.
- **New stack:** a "Send feedback" link on `/paused`, plus a small link in
  the `/hrms/*` layouts' header row. There is no new-stack account menu
  yet.
- **`/paused`:**
  - owners and admins: "Tell us why — send feedback";
  - everyone else: "Send feedback";
  - both link to `/feedback?from=/paused`.

## 4. Data (written by Claude, not delegated)

New migration `…_platform_feedback.sql`.

```
platform_feedback(
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete set null,
  org_id uuid references organizations(id) on delete set null,
  role text,                      -- the sender's role when sent
  kind text not null check (kind in ('idea','problem','praise')),
  rating smallint check (rating between 1 and 5),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  page text check (page is null or char_length(page) <= 300),
  read_at timestamptz,
  created_at timestamptz not null default now()
)
```

- Index on `(created_at desc)`, plus a partial index on unread rows.
- `user_id` is nullable only so `on delete set null` can work: feedback
  outlives a deleted account. The insert path always sets it.
- **RLS is enabled with no policies.** `select`, `insert`, `update` and
  `delete` are all revoked from `anon` and `authenticated`. The table is
  reached only through the functions below.

### Functions

All three are `security definer` with a fixed `search_path`; `anon` is
revoked and `authenticated` granted.

**`submit_feedback(p_kind text, p_rating int, p_message text, p_page text) returns uuid`**

- **Refusals:**
  - signed out → 42501;
  - no `users` row → 42501;
  - bad kind, rating or message length → 22023;
  - more than **10 entries from this user in the last 24 hours** → 22023,
    "You've sent a lot of feedback today — please try again tomorrow".
- **Stamps:** `user_id = auth.uid()`, and `org_id` and `role` from the
  caller's own `users` row, read **directly** (not via `auth_org_id()`) so
  blocked companies can still send.
- **`page`:** kept only when it starts with `/` and not `//`; null otherwise.
- **In one transaction:** inserts the row, then one `notifications` row for
  every platform admin:
  - `org_id` = that admin's own org;
  - module `platform`, entity `feedback`;
  - title "New feedback: {Idea|Problem|Praise}";
  - body = the sender's company name and the first 120 characters of the
    message;
  - `channel 'in_app'`, `status 'unread'`, `email_status 'none'`.

**`platform_feedback_list(p_only_unread boolean default false, p_kind text default null)`**

- Platform admin only (42501 otherwise).
- Returns `id, created_at, kind, rating, message, page, read_at,
  user_name, user_email, role, org_name`, newest first, limit 500.

**`platform_feedback_mark_read(p_id uuid, p_read boolean default true)`**

- Platform admin only.
- Sets or clears `read_at`; refuses with 22023 if the id is unknown.

**Audit:** submitting writes no audit row (the row is its own record).
Marking read changes nothing a company owns.

## 5. Reading (platform owner)

### `/platform` gains tabs: Companies | Feedback (N unread)

- `app/(platform)/platform/layout.tsx` (new) checks the platform admin
  once for both tabs, using the existing `isPlatformAdmin()` and
  `notFound()`, and renders the tab links. The Companies page moves under
  it unchanged.
- **`/platform/feedback`** lists entries, newest first:
  - type badge, stars, message (pre-wrapped), person and email, company,
    role, page, date, and read or unread;
  - filters: All / Unread, and All types / Idea / Problem / Praise
    (query string);
  - **Mark read** / **Mark unread** per row (Server Action
    `markFeedbackRead`).
- **The unread count** comes from `platform_feedback_list(true)` (its row
  count) and shows on the tab.
- **The bell:** new feedback shows in the platform owner's notification
  bell in the legacy shell, which already lists `notifications`. Clicking
  it does nothing special; the owner opens `/platform/feedback`.

## 6. Server side (new stack)

- `src/lib/platform/feedback/schemas.ts`:
  - `submitFeedbackSchema`: `kind` enum; `rating` 1–5 or null; `message`
    trimmed 1–2000; `page` optional, max 300, must start with `/`;
  - `markReadSchema`: `id` uuid, `read` boolean.
- `src/lib/platform/feedback/actions.ts` (`"use server"`):
  - `submitFeedback`: requires a session; calls `submit_feedback` inside
    `withTransaction` as the caller; maps the function's own 42501/22023
    messages through an allow-list (the v1.13.0 `explain` pattern), with a
    generic fallback;
  - `markFeedbackRead`: calls `platform_feedback_mark_read`, then
    `revalidatePath("/platform/feedback")`.
- No service role anywhere.

## 7. Service worker and proxy

- Add `/feedback` to `NETWORK_ONLY_PREFIXES`. `/platform` is already there.

## 8. Testing

### Unit (`tests/feedback.test.mjs`)

- **Migration, static checks:**
  - RLS on, with no table grants to `anon` or `authenticated`;
  - the function checks and stamps;
  - the org is read from `users`, not `auth_org_id()`;
  - the 10-per-24h limit;
  - `page` sanitising;
  - one notification per platform admin;
  - the platform functions check `is_platform_admin()`;
  - grants.
- **Schemas:** kinds; rating bounds and null; message bounds after trim;
  `page` must be a path.
- **Static checks on the app:**
  - the action runs as the caller and uses the allow-list, with no service
    role;
  - `/feedback` redirects as specified and does *not* send blocked people
    to `/paused`;
  - the legacy menu item exists and links with `from`;
  - `/paused` links to `/feedback?from=/paused`;
  - the platform layout checks the admin;
  - the service worker lists `/feedback`.

### Production probe (always rolled back, before applying and again live)

1. A normal RTcompu member submits → the row has their user, org and role;
   the platform admin gets 1 notification.
2. That member cannot `select` the table directly (0 rows, or permission
   denied), and cannot call `platform_feedback_list` (42501).
3. A member of an **expired** company can still submit.
4. Bad kind, bad rating, an empty message, or a 2,001-character message →
   22023.
5. The 11th submission within 24 hours → 22023.
6. `page = '//evil.com'` → stored as null; `'/hrms/leave'` → stored.
7. The platform admin lists it, marks it read, then unread.
8. Anon calling `submit_feedback` → refused.

### Gates

- Typecheck, lint and build pass.
- The migration is applied only after the owner's yes, and the file is
  then renamed to its recorded version.

## 9. Release notes (v1.15.0)

**What changed:**

- **Send feedback** from the account menu (or from the trial-ended page):
  pick Idea, Problem or Praise, rate us if you like, and tell us more.
  It goes privately to the Atllanta team.
- For the Atllanta platform owner: a **Feedback** tab on the platform
  screen, and a bell notification for each new entry.

**Admins need to:** nothing.
