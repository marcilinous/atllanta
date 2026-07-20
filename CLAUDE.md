# CLAUDE.md — Atllanta Development Handover

> **What this file is:** The single source of truth for developing Atllanta. Read this completely before writing any code. Every architectural decision, naming convention, schema, and constraint is here. When in doubt, this file wins.

---

## 1. What Is Atllanta

Atllanta is a **Business Operating System** — a unified platform that connects people, customers, work, and operations into one product with shared identity, AI, search, workflows, and design.

**Current state:** Atllanta exists as a CV-to-JD matching and interview scheduling tool with Groq LLM integration.

**Target state:** Expand into a full Business OS while keeping the recruitment features as a core differentiator under the People app.

**One-line pitch:** Companies come for the AI hiring tool, stay for the employee management platform.

---

## 2. Stack

| Layer | Tool | Non-negotiable |
|-------|------|----------------|
| Database | **Supabase (PostgreSQL 15+)** | ✅ |
| Auth | **Supabase Auth** | ✅ |
| Storage | **Supabase Storage** | ✅ |
| Hosting | **Vercel** | ✅ |
| Frontend | **Vanilla JS + HTML + CSS** (no React/Next.js unless explicitly requested) | ✅ |
| AI / LLM | **Groq (LLaMA)** — already integrated | ✅ |
| Vector Search | **pgvector** (Supabase extension) | Later |
| Email | **Resend** | ✅ |
| WhatsApp | **Interakt or AiSensy** (BSP) | Later |
| Maps | **Google Maps JS API** | Later |

**Hard rules:**
- Zero monthly cost during build/pilot phase — free tiers only
- No React, no Next.js, no TypeScript unless Sachin explicitly asks
- No npm packages for things vanilla JS can do
- No Tailwind — write CSS directly
- Supabase client library (`@supabase/supabase-js`) via CDN, not npm

---

## 3. Architecture

### 3.1 Pattern: Modular Monolith

One Supabase project. One Vercel deployment. Modules are separated by folder structure and database schema boundaries — not by services or repos.

```
Atllanta (single deployment)
│
├── Platform Layer (shared services — every module uses these)
│     ├── Identity (auth, orgs, roles, permissions)
│     ├── Notifications (email, push, WhatsApp)
│     ├── Workflow Engine (event bus, recipes)
│     ├── Search (global search across modules)
│     ├── Files (document storage)
│     ├── Audit (action logging)
│     └── AI Assistant (Groq-powered Q&A and actions)
│
├── Application Layer (business logic — each module owns its data)
│     ├── People
│     │     ├── Employees
│     │     ├── Attendance
│     │     ├── Leave
│     │     └── Recruitment (CV-JD matching, shortlisting, interview scheduling)
│     ├── Customers (later)
│     ├── Work (later)
│     ├── Operations (later)
│     └── Finance Integrations (later)
│
└── Infrastructure
      ├── Supabase (Postgres + Auth + Storage + Edge Functions)
      └── Vercel (static hosting + serverless functions)
```

### 3.2 Core Rules

1. **Modules own their data.** The recruitment module never reads the attendance table directly — it calls the attendance API or listens to attendance events.
2. **No shared business logic.** Only shared platform services (auth, files, notifications, audit).
3. **Every mutation publishes an event.** Format: `module.entity.action` — e.g., `people.employee.created`, `recruitment.candidate.shortlisted`, `attendance.checkin.completed`.
4. **All data access goes through RLS.** No `service_role` key in frontend code. Ever.
5. **Every API endpoint checks permissions.** The AI assistant queries through the same permission layer as the UI.

---

## 4. Multi-Tenancy

**Model:** Shared database, row-level security per organization.

Every table that holds org-specific data has an `org_id` column. Every query is filtered by the authenticated user's `org_id` via Postgres RLS policies.

```sql
-- Standard RLS pattern for every org-scoped table
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org isolation" ON table_name
  USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Org insert" ON table_name
  FOR INSERT WITH CHECK (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
```

**Critical test:** Before building any feature, write a test that creates two orgs, inserts data in both, and verifies that user A cannot see user B's data under any query path. This test must pass at all times.

