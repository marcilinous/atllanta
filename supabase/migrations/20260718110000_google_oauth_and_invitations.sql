-- Google OAuth tokens per user
CREATE TABLE IF NOT EXISTS user_google_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email text NOT NULL,
  refresh_token text NOT NULL,
  access_token text,
  token_expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE user_google_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tokens"
  ON user_google_tokens FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can manage own tokens"
  ON user_google_tokens FOR ALL
  USING (user_id = auth.uid());

-- Invitations table
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'client_member',
  client_id uuid REFERENCES clients(id),
  invited_by uuid REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '7 days'),
  UNIQUE(organization_id, email)
);

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage org invitations"
  ON invitations FOR ALL
  USING (organization_id IN (
    SELECT organization_id FROM memberships
    WHERE user_id = auth.uid()
    AND role IN ('super_admin', 'agency_admin', 'client_admin')
  ));
