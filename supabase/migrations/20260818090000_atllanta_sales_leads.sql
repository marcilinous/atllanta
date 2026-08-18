-- ============================================================
-- Atllanta founder sales-leads tracker
-- A dedicated, platform-operator-only pipeline for selling Atllanta itself.
-- Not tenant data: no org_id. Visible only to super_admins (the HQ operators),
-- kept entirely separate from the customer-facing CRM.
-- ============================================================

-- Helper: is the current user a platform super_admin?
-- SECURITY DEFINER so the RLS predicate can read memberships regardless of the
-- caller's own row visibility. search_path pinned per the security-hardening pass.
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

-- ============================================================
CREATE TABLE IF NOT EXISTS public.atllanta_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  source TEXT,                 -- inbound, referral, outbound, event, linkedin, ...
  plan_interest TEXT,          -- free, pilot, paid, ...
  deal_value NUMERIC(12,2),    -- ₹
  stage TEXT NOT NULL DEFAULT 'new'
    CHECK (stage IN ('new','contacted','demo','trial','won','lost')),
  next_follow_up DATE,
  notes TEXT,
  owner_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.atllanta_leads ENABLE ROW LEVEL SECURITY;

-- Only platform super_admins can see or touch these rows, for every command.
CREATE POLICY "atllanta_leads_super_admin" ON public.atllanta_leads
  FOR ALL
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

CREATE INDEX IF NOT EXISTS idx_atllanta_leads_stage ON public.atllanta_leads(stage);
CREATE INDEX IF NOT EXISTS idx_atllanta_leads_followup ON public.atllanta_leads(next_follow_up);

NOTIFY pgrst, 'reload schema';
