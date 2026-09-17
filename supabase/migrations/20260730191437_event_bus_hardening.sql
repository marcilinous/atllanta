-- Email delivery queue on notifications
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'none'
    CHECK (email_status IN ('none', 'pending', 'sent', 'failed'));

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_notifications_email_pending
  ON notifications(sent_at)
  WHERE email_status = 'pending';

-- Atomic event claiming
CREATE OR REPLACE FUNCTION claim_events(batch_size INT DEFAULT 20)
RETURNS SETOF events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE events e
     SET status = 'processing',
         attempts = e.attempts + 1
   WHERE e.id IN (
     SELECT id
       FROM events
      WHERE status = 'pending'
        AND org_id IN (SELECT auth_user_org_ids())
      ORDER BY created_at
      LIMIT GREATEST(batch_size, 1)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING e.*;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_event(event_id UUID, new_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new_status NOT IN ('completed', 'failed', 'pending') THEN
    RAISE EXCEPTION 'resolve_event: invalid status %', new_status;
  END IF;

  UPDATE events
     SET status = new_status,
         processed_at = CASE WHEN new_status = 'completed' THEN now()
                             ELSE processed_at END
   WHERE id = event_id
     AND org_id IN (SELECT auth_user_org_ids());
END;
$$;

REVOKE ALL ON FUNCTION claim_events(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_event(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_events(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_event(UUID, TEXT) TO authenticated;