-- AUDIT REMEDIATION — PHASE 1: trusted writes + atomic counters
-- P0-06 events, P0-07 audit logs, P0-11/AI-06 credit race, BOS-04 leave race.

CREATE OR REPLACE FUNCTION publish_event(
  p_event_type TEXT,
  p_payload    JSONB DEFAULT '{}'::jsonb,
  p_org_id     UUID  DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_id  UUID;
BEGIN
  IF p_event_type IS NULL OR length(btrim(p_event_type)) = 0 THEN
    RAISE EXCEPTION 'publish_event: event_type is required';
  END IF;
  IF p_org_id IS NOT NULL THEN
    IF p_org_id NOT IN (SELECT auth_user_org_ids()) THEN
      RAISE EXCEPTION 'publish_event: not a member of org %', p_org_id USING ERRCODE = '42501';
    END IF;
    v_org := p_org_id;
  ELSE
    SELECT o INTO v_org FROM auth_user_org_ids() o LIMIT 1;
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'publish_event: caller has no organization' USING ERRCODE = '42501';
  END IF;
  INSERT INTO events (org_id, event_type, actor_id, payload, status)
  VALUES (v_org, p_event_type, auth.uid(), COALESCE(p_payload, '{}'::jsonb), 'pending')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION publish_event(TEXT, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION publish_event(TEXT, JSONB, UUID) TO authenticated;
DROP POLICY IF EXISTS "events_insert" ON events;

CREATE OR REPLACE FUNCTION log_audit(
  p_module      TEXT,
  p_entity_type TEXT,
  p_entity_id   UUID,
  p_action      TEXT,
  p_old         JSONB DEFAULT NULL,
  p_new         JSONB DEFAULT NULL,
  p_org_id      UUID  DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_id  UUID;
BEGIN
  IF p_org_id IS NOT NULL THEN
    IF p_org_id NOT IN (SELECT auth_user_org_ids()) THEN
      RAISE EXCEPTION 'log_audit: not a member of org %', p_org_id USING ERRCODE = '42501';
    END IF;
    v_org := p_org_id;
  ELSE
    SELECT o INTO v_org FROM auth_user_org_ids() o LIMIT 1;
  END IF;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'log_audit: caller has no organization' USING ERRCODE = '42501';
  END IF;
  INSERT INTO audit_logs (org_id, user_id, module, entity_type, entity_id, action, old_values, new_values)
  VALUES (v_org, auth.uid(), p_module, p_entity_type, p_entity_id, p_action, p_old, p_new)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION log_audit(TEXT, TEXT, UUID, TEXT, JSONB, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION log_audit(TEXT, TEXT, UUID, TEXT, JSONB, JSONB, UUID) TO authenticated;
DROP POLICY IF EXISTS "audit_insert" ON audit_logs;

CREATE OR REPLACE FUNCTION consume_credits(
  p_org_id       UUID,
  p_amount       INT,
  p_action_type  TEXT,
  p_reference_id UUID DEFAULT NULL
)
RETURNS TABLE (charged BOOLEAN, credits_remaining INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode    TEXT;
  v_balance INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'consume_credits: amount must be positive';
  END IF;
  SELECT credit_overage_mode, COALESCE(credits_balance, 0)
    INTO v_mode, v_balance
    FROM organizations
   WHERE id = p_org_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'consume_credits: org % not found', p_org_id;
  END IF;
  IF v_mode = 'hard_stop' AND v_balance < p_amount THEN
    charged := false;
    credits_remaining := v_balance;
    RETURN NEXT;
    RETURN;
  END IF;
  UPDATE organizations
     SET credits_balance = COALESCE(credits_balance, 0) - p_amount
   WHERE id = p_org_id
  RETURNING credits_balance INTO v_balance;
  INSERT INTO credit_ledger (organization_id, action_type, credits_delta, reference_id)
  VALUES (p_org_id, p_action_type, -p_amount, p_reference_id);
  charged := true;
  credits_remaining := v_balance;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION consume_credits(UUID, INT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION apply_leave_usage(
  p_user_id       UUID,
  p_leave_type_id UUID,
  p_year          INT,
  p_days          NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_used NUMERIC;
BEGIN
  UPDATE leave_balances
     SET used = COALESCE(used, 0) + COALESCE(p_days, 0)
   WHERE user_id = p_user_id
     AND leave_type_id = p_leave_type_id
     AND year = p_year
  RETURNING used INTO v_used;
  RETURN v_used;
END;
$$;
REVOKE ALL ON FUNCTION apply_leave_usage(UUID, UUID, INT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION apply_leave_usage(UUID, UUID, INT, NUMERIC) TO authenticated;