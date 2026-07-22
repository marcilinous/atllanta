-- ============================================================
-- EXPENSE CATEGORIES
-- ============================================================
CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  description TEXT,
  spending_limit DECIMAL(10,2),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, code)
);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON expense_categories
  FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_insert" ON expense_categories
  FOR INSERT WITH CHECK (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_update" ON expense_categories
  FOR UPDATE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_delete" ON expense_categories
  FOR DELETE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- ============================================================
-- EXPENSES
-- ============================================================
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  category_id UUID REFERENCES expense_categories(id),
  title TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'INR',
  expense_date DATE NOT NULL,
  receipt_url TEXT,
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'reimbursed')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_comment TEXT,
  reimbursed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON expenses
  FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_insert" ON expenses
  FOR INSERT WITH CHECK (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_update" ON expenses
  FOR UPDATE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_delete" ON expenses
  FOR DELETE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- Indexes
CREATE INDEX idx_expenses_user ON expenses(user_id, status);
CREATE INDEX idx_expenses_org_status ON expenses(org_id, status);
CREATE INDEX idx_expenses_date ON expenses(org_id, expense_date DESC);
