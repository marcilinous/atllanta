-- ============================================================
-- FIX MISSING user_id FOREIGN KEYS (PostgREST embed resolution)
-- ============================================================
-- Several core tables declare a user_id column but never had the foreign key
-- to public.users created in this database. PostgREST can only resolve embedded
-- selects (e.g. `requester:user_id(full_name, email)`) when a real FK exists, so
-- the Inbox and other views failed with:
--   "Could not find a relationship between 'leave_requests' and 'user_id'
--    in the schema cache"
--
-- Affected tables: attendance, attendance_regularizations, audit_logs,
-- leave_balances, leave_requests, notifications.
--
-- Two of them (attendance, audit_logs) held rows whose user_id was the operator's
-- own account, which exists in auth.users + memberships but never got a
-- public.users profile row (it predates the provisioning flow). We backfill any
-- such missing profiles first so the FKs validate cleanly.
-- ============================================================

-- 1) Backfill public.users profiles for any auth user that has a membership but
--    no profile row yet. full_name/email come from the membership, falling back
--    to the auth email. Role is coerced into the profile's allowed set.
INSERT INTO public.users (id, org_id, full_name, email, role, status)
SELECT DISTINCT ON (m.user_id)
  m.user_id,
  m.organization_id,
  COALESCE(m.full_name, au.raw_user_meta_data->>'full_name'),
  COALESCE(m.email, au.email),
  CASE WHEN m.role IN ('owner','admin','manager','member') THEN m.role ELSE 'admin' END,
  'active'
FROM memberships m
JOIN auth.users au ON au.id = m.user_id
WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = m.user_id)
ORDER BY m.user_id, m.created_at;

-- 2) Add the missing user_id -> users(id) foreign keys. IF NOT EXISTS-style guard
--    via DO block keeps this idempotent across environments.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'attendance',
    'attendance_regularizations',
    'audit_logs',
    'leave_balances',
    'leave_requests',
    'notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_user_id_fkey' AND conrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.users(id)',
        t, t || '_user_id_fkey'
      );
    END IF;
  END LOOP;
END $$;

-- Nudge PostgREST to reload its schema cache immediately.
NOTIFY pgrst, 'reload schema';