---

## 5. Database Schema

### 5.1 Platform Tables

```sql
-- ============================================================
-- ORGANIZATIONS
-- ============================================================
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  timezone TEXT DEFAULT 'Asia/Kolkata',
  currency TEXT DEFAULT 'INR',
  fiscal_year_start INTEGER DEFAULT 4, -- April
  date_format TEXT DEFAULT 'DD/MM/YYYY',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- USERS (extends Supabase auth.users)
-- ============================================================
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'manager', 'member')),
  designation TEXT,
  department_id UUID REFERENCES departments(id),
  team_id UUID REFERENCES teams(id),
  reporting_manager_id UUID REFERENCES users(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'on_notice', 'exited')),
  date_of_joining DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- DEPARTMENTS
-- ============================================================
CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  head_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- TEAMS
-- ============================================================
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  department_id UUID NOT NULL REFERENCES departments(id),
  name TEXT NOT NULL,
  lead_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- AUDIT LOG (append-only)
-- ============================================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  module TEXT NOT NULL, -- 'people', 'recruitment', 'attendance', etc.
  entity_type TEXT NOT NULL, -- 'employee', 'candidate', 'leave_request', etc.
  entity_id UUID NOT NULL,
  action TEXT NOT NULL, -- 'created', 'updated', 'deleted', 'approved', 'rejected'
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
-- No UPDATE or DELETE policies on audit_logs. Append only.

-- ============================================================
-- EVENTS (internal event bus)
-- ============================================================
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  event_type TEXT NOT NULL, -- 'people.employee.created', 'recruitment.candidate.shortlisted'
  actor_id UUID REFERENCES users(id),
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX idx_events_pending ON events(status, created_at) WHERE status = 'pending';

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT,
  module TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email', 'push', 'sms', 'whatsapp')),
  status TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'dismissed')),
  sent_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- FILES
-- ============================================================
CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  uploaded_by UUID NOT NULL REFERENCES users(id),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL, -- Supabase Storage path
  file_size INTEGER,
  mime_type TEXT,
  entity_type TEXT, -- 'employee', 'candidate', 'expense', etc.
  entity_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 5.2 People — Attendance Tables

```sql
-- ============================================================
-- WORK SCHEDULES
-- ============================================================
CREATE TABLE work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL, -- 'Default', 'Night Shift', etc.
  shift_start TIME NOT NULL DEFAULT '09:00',
  shift_end TIME NOT NULL DEFAULT '18:00',
  weekly_offs INTEGER[] DEFAULT '{1,7}', -- 1=Sunday, 7=Saturday
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ATTENDANCE
-- ============================================================
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  check_in_lat DECIMAL(10,7),
  check_in_lng DECIMAL(10,7),
  check_out_lat DECIMAL(10,7),
  check_out_lng DECIMAL(10,7),
  status TEXT DEFAULT 'present' CHECK (status IN ('present', 'absent', 'half_day', 'late', 'on_leave', 'holiday', 'weekly_off')),
  total_hours DECIMAL(4,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, date)
);

-- ============================================================
-- ATTENDANCE REGULARIZATION
-- ============================================================
CREATE TABLE attendance_regularizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  attendance_id UUID NOT NULL REFERENCES attendance(id),
  reason TEXT NOT NULL,
  requested_check_in TIMESTAMPTZ,
  requested_check_out TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 5.3 People — Leave Tables

