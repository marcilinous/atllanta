-- ============================================================
-- P0-10 / EV-02 / EV-03 — event handler idempotency + retry/lease metadata.
-- ============================================================
-- The event bus is drained by two consumers (the in-browser processor and the
-- server backstop cron). Claiming is already exactly-once (claim_events uses
-- FOR UPDATE SKIP LOCKED; the backstop re-checks status), but a handler that
-- partially applies then fails is retried — and a non-idempotent side effect
-- (the leave used-days increment, duplicate notifications) would apply twice.
--
-- This adds:
--   • an idempotency ledger (event_side_effects) + claim_side_effect() so a
--     handler applies each side effect at most once across retries and across
--     both processors (P0-10 — the outbox's dedup half of EV-02);
--   • lease + retry metadata on events (locked_at, last_error, failed_at) and
--     requeue_stale_events() to rescue events stuck in 'processing' when a
--     worker dies, and to dead-letter events past their attempt cap (EV-03).
--
-- A full transactional outbox (every mutation + its event in one DB txn, all
-- handling moved server-side) remains a larger follow-up; this closes the
-- concrete correctness risks without that rewrite.
-- ============================================================

-- ------------------------------------------------------------
-- EV-03 — retry / lease metadata on events.
-- ------------------------------------------------------------
ALTER TABLE events ADD COLUMN IF NOT EXISTS locked_at  TIMESTAMPTZ;
ALTER TABLE events ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS failed_at  TIMESTAMPTZ;

-- ------------------------------------------------------------
-- P0-10 — per-effect idempotency ledger. One row per (event, effect); the
-- handler asks claim_side_effect() before doing the effect and skips it if a
-- row already exists. Written only through the SECURITY DEFINER function.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_side_effects (
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  effect_key TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, effect_key)
);
ALTER TABLE event_side_effects ENABLE ROW LEVEL SECURITY;
-- No client policies: only claim_side_effect() (definer) and service_role write.

-- Returns TRUE the first time an (event, effect) is seen (caller should apply
-- the effect), FALSE on any later call (caller should skip). An authenticated
-- caller may only mark effects for events in its own org; the service role
-- (auth.uid() IS NULL) is unrestricted.
CREATE OR REPLACE FUNCTION claim_side_effect(p_event_id UUID, p_effect_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_n INT;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = p_event_id AND e.org_id IN (SELECT auth_user_org_ids())) THEN
    RAISE EXCEPTION 'claim_side_effect: event % not in caller org', p_event_id USING ERRCODE = '42501';
  END IF;

  INSERT INTO event_side_effects (event_id, effect_key)
       VALUES (p_event_id, p_effect_key)
  ON CONFLICT (event_id, effect_key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

REVOKE ALL ON FUNCTION claim_side_effect(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_side_effect(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- Claim now stamps locked_at so the lease reaper can tell live work from
-- abandoned work. (Re-declares claim_events with the same signature/behaviour
-- plus locked_at.)
-- ------------------------------------------------------------
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
         attempts = e.attempts + 1,
         locked_at = now()
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
REVOKE ALL ON FUNCTION claim_events(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION claim_events(INT) TO authenticated;

-- resolve_event: clear the lease on terminal states. Keep the 2-arg form and
-- add a 3-arg form that records the error text on failure.
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
         locked_at = CASE WHEN new_status = 'processing' THEN locked_at ELSE NULL END,
         processed_at = CASE WHEN new_status = 'completed' THEN now() ELSE processed_at END,
         failed_at = CASE WHEN new_status = 'failed' THEN now() ELSE failed_at END
   WHERE id = event_id
     AND org_id IN (SELECT auth_user_org_ids());
END;
$$;

CREATE OR REPLACE FUNCTION resolve_event(event_id UUID, new_status TEXT, p_error TEXT)
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
         locked_at = CASE WHEN new_status = 'processing' THEN locked_at ELSE NULL END,
         processed_at = CASE WHEN new_status = 'completed' THEN now() ELSE processed_at END,
         failed_at = CASE WHEN new_status = 'failed' THEN now() ELSE failed_at END,
         last_error = CASE WHEN new_status = 'completed' THEN NULL ELSE left(p_error, 500) END
   WHERE id = event_id
     AND org_id IN (SELECT auth_user_org_ids());
END;
$$;

REVOKE ALL ON FUNCTION resolve_event(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION resolve_event(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION resolve_event(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_event(UUID, TEXT, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- EV-03 — lease reaper + dead-letter. Events stuck in 'processing' past the
-- lease (a worker died mid-handle) are requeued; events that have burned
-- through their attempt cap are dead-lettered to 'failed'. Run from the cron.
-- service_role only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION requeue_stale_events(p_lease_seconds INT DEFAULT 600, p_max_attempts INT DEFAULT 6)
RETURNS TABLE (requeued INT, deadlettered INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_req INT; v_dead INT;
BEGIN
  UPDATE events
     SET status = 'failed', failed_at = now(),
         last_error = COALESCE(last_error, 'exceeded max attempts')
   WHERE status = 'processing'
     AND attempts >= p_max_attempts;
  GET DIAGNOSTICS v_dead = ROW_COUNT;

  UPDATE events
     SET status = 'pending', locked_at = NULL
   WHERE status = 'processing'
     AND attempts < p_max_attempts
     AND locked_at IS NOT NULL
     AND locked_at < now() - make_interval(secs => p_lease_seconds);
  GET DIAGNOSTICS v_req = ROW_COUNT;

  requeued := v_req; deadlettered := v_dead;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION requeue_stale_events(INT, INT) FROM PUBLIC, anon, authenticated;
