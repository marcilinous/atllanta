-- ATLLANTA — Business OS Platform Schema
-- Adds platform tables (departments, teams, audit_logs, events, notifications, files)
-- Adds people module tables (work_schedules, attendance, leave)
-- Extends existing organizations and recruitment tables

-- ============================================================
-- DEPARTMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  head_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- TEAMS
-- ============================================================
CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  lead_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- USERS (public profile extending auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organizations(id),
  full_name TEXT,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'manager', 'member')),
  designation TEXT,
  department_id UUID REFERENCES departments(id),
  team_id UUID REFERENCES teams(id),
  reporting_manager_id UUID,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'on_notice', 'exited')),
  date_of_joining DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- AUDIT LOG (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID,
  module TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- EVENTS (internal event bus)
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id UUID,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  module TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  channel TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'push', 'sms', 'whatsapp')),
  status TEXT DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'dismissed')),
  sent_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- FILES
-- ============================================================
CREATE TABLE IF NOT EXISTS files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  entity_type TEXT,
  entity_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- WORK SCHEDULES
-- ============================================================
CREATE TABLE IF NOT EXISTS work_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  shift_start TIME NOT NULL DEFAULT '09:00',
  shift_end TIME NOT NULL DEFAULT '18:00',
  weekly_offs INTEGER[] DEFAULT '{1,7}',
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ATTENDANCE
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
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
CREATE TABLE IF NOT EXISTS attendance_regularizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  attendance_id UUID NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  requested_check_in TIMESTAMPTZ,
  requested_check_out TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- LEAVE TYPES
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  annual_quota INTEGER NOT NULL DEFAULT 12,
  carry_forward BOOLEAN DEFAULT false,
  max_carry_forward INTEGER DEFAULT 0,
  max_consecutive_days INTEGER,
  requires_document BOOLEAN DEFAULT false,
  is_paid BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, code)
);

-- ============================================================
-- LEAVE BALANCES
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
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
CREATE TABLE IF NOT EXISTS leave_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days DECIMAL(3,1) NOT NULL,
  reason TEXT,
  document_url TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  review_comment TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- HOLIDAYS
-- ============================================================
CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  date DATE NOT NULL,
  is_optional BOOLEAN DEFAULT false,
  year INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ADD ORG_ID TO JOBS TABLE (if not present)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'jobs' AND column_name = 'org_id') THEN
    ALTER TABLE jobs ADD COLUMN org_id UUID REFERENCES organizations(id);
  END IF;
END $$;

-- ============================================================
-- ENABLE RLS ON ALL NEW TABLES
-- ============================================================
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
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

-- ============================================================
-- RLS POLICIES — org isolation via memberships
-- ============================================================

-- Helper: get org_ids the current user belongs to
CREATE OR REPLACE FUNCTION auth_user_org_ids()
RETURNS SETOF UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT DISTINCT organization_id FROM memberships WHERE user_id = auth.uid()
$$;

-- Departments
CREATE POLICY "dept_select" ON departments FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "dept_insert" ON departments FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "dept_update" ON departments FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "dept_delete" ON departments FOR DELETE USING (org_id IN (SELECT auth_user_org_ids()));

-- Teams
CREATE POLICY "teams_select" ON teams FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "teams_insert" ON teams FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "teams_update" ON teams FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "teams_delete" ON teams FOR DELETE USING (org_id IN (SELECT auth_user_org_ids()));

-- Users
CREATE POLICY "users_select" ON users FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()) OR id = auth.uid());
CREATE POLICY "users_insert" ON users FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "users_update" ON users FOR UPDATE USING (id = auth.uid() OR org_id IN (SELECT auth_user_org_ids()));

-- Audit Logs (read-only for org members)
CREATE POLICY "audit_select" ON audit_logs FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "audit_insert" ON audit_logs FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));

-- Events
CREATE POLICY "events_select" ON events FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "events_insert" ON events FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));

-- Notifications
CREATE POLICY "notif_select" ON notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "notif_update" ON notifications FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY "notif_insert" ON notifications FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));

-- Files
CREATE POLICY "files_select" ON files FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "files_insert" ON files FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "files_delete" ON files FOR DELETE USING (uploaded_by = auth.uid());

-- Work Schedules
CREATE POLICY "ws_select" ON work_schedules FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "ws_insert" ON work_schedules FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "ws_update" ON work_schedules FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()));

-- Attendance
CREATE POLICY "att_select" ON attendance FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "att_insert" ON attendance FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "att_update" ON attendance FOR UPDATE USING (user_id = auth.uid());

-- Attendance Regularizations
CREATE POLICY "attreg_select" ON attendance_regularizations FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "attreg_insert" ON attendance_regularizations FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "attreg_update" ON attendance_regularizations FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()));

-- Leave Types
CREATE POLICY "lt_select" ON leave_types FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "lt_insert" ON leave_types FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "lt_update" ON leave_types FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()));

-- Leave Balances
CREATE POLICY "lb_select" ON leave_balances FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "lb_insert" ON leave_balances FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "lb_update" ON leave_balances FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()));

-- Leave Requests
CREATE POLICY "lr_select" ON leave_requests FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "lr_insert" ON leave_requests FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "lr_update" ON leave_requests FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()));

-- Holidays
CREATE POLICY "hol_select" ON holidays FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "hol_insert" ON holidays FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "hol_update" ON holidays FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()));
CREATE POLICY "hol_delete" ON holidays FOR DELETE USING (org_id IN (SELECT auth_user_org_ids()));

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_departments_org ON departments(org_id);
CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id);
CREATE INDEX IF NOT EXISTS idx_teams_dept ON teams(department_id);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_dept ON users(department_id);
CREATE INDEX IF NOT EXISTS idx_users_manager ON users(reporting_manager_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date);
CREATE INDEX IF NOT EXISTS idx_attendance_org_date ON attendance(org_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user ON leave_requests(user_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_org ON leave_requests(org_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_pending ON events(status, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_leave_balances_user ON leave_balances(user_id, leave_type_id, year);
CREATE INDEX IF NOT EXISTS idx_holidays_org_year ON holidays(org_id, year);