```sql
-- ============================================================
-- LEAVE TYPES
-- ============================================================
CREATE TABLE leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL, -- 'Casual Leave', 'Sick Leave', 'Earned Leave', etc.
  code TEXT NOT NULL, -- 'CL', 'SL', 'EL'
  annual_quota INTEGER NOT NULL DEFAULT 12,
  carry_forward BOOLEAN DEFAULT false,
  max_carry_forward INTEGER DEFAULT 0,
  max_consecutive_days INTEGER,
  requires_document BOOLEAN DEFAULT false, -- e.g., medical certificate for SL > 2 days
  is_paid BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, code)
);

-- ============================================================
-- LEAVE BALANCES
-- ============================================================
CREATE TABLE leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  leave_type_id UUID NOT NULL REFERENCES leave_types(id),
  year INTEGER NOT NULL,
  opening_balance DECIMAL(4,1) DEFAULT 0,
  accrued DECIMAL(4,1) DEFAULT 0,
  used DECIMAL(4,1) DEFAULT 0,
  balance DECIMAL(4,1) GENERATED ALWAYS AS (opening_balance + accrued - used) STORED,
  UNIQUE(user_id, leave_type_id, year)
);

-- ============================================================
-- LEAVE REQUESTS
-- ============================================================
CREATE TABLE leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  leave_type_id UUID NOT NULL REFERENCES leave_types(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days DECIMAL(3,1) NOT NULL, -- supports half-days (0.5)
  reason TEXT,
  document_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- HOLIDAYS
-- ============================================================
CREATE TABLE holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  date DATE NOT NULL,
  is_optional BOOLEAN DEFAULT false,
  year INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 5.4 People — Recruitment Tables (Atllanta Core)

```sql
-- ============================================================
-- JOBS (Job Descriptions)
-- ============================================================
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  department_id UUID REFERENCES departments(id),
  description TEXT, -- raw JD text
  parsed_skills JSONB, -- AI-extracted: {must_have: [...], nice_to_have: [...]}
  experience_min INTEGER, -- years
  experience_max INTEGER,
  location TEXT,
  employment_type TEXT DEFAULT 'full_time' CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
  salary_min INTEGER,
  salary_max INTEGER,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'on_hold', 'closed')),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- CANDIDATES
-- ============================================================
CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  resume_url TEXT, -- Supabase Storage path
  resume_text TEXT, -- extracted plain text from resume
  parsed_skills JSONB, -- AI-extracted: {skills: [...], experience_years: N, education: [...]}
  source TEXT, -- 'manual', 'bulk_upload', 'career_page', 'referral'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- JOB APPLICATIONS (links candidates to jobs with match scores)
-- ============================================================
CREATE TABLE job_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  candidate_id UUID NOT NULL REFERENCES candidates(id),
  match_score DECIMAL(5,2), -- 0 to 100
  match_breakdown JSONB, -- {skills_match: 85, experience_match: 70, education_match: 90, overall: 81.5}
  match_method TEXT DEFAULT 'tfidf' CHECK (match_method IN ('tfidf', 'llm', 'manual')),
  status TEXT DEFAULT 'applied' CHECK (status IN ('applied', 'screening', 'shortlisted', 'interview_scheduled', 'interviewed', 'offered', 'hired', 'rejected')),
  shortlisted_at TIMESTAMPTZ,
  shortlisted_by UUID REFERENCES users(id),
  rejection_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(job_id, candidate_id)
);

