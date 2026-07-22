-- Helpdesk categories (admin-configurable routing)
CREATE TABLE helpdesk_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '📋',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Category handlers (which users handle tickets in each category)
CREATE TABLE helpdesk_category_handlers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES helpdesk_categories(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(category_id, user_id)
);

-- Helpdesk tickets (proper table instead of events-based)
CREATE TABLE helpdesk_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  category_id UUID REFERENCES helpdesk_categories(id),
  subject TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_by UUID NOT NULL REFERENCES users(id),
  assigned_to UUID REFERENCES users(id),
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE helpdesk_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk_category_handlers ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_read_categories" ON helpdesk_categories
  FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_insert_categories" ON helpdesk_categories
  FOR INSERT WITH CHECK (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_update_categories" ON helpdesk_categories
  FOR UPDATE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_delete_categories" ON helpdesk_categories
  FOR DELETE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "org_read_handlers" ON helpdesk_category_handlers
  FOR SELECT USING (category_id IN (SELECT id FROM helpdesk_categories WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())));
CREATE POLICY "org_insert_handlers" ON helpdesk_category_handlers
  FOR INSERT WITH CHECK (category_id IN (SELECT id FROM helpdesk_categories WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())));
CREATE POLICY "org_delete_handlers" ON helpdesk_category_handlers
  FOR DELETE USING (category_id IN (SELECT id FROM helpdesk_categories WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())));

CREATE POLICY "org_read_tickets" ON helpdesk_tickets
  FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_insert_tickets" ON helpdesk_tickets
  FOR INSERT WITH CHECK (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_update_tickets" ON helpdesk_tickets
  FOR UPDATE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE INDEX idx_helpdesk_categories_org ON helpdesk_categories(org_id);
CREATE INDEX idx_helpdesk_tickets_org ON helpdesk_tickets(org_id, status);
CREATE INDEX idx_helpdesk_tickets_category ON helpdesk_tickets(category_id);
CREATE INDEX idx_helpdesk_tickets_assigned ON helpdesk_tickets(assigned_to, status);
CREATE INDEX idx_helpdesk_tickets_created_by ON helpdesk_tickets(created_by);
CREATE INDEX idx_helpdesk_handlers_category ON helpdesk_category_handlers(category_id);
