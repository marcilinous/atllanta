-- ============================================================
-- CRM CORE (Customers module) — the Salesforce-style spine
-- ============================================================
-- Accounts (companies), Contacts (people), Leads (top of funnel),
-- Opportunities (deals moving through a configurable pipeline), and
-- Activities (tasks/calls/meetings/notes logged against any CRM record).
--
-- Every table is org-scoped and RLS-isolated via auth_user_org_ids(),
-- matching the platform's multi-tenant pattern.
-- ============================================================

-- ------------------------------------------------------------
-- Pipeline stages (configurable per org)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  probability INTEGER NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  is_won BOOLEAN NOT NULL DEFAULT false,
  is_lost BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- Accounts (companies)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  industry TEXT,
  website TEXT,
  phone TEXT,
  employees_count INTEGER,
  annual_revenue NUMERIC,
  billing_city TEXT,
  billing_country TEXT,
  owner_id UUID REFERENCES users(id),
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- Contacts (people, optionally attached to an account)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id UUID REFERENCES crm_accounts(id) ON DELETE SET NULL,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  title TEXT,
  owner_id UUID REFERENCES users(id),
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- Opportunities (deals)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_id UUID REFERENCES crm_accounts(id) ON DELETE SET NULL,
  primary_contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  stage_id UUID REFERENCES crm_pipeline_stages(id),
  amount NUMERIC,
  currency TEXT DEFAULT 'INR',
  close_date DATE,
  probability INTEGER CHECK (probability BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  lost_reason TEXT,
  source TEXT,
  owner_id UUID REFERENCES users(id),
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- Leads (top of funnel; convert into account + contact + opportunity)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  email TEXT,
  phone TEXT,
  title TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'working', 'qualified', 'unqualified', 'converted')),
  rating TEXT CHECK (rating IN ('hot', 'warm', 'cold')),
  owner_id UUID REFERENCES users(id),
  description TEXT,
  converted_at TIMESTAMPTZ,
  converted_account_id UUID REFERENCES crm_accounts(id) ON DELETE SET NULL,
  converted_contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  converted_opportunity_id UUID REFERENCES crm_opportunities(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- Activities (tasks / calls / meetings / notes on any CRM record)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'task' CHECK (type IN ('task', 'call', 'meeting', 'email', 'note')),
  subject TEXT NOT NULL,
  body TEXT,
  due_date TIMESTAMPTZ,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  related_type TEXT CHECK (related_type IN ('account', 'contact', 'lead', 'opportunity')),
  related_id UUID,
  owner_id UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_crm_stages_org ON crm_pipeline_stages(org_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_crm_accounts_org ON crm_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_org ON crm_contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_account ON crm_contacts(account_id);
CREATE INDEX IF NOT EXISTS idx_crm_opps_org_status ON crm_opportunities(org_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_opps_stage ON crm_opportunities(stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_opps_account ON crm_opportunities(account_id);
CREATE INDEX IF NOT EXISTS idx_crm_leads_org_status ON crm_leads(org_id, status);
CREATE INDEX IF NOT EXISTS idx_crm_activities_related ON crm_activities(related_type, related_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_owner_open ON crm_activities(owner_id, due_date) WHERE completed = false;

-- ------------------------------------------------------------
-- RLS — org isolation on every table
-- ------------------------------------------------------------
ALTER TABLE crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'crm_pipeline_stages','crm_accounts','crm_contacts',
    'crm_opportunities','crm_leads','crm_activities'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_insert', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_update', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t||'_delete', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));', t||'_select', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()));', t||'_insert', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()));', t||'_update', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR DELETE USING (org_id IN (SELECT auth_user_org_ids()));', t||'_delete', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- Default pipeline stages, seeded per org (existing + future)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_seed_default_stages(p_org UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM crm_pipeline_stages WHERE org_id = p_org) THEN
    RETURN;
  END IF;
  INSERT INTO crm_pipeline_stages (org_id, name, sort_order, probability, is_won, is_lost) VALUES
    (p_org, 'Qualification',  1, 10,  false, false),
    (p_org, 'Needs Analysis', 2, 25,  false, false),
    (p_org, 'Proposal',       3, 50,  false, false),
    (p_org, 'Negotiation',    4, 75,  false, false),
    (p_org, 'Closed Won',     5, 100, true,  false),
    (p_org, 'Closed Lost',    6, 0,   false, true);
END;
$$;

CREATE OR REPLACE FUNCTION crm_seed_stages_on_org()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM crm_seed_default_stages(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_seed_stages ON organizations;
CREATE TRIGGER trg_crm_seed_stages
  AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION crm_seed_stages_on_org();

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM organizations LOOP
    PERFORM crm_seed_default_stages(r.id);
  END LOOP;
END $$;