-- ============================================================
-- INTERVIEW SCHEDULE
-- ============================================================
CREATE TABLE interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_application_id UUID NOT NULL REFERENCES job_applications(id),
  round_number INTEGER DEFAULT 1,
  round_name TEXT, -- 'Phone Screen', 'Technical', 'HR', 'Final'
  interviewer_id UUID REFERENCES users(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  location TEXT, -- 'Google Meet', 'Office Room 3', etc.
  meeting_link TEXT,
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled')),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  feedback TEXT,
  decision TEXT CHECK (decision IN ('advance', 'reject', 'hold', 'hire')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- INTERVIEW SLOTS (available time slots for scheduling)
-- ============================================================
CREATE TABLE interview_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  interviewer_id UUID NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  is_booked BOOLEAN DEFAULT false,
  interview_id UUID REFERENCES interviews(id),
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### 5.5 Enable RLS on All Tables

```sql
-- Run this for EVERY table listed above
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_regularizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_slots ENABLE ROW LEVEL SECURITY;

-- Standard org-isolation policy (apply to every org-scoped table)
-- Replace 'TABLE_NAME' for each table
CREATE POLICY "org_isolation_select" ON TABLE_NAME
  FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "org_isolation_insert" ON TABLE_NAME
  FOR INSERT WITH CHECK (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "org_isolation_update" ON TABLE_NAME
  FOR UPDATE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "org_isolation_delete" ON TABLE_NAME
  FOR DELETE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
```

### 5.6 Indexes

```sql
-- Performance-critical indexes
CREATE INDEX idx_users_org ON users(org_id);
CREATE INDEX idx_users_department ON users(department_id);
CREATE INDEX idx_users_manager ON users(reporting_manager_id);
CREATE INDEX idx_attendance_user_date ON attendance(user_id, date);
CREATE INDEX idx_attendance_org_date ON attendance(org_id, date);
CREATE INDEX idx_leave_requests_user ON leave_requests(user_id, status);
CREATE INDEX idx_leave_requests_org_status ON leave_requests(org_id, status);
CREATE INDEX idx_jobs_org_status ON jobs(org_id, status);
CREATE INDEX idx_candidates_org ON candidates(org_id);
CREATE INDEX idx_job_applications_job ON job_applications(job_id, status);
CREATE INDEX idx_job_applications_score ON job_applications(job_id, match_score DESC);
CREATE INDEX idx_interviews_application ON interviews(job_application_id);
CREATE INDEX idx_interviews_interviewer ON interviews(interviewer_id, scheduled_at);
CREATE INDEX idx_notifications_user ON notifications(user_id, status);
CREATE INDEX idx_audit_logs_org ON audit_logs(org_id, created_at DESC);
CREATE INDEX idx_events_pending ON events(status, created_at) WHERE status = 'pending';

-- Full-text search indexes
ALTER TABLE users ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(full_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(designation,''))) STORED;
CREATE INDEX idx_users_fts ON users USING gin(fts);

ALTER TABLE candidates ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(full_name,'') || ' ' || coalesce(email,'') || ' ' || coalesce(resume_text,''))) STORED;
CREATE INDEX idx_candidates_fts ON candidates USING gin(fts);

ALTER TABLE jobs ADD COLUMN fts tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))) STORED;
CREATE INDEX idx_jobs_fts ON jobs USING gin(fts);
```

---

## 6. File Structure

```
atllanta/
├── index.html                    # App shell — sidebar + main content area
├── login.html                    # Login / signup page
├── css/
│   ├── tokens.css                # Design tokens (colors, spacing, typography, radius)
│   ├── base.css                  # Reset, global styles, dark mode
│   ├── layout.css                # Sidebar, topbar, content grid
│   └── components.css            # Button, input, table, modal, toast, card, badge, empty-state
├── js/
│   ├── supabase.js               # Supabase client init, auth helpers
│   ├── router.js                 # Client-side view router (hash-based)
│   ├── auth.js                   # Login, signup, logout, session check
│   ├── api.js                    # Shared API helpers (CRUD, RLS-aware queries)
│   ├── events.js                 # Event publishing helper
│   ├── notifications.js          # Notification fetching + display
│   ├── search.js                 # Global search logic
│   ├── audit.js                  # Audit log writer
│   └── ai.js                    # Groq LLM integration (prompt builder, response parser)
├── views/
│   ├── dashboard.js              # Org dashboard — today's attendance, pending approvals, shortcuts
│   ├── employees/
│   │   ├── list.js               # Employee directory with search/filter
│   │   ├── profile.js            # Single employee profile
│   │   └── import.js             # Bulk CSV/XLSX import
│   ├── attendance/
│   │   ├── checkin.js            # Check-in / check-out UI
│   │   ├── dashboard.js          # Today's attendance overview
│   │   ├── report.js            # Monthly attendance report
│   │   └── regularize.js        # Regularization requests
│   ├── leave/
│   │   ├── apply.js              # Apply for leave
│   │   ├── calendar.js           # Team leave calendar
│   │   ├── balances.js           # My leave balances
│   │   ├── approvals.js          # Manager: pending leave approvals
│   │   └── settings.js           # Admin: leave types, policies, holidays
│   ├── recruitment/
│   │   ├── jobs.js               # Job listings (create, edit, open/close)
│   │   ├── job-detail.js         # Single job — candidates, shortlist, pipeline
│   │   ├── upload-resumes.js     # Bulk resume upload + parsing
│   │   ├── matcher.js            # CV-JD matching engine UI (run matching, view scores)
│   │   ├── shortlist.js          # Shortlisted candidates per job
│   │   ├── interviews.js         # Interview scheduling + calendar
│   │   └── candidate-profile.js  # Single candidate — resume, scores, interview history
│   ├── settings/
│   │   ├── org.js                # Organization settings
│   │   ├── users.js              # User management, invite, roles
│   │   ├── departments.js        # Departments & teams
│   │   └── integrations.js       # Connected integrations
│   └── ai/
│       └── assistant.js          # AI chat panel
├── workers/
│   └── event-processor.js        # Supabase Edge Function — polls events table, runs workflow recipes
├── api/
│   ├── parse-resume.js           # Vercel serverless — PDF/DOCX text extraction + Groq skill parsing
│   ├── parse-jd.js               # Vercel serverless — JD text → structured skills via Groq
│   ├── match.js                  # Vercel serverless — TF-IDF + Groq scoring
│   └── ai-query.js              # Vercel serverless — AI assistant backend (permission-aware)
├── supabase/
│   └── migrations/
│       ├── 001_platform.sql      # Organizations, users, departments, teams, audit, events, notifications, files
│       ├── 002_attendance.sql    # Work schedules, attendance, regularizations
│       ├── 003_leave.sql         # Leave types, balances, requests, holidays
│       ├── 004_recruitment.sql   # Jobs, candidates, applications, interviews, slots
│       └── 005_rls_policies.sql  # All RLS policies
├── public/
│   └── favicon.ico
├── vercel.json
└── README.md
```

---

## 7. UI Layout

**Pattern:** Sidebar-navigated multi-view layout.

```
┌──────────────────────────────────────────────────────┐
│ ┌──────┐  ┌──────────────────────────────────────┐   │
│ │      │  │  Topbar: Org name | Search | AI | 🔔  │   │
│ │  64px │  ├──────────────────────────────────────┤   │
│ │ icon  │  │                                      │   │
│ │ side  │  │                                      │   │
│ │ bar   │  │         Main Content Area            │   │
│ │      │  │                                      │   │
│ │ 🏠   │  │         (view loaded by router)       │   │
│ │ 👥   │  │                                      │   │
│ │ 📅   │  │                                      │   │
│ │ 🌿   │  │                                      │   │
│ │ 💼   │  │                                      │   │
│ │ ⚙️   │  │                                      │   │
│ │      │  │                                      │   │
│ └──────┘  └──────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

**Sidebar icons (top to bottom):**
1. Dashboard (home)
2. Employees (people)
3. Attendance (calendar/clock)
4. Leave (leaf/palm)
5. Recruitment (briefcase)
6. Settings (gear) — pinned to bottom

**Topbar:**
- Left: Organization name + logo
- Center: Global search bar
- Right: AI assistant toggle | Notifications bell | User avatar + dropdown

**Mobile (< 768px):**
- Sidebar collapses to bottom tab bar (5 icons max)
- Topbar becomes sticky header with hamburger menu for settings

---

## 8. Design Tokens

```css
/* css/tokens.css */

:root {
  /* Colors — neutral base with a single accent */
  --color-bg: #FFFFFF;
  --color-bg-secondary: #F7F8FA;
  --color-bg-tertiary: #EDEEF1;
  --color-surface: #FFFFFF;
  --color-border: #E2E4E9;
  --color-border-light: #F0F1F3;

  --color-text-primary: #1A1D23;
  --color-text-secondary: #6B7080;
  --color-text-tertiary: #9CA0AB;
  --color-text-inverse: #FFFFFF;

  --color-accent: #2563EB;        /* Primary action */
  --color-accent-hover: #1D4FD8;
  --color-accent-light: #EFF6FF;

  --color-success: #16A34A;
  --color-success-light: #F0FDF4;
  --color-warning: #D97706;
  --color-warning-light: #FFFBEB;
  --color-error: #DC2626;
  --color-error-light: #FEF2F2;
  --color-info: #2563EB;
  --color-info-light: #EFF6FF;

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;

  --text-xs: 0.75rem;     /* 12px */
  --text-sm: 0.8125rem;   /* 13px */
  --text-base: 0.875rem;  /* 14px — body default */
  --text-md: 1rem;        /* 16px */
  --text-lg: 1.125rem;    /* 18px */
  --text-xl: 1.25rem;     /* 20px */
  --text-2xl: 1.5rem;     /* 24px */
  --text-3xl: 1.875rem;   /* 30px */

  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  --line-height-tight: 1.25;
  --line-height-normal: 1.5;
  --line-height-relaxed: 1.625;

  /* Spacing — 4px base */
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
  --space-16: 4rem;     /* 64px */

  /* Radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-full: 9999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.08), 0 4px 6px -4px rgba(0,0,0,0.04);

  /* Sidebar */
  --sidebar-width: 64px;
  --topbar-height: 56px;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 200ms ease;
}

/* Dark mode */
[data-theme="dark"] {
  --color-bg: #0F1117;
  --color-bg-secondary: #1A1D27;
  --color-bg-tertiary: #252830;
  --color-surface: #1A1D27;
  --color-border: #2E3240;
  --color-border-light: #252830;

  --color-text-primary: #F0F1F3;
  --color-text-secondary: #9CA0AB;
  --color-text-tertiary: #6B7080;

  --color-accent: #3B82F6;
  --color-accent-hover: #60A5FA;
  --color-accent-light: #1E293B;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.4);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.5);
}
```

---

## 9. AI Integration (Groq)

### 9.1 Current: CV-JD Matching

Already built. The matching flow:

```
1. User uploads resumes (PDF/DOCX)
2. api/parse-resume.js extracts text → sends to Groq → gets structured skills/experience
3. User creates job with JD text
4. api/parse-jd.js sends JD to Groq → gets must-have/nice-to-have skills
5. api/match.js compares parsed resume vs parsed JD → generates match_score + breakdown
6. Results stored in job_applications table
7. UI shows ranked candidates with score breakdown
```

### 9.2 New: AI Assistant

The AI assistant is a **permission-aware Q&A and action layer** over the entire platform.

**Read-only queries (Phase 4):**
- "Who is absent today?" → query attendance table WHERE date = today AND status = 'absent'
- "Show pending leave approvals" → query leave_requests WHERE status = 'pending' AND reviewer = current user's reports
- "How many candidates are shortlisted for Backend Engineer?" → query job_applications
- "Summarize Ravi's attendance this month" → aggregate attendance for user

**Action execution (Phase 5):**
- "Approve Ravi's leave" → update leave_request, requires confirmation dialog
- "Schedule interview with Priya for Thursday 2 PM" → insert into interviews table
- "Shortlist top 5 candidates for Product Manager role" → update job_applications status

**Implementation pattern:**

```javascript
// js/ai.js — simplified flow
async function handleAIQuery(userMessage) {
  // 1. Send to Groq with system prompt that defines available actions
  const response = await callGroq({
    system: `You are Atllanta AI. You help with HR tasks.
             Available data: employees, attendance, leave, jobs, candidates, interviews.
             The current user's role is: ${currentUser.role}.
             The current user's org_id is: ${currentUser.org_id}.
             Today's date is: ${new Date().toISOString().split('T')[0]}.
             
             For data queries, respond with JSON:
             {"action": "query", "table": "...", "filters": {...}, "display": "table|text|chart"}
             
             For mutations, respond with JSON:
             {"action": "mutate", "table": "...", "operation": "update|insert", "data": {...}, "confirm": true}`,
    user: userMessage
  });

  // 2. Parse Groq response
  const intent = JSON.parse(response);

  // 3. Execute query through RLS-protected Supabase client (NEVER service_role)
  if (intent.action === 'query') {
    const data = await supabase.from(intent.table).select('*').match(intent.filters);
    // Display results
  }

  if (intent.action === 'mutate' && intent.confirm) {
    // Show confirmation dialog BEFORE executing
    showConfirmDialog(intent, async () => {
      await supabase.from(intent.table)[intent.operation](intent.data);
    });
  }
}
```

**Hard rule:** The AI NEVER uses the Supabase `service_role` key. All queries go through the standard `anon` key with RLS. If the user can't see it in the UI, the AI can't see it either.

---

## 10. Event System

Every state change publishes an event. Workers (Supabase Edge Functions or pg_cron) process them.

```javascript
// js/events.js
async function publishEvent(eventType, payload) {
  await supabase.from('events').insert({
    org_id: currentUser.org_id,
    event_type: eventType,
    actor_id: currentUser.id,
    payload: payload,
    status: 'pending'
  });
}

// Usage examples:
publishEvent('people.employee.created', { employee_id: '...', name: '...' });
publishEvent('recruitment.candidate.shortlisted', { job_id: '...', candidate_id: '...', score: 85 });
publishEvent('leave.request.approved', { leave_request_id: '...', approved_by: '...' });
publishEvent('attendance.checkin.completed', { user_id: '...', time: '...' });
```

**Predefined workflow recipes (Phase 3):**

| Event | → Actions |
|-------|-----------|
| `people.employee.created` | Create leave balances for current year → Notify reporting manager → Notify HR |
| `leave.request.created` | Notify reporting manager (email + in_app) → If > 3 days, also notify HR |
| `leave.request.approved` | Update leave balance → Update attendance status → Notify employee |
| `recruitment.candidate.shortlisted` | Notify hiring manager → Create interview scheduling task |
| `attendance.checkin.completed` | If late (> 15 min after shift start), mark as 'late' → Notify manager if 3rd late this month |

---

## 11. API Endpoints

All API routes are Vercel serverless functions under `/api/`.

```
POST   /api/parse-resume          # Upload resume → extract text → Groq parse → return structured data
POST   /api/parse-jd              # JD text → Groq parse → return structured skills
POST   /api/match                 # Job ID + candidate IDs → run matching → store scores
POST   /api/ai-query              # Natural language query → Groq → execute → return results
POST   /api/bulk-import           # CSV/XLSX → parse → insert employees/candidates
POST   /api/send-notification     # Send email/WhatsApp notification
GET    /api/reports/attendance     # Attendance report (date range, department)
GET    /api/reports/leave          # Leave report (date range, type, department)
GET    /api/reports/recruitment    # Recruitment pipeline report (job, stage counts)
```

Everything else (CRUD operations on employees, leave requests, attendance, etc.) goes through **direct Supabase client calls** from the frontend, protected by RLS. No need for API routes for standard CRUD.

---

## 12. Development Phases

### Phase 0 — Skeleton (Week 1)
- [ ] Create Supabase project, run all migration SQL files
- [ ] Verify RLS policies work (cross-tenant isolation test)
- [ ] Set up Vercel project, connect repo
- [ ] Build app shell: `index.html` with sidebar, topbar, content area
- [ ] Implement `router.js` — hash-based view loading
- [ ] Build 8 base components: button, input, table, modal, toast, card, badge, empty-state
- [ ] Build `login.html` with Supabase Auth (email + Google OAuth)
- [ ] Build org creation flow (post-signup)
- [ ] Deploy to Vercel, verify end-to-end auth flow

### Phase 1 — Recruitment Features (Weeks 2–4)
*This is the existing Atllanta functionality, migrated into the new structure.*
- [ ] Jobs view — create/edit JD, auto-parse skills via Groq
- [ ] Resume upload — single + bulk, text extraction, Groq parsing
- [ ] Matching engine — run CV-JD match, display ranked results with score breakdown
- [ ] Shortlist view — filter by score threshold, manually shortlist/reject
- [ ] Interview scheduling — create slots, schedule interviews, calendar view
- [ ] Candidate profile — resume, match scores across jobs, interview history

### Phase 2 — Employee Management (Weeks 5–7)
- [ ] Employee directory — list, search, filter by department/team/status
- [ ] Employee profile page — personal info, employment info, documents tab
- [ ] Bulk import via CSV
- [ ] Department and team management (settings)
- [ ] Org chart (basic — generated from reporting_manager_id)

### Phase 3 — Attendance (Weeks 8–10)
- [ ] Check-in / check-out button with timestamp
- [ ] GPS capture on check-in (optional, permission-based)
- [ ] Today's attendance dashboard — present/absent/late/on-leave counts
- [ ] Monthly attendance report per employee
- [ ] Manager view — team attendance
- [ ] Attendance regularization (request → approve)
- [ ] Work schedule configuration

### Phase 4 — Leave (Weeks 11–13)
- [ ] Leave type configuration (admin)
- [ ] Holiday calendar (admin)
- [ ] Leave balance display per employee
- [ ] Apply for leave form
- [ ] Approval flow — manager inbox, approve/reject with comment
- [ ] Team leave calendar view
- [ ] Leave reports

### Phase 5 — Platform Services (Weeks 14–17)
- [ ] Event bus — events table, worker polling, 5 workflow recipes
- [ ] Notification service — in-app notifications + email via Resend
- [ ] Global search — single search bar querying users, candidates, jobs
- [ ] Audit log — auto-log every mutation, admin viewer
- [ ] AI assistant panel — read-only Q&A via Groq
- [ ] Universal approvals inbox — leave + attendance regularizations in one view

### Phase 6 — Polish & Launch (Weeks 18–20)
- [ ] Dark mode
- [ ] Mobile responsive pass (all views)
- [ ] Empty states for every view
- [ ] Error handling pass (every API call)
- [ ] Loading states (skeleton screens)
- [ ] Onboarding flow (new org: create → configure leave → invite → first check-in)
- [ ] PWA manifest + service worker (basic offline support)

---

## 13. Migration from Current Atllanta

The current Atllanta codebase has matching and interview scheduling with Groq. The migration:

1. **Keep:** Groq integration, matching algorithm logic, resume parsing logic
2. **Move:** matching logic into `api/match.js`, resume parsing into `api/parse-resume.js`, JD parsing into `api/parse-jd.js`
3. **Replace:** any existing database with the schema defined in Section 5 above
4. **Replace:** any existing auth with Supabase Auth
5. **Replace:** any existing file storage with Supabase Storage
6. **Add:** RLS policies on every table
7. **Add:** event publishing on every mutation
8. **Wrap:** existing UI into the new sidebar layout and design system

The existing Groq prompts for resume/JD parsing should be preserved as-is if they work well. Only restructure the surrounding code to fit the new file structure.

---

## 14. Conventions

**Naming:**
- Database tables: `snake_case`, plural (`users`, `leave_requests`, `job_applications`)
- Database columns: `snake_case` (`created_at`, `org_id`, `match_score`)
- JS files: `kebab-case` (`job-detail.js`, `upload-resumes.js`)
- JS functions: `camelCase` (`handleCheckIn`, `parseResume`, `calculateMatchScore`)
- CSS classes: `kebab-case` (`btn-primary`, `card-header`, `sidebar-nav`)
- Event types: `module.entity.action` (`people.employee.created`, `recruitment.candidate.shortlisted`)

**Git:**
- Branch: `feature/recruitment-matching`, `fix/attendance-rls`, `chore/design-tokens`
- Commits: imperative mood, short (`Add leave request approval flow`, `Fix RLS policy for candidates table`)

**Code style:**
- No semicolons in JS (or always — just be consistent)
- Use `const` by default, `let` when reassignment needed, never `var`
- `async/await` over `.then()` chains
- Early returns over nested conditionals
- Every Supabase call must check for errors: `const { data, error } = await supabase...`

---

## 15. What NOT to Build

| Item | Reason |
|------|--------|
| Payroll | Compliance minefield (PF/ESI/PT/TDS). Not until paying customers demand it. |
| Visual workflow builder | Predefined recipes only. A drag-and-drop builder is a product in itself. |
| Custom role permissions UI | Four fixed roles (owner/admin/manager/member) are enough for Phase 1–5. |
| Native mobile app | PWA first. Native only after daily usage is proven. |
| CRM / Customers module | Phase 6+. Build only after People app has real users. |
| Microservices | Everything stays in the monolith until a named scaling trigger fires. |
| Elasticsearch | Postgres full-text search handles the first 100K records per org. |
| React / Next.js migration | Stay vanilla JS unless Sachin explicitly asks to switch. |
