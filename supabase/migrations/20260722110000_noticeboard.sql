-- Organization noticeboard / social feed for dashboard

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_id UUID NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'announcement' CHECK (type IN ('announcement', 'shoutout', 'update', 'milestone')),
  pinned BOOLEAN DEFAULT false,
  reactions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_select" ON posts
  FOR SELECT USING (org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()));
CREATE POLICY "posts_insert" ON posts
  FOR INSERT WITH CHECK (org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()));
CREATE POLICY "posts_update" ON posts
  FOR UPDATE USING (org_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()));
CREATE POLICY "posts_delete" ON posts
  FOR DELETE USING (author_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_posts_org_created ON posts(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON posts(org_id, pinned) WHERE pinned = true;
