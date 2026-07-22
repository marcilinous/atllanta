-- ============================================================
-- ASSETS — proper table for company asset tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Other' CHECK (type IN ('Laptop', 'Phone', 'Access Card', 'Monitor', 'Keyboard', 'Mouse', 'Headset', 'Other')),
  serial_number TEXT,
  purchase_date DATE,
  purchase_cost DECIMAL(12,2),
  warranty_end DATE,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'assigned', 'maintenance', 'retired')),
  assigned_to UUID REFERENCES users(id),
  assigned_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_assets_org ON assets(org_id);
CREATE INDEX idx_assets_status ON assets(org_id, status);
CREATE INDEX idx_assets_assigned ON assets(assigned_to) WHERE assigned_to IS NOT NULL;

-- Asset assignment history
CREATE TABLE IF NOT EXISTS asset_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES users(id),
  notes TEXT
);

CREATE INDEX idx_asset_assignments_asset ON asset_assignments(asset_id);
CREATE INDEX idx_asset_assignments_user ON asset_assignments(user_id);

-- RLS
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON assets
  FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_insert" ON assets
  FOR INSERT WITH CHECK (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_update" ON assets
  FOR UPDATE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_delete" ON assets
  FOR DELETE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

CREATE POLICY "org_isolation_select" ON asset_assignments
  FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_insert" ON asset_assignments
  FOR INSERT WITH CHECK (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_update" ON asset_assignments
  FOR UPDATE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_delete" ON asset_assignments
  FOR DELETE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
