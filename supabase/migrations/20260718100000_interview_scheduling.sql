-- Interview scheduling: slots + schedule tokens

-- Add schedule_token to applications for public scheduling links
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS schedule_token uuid UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS interview_at timestamptz;

-- Interview slots table
CREATE TABLE IF NOT EXISTS interview_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE CASCADE,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  booked_by uuid REFERENCES applications(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT slot_end_after_start CHECK (slot_end > slot_start)
);

ALTER TABLE interview_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view org slots"
  ON interview_slots FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can insert org slots"
  ON interview_slots FOR INSERT
  WITH CHECK (organization_id IN (
    SELECT organization_id FROM memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can update org slots"
  ON interview_slots FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM memberships WHERE user_id = auth.uid()
  ));

CREATE POLICY "Members can delete org slots"
  ON interview_slots FOR DELETE
  USING (organization_id IN (
    SELECT organization_id FROM memberships WHERE user_id = auth.uid()
  ));
