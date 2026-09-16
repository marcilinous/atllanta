CREATE OR REPLACE FUNCTION public.is_super_admin()
  RETURNS boolean
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE user_id = auth.uid() AND role = 'super_admin'
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.atllanta_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  source TEXT,
  plan_interest TEXT,
  deal_value NUMERIC(12,2),
  stage TEXT NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new','contacted','demo','trial','won','lost')),
  next_follow_up DATE,
  notes TEXT,
  owner_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.atllanta_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "atllanta_leads_super_admin" ON public.atllanta_leads
  FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE INDEX IF NOT EXISTS idx_atllanta_leads_stage ON public.atllanta_leads(stage);
CREATE INDEX IF NOT EXISTS idx_atllanta_leads_followup ON public.atllanta_leads(next_follow_up);

NOTIFY pgrst, 'reload schema';