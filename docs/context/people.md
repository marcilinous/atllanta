# People / HRMS module

The employee side of the product: who works here, when they worked, what they asked
for, what they hold, and what they spent. Largest module by screen count.

---

## 1. Screens

| Route | File | Purpose |
|---|---|---|
| `me` | `views/me/index.js` | self-service home: today's attendance, my leave, my requests |
| `dashboard` | `views/dashboard.js` | org home: KPIs, noticeboard (`posts`), quick actions |
| `people` | `views/people/index.js` | People hub |
| `employees` | `views/employees/list.js` | directory with search/filters |
| `employees/profile` | `views/employees/profile.js` | one employee: details, history, documents |
| `employees/orgchart` | `views/employees/orgchart.js` | reporting tree (`reporting_manager_id`) |
| `employees/import` | `views/employees/import.js` | CSV bulk import → `api/bulk-import.js` |
| `lifecycle` / `letters` | `views/people/lifecycle.js`, `letters.js` | joining→exit stages, generated letters |
| `assets` | `views/people/assets.js` | asset register and assignments |
| `attendance` | `views/attendance/dashboard.js` | team attendance overview |
| `attendance/checkin` | `views/attendance/checkin.js` | check in/out (geofence aware) |
| `attendance/regularize` | `views/attendance/regularize.js` | raise/approve corrections |
| `attendance/report` | `views/attendance/report.js` | range report, queried directly under RLS |
| `leave` | `views/leave/apply.js` | apply for leave |
| `leave/approvals` | `views/leave/approvals.js` | manager/HR queue |
| `leave/balances` | `views/leave/balances.js` | balances per type per year |
| `leave/calendar` | `views/leave/calendar.js` | who's away |
| `leave/report` | `views/leave/report.js` | leave reporting |
| `leave/settings` | `views/leave/settings.js` | leave types, accrual, holidays |
| `finance` | `views/finance/index.js` | expenses: submit, review, approve |
| `finance/categories` | `views/finance/categories.js` | expense categories |
| `helpdesk` | `views/helpdesk/index.js` | tickets |
| `helpdesk/settings` | `views/helpdesk/settings.js` | categories and handlers |
| `documents` | `views/documents/index.js` | document store (Storage + `files`) |
| `announcements` | `views/announcements/index.js` | announcements |
| `inbox` / `approvals` | `views/inbox.js`, `views/approvals.js` | unified approvals inbox |
| `onboarding` | `views/onboarding.js` | first-run setup for a new org |
| `settings/*` | `views/settings/org.js` (839 lines), `users.js`, `departments.js`, `profile.js`, `integrations.js` | org profile, module access, users, departments/teams, Google integration |

## 2. Tables

`users`, `departments`, `teams`, `invitations`,
`attendance`, `attendance_regularizations`, `work_schedules`, `work_locations`,
`holidays`, `leave_types`, `leave_balances`, `leave_requests`,
`assets`, `asset_assignments`, `expenses`, `expense_categories`,
`helpdesk_categories`, `helpdesk_category_handlers`, `helpdesk_tickets`,
`announcements`, `posts`, `files`, `feature_access`.

Per-tenant configuration lives in `leave_types`, `work_schedules`, `work_locations`,
`holidays`, `expense_categories`, `helpdesk_categories` (+ handlers) — changing a
tenant's workflow means changing these rows, never the code.

## 3. Database functions used here

- `hr_can_approve()`, `hr_can_configure()`, `hr_visible_user_ids()` — who may act on
  whose People data (policies use these).
- `apply_leave_usage(user, leave_type, year, days)` — moves balance when leave is taken.
- `enforce_attendance_geofence()` — trigger; rejects check-ins outside a work location
  (`geo_distance_m` does the maths).
- `expenses_guard_review()` — trigger; stops a submitter approving their own expense.
- `users_guard_admin_fields()` — trigger; stops a member editing role/org fields.
- `auth_user_id_by_email(email)` — invitation flow.

## 4. Events this module publishes

`people.employee.created|updated`, `people.employees.bulk_imported`,
`people.employees.bulk_status_changed`, `people.department.created|deleted`,
`people.asset.created|assigned|returned`,
`attendance.checkin.completed`, `attendance.checkout.completed`,
`attendance.regularization.requested|created|approved`,
`leave.request.created|approved|rejected`, `leave.balance.adjusted`,
`finance.expense.created|approved`, `helpdesk.ticket.created|updated`,
`documents.file.uploaded|deleted`.

Reactions live in the event processor (`js/event-processor.js`, `api/event-processor.js`):
new employee → leave balances for the year + notify manager/HR; leave request → notify
manager (and HR if > 3 days); approval → update balance and attendance; 3rd late in a
month → notify manager.

## 5. Working notes

- `views/settings/org.js` is the biggest file in the repo and mixes org profile, module
  access and policy settings. If you touch it substantially, split by tab rather than
  adding to it.
- Attendance and leave are the two flows where tenants differ most; check
  `work_schedules` and `leave_types` before assuming a rule is global.
- Reports query Supabase directly from the browser, under RLS. The old service-role
  `api/reports.js` was removed in v1.2.4: it had no org filter at all.
