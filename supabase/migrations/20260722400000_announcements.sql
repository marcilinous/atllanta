-- Proper announcements table (replaces events-based storage)
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  author_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_announcements_org ON announcements(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_pinned ON announcements(org_id, pinned) WHERE pinned = true;

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation_select" ON announcements
  FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_insert" ON announcements
  FOR INSERT WITH CHECK (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_update" ON announcements
  FOR UPDATE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY "org_isolation_delete" ON announcements
  FOR DELETE USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
