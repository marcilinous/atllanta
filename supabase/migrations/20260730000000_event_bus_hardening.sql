-- ============================================================
-- EVENT BUS HARDENING + EMAIL DELIVERY PIPELINE
-- ============================================================
-- Fixes two production defects in the event system:
--
--  1. There was no UPDATE policy on `events`, so the in-browser event
--     processor could never mark an event `processing`/`completed`. The
--     UPDATE was silently blocked by RLS (0 rows, no error), leaving every
--     event `pending` forever. Each 30s poll re-ran every recipe, spamming
--     duplicate in-app notifications — multiplied by every open browser.
--
--  2. Email notifications were never delivered end-to-end. This adds an
--     `email_status` queue column drained by the server-side dispatcher.
--
-- The fix routes all status transitions through SECURITY DEFINER RPCs that
-- claim events atomically (FOR UPDATE SKIP LOCKED), so concurrent consumers
-- — multiple browser tabs and the server backstop — never process the same
-- event twice. No broad UPDATE policy is opened on `events`.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Email delivery queue on notifications
-- ------------------------------------------------------------
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'none'
    CHECK (email_status IN ('none', 'pending', 'sent', 'failed'));

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS emailed_at TIMESTAMPTZ;

-- Partial index so the dispatcher only scans the outbound queue.
CREATE INDEX IF NOT EXISTS idx_notifications_email_pending
  ON notifications(sent_at)
  WHERE email_status = 'pending';

-- ------------------------------------------------------------
-- 2. Atomic event claiming
-- ------------------------------------------------------------
-- Claims up to `batch_size` pending events for the caller's org(s), marks
-- them `processing`, bumps `attempts`, and returns the claimed rows. SKIP
-- LOCKED guarantees two concurrent consumers never grab the same event.
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

-- Marks a claimed event as completed (done) or re-queues/fails it. Scoped to
-- the caller's org so it cannot touch another tenant's events.
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
