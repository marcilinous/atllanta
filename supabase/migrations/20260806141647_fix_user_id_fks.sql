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

NOTIFY pgrst, 'reload schema';