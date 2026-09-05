-- ============================================================
-- OUTBOUND WEBHOOKS — let external tools subscribe to the event bus.
--
-- Every mutation already publishes a row into `events` (module.entity.action).
-- A trigger fans each new event out into per-endpoint delivery rows for the
-- org's matching, active webhook endpoints; the server cron
-- (api/event-processor → dispatchWebhooks) POSTs them with an HMAC signature
-- and retries with backoff. Enqueue is decoupled from delivery, so it works
-- no matter who processes the event.
--
-- This is the "integratable with any external tool" primitive: Zapier/Make/
-- Slack/custom endpoints subscribe by URL + event patterns.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  secret       TEXT NOT NULL,                       -- HMAC key; the receiver verifies X-Atllanta-Signature
  events       TEXT[] NOT NULL DEFAULT '{*}',       -- patterns: '*', 'crm.*', 'crm.opportunity.created'
  description  TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_delivery_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org ON webhook_endpoints (org_id);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  endpoint_id  UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status  INTEGER,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_due ON webhook_deliveries (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries (endpoint_id, created_at DESC);

-- ------------------------------------------------------------
-- RLS — org admins manage endpoints and read the delivery log. Delivery rows
-- are written only by the trigger (SECURITY DEFINER) and the server
-- (service_role), never directly by clients.
-- ------------------------------------------------------------
ALTER TABLE webhook_endpoints  ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhook_endpoints_select ON webhook_endpoints FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY webhook_endpoints_insert ON webhook_endpoints FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin() AND created_by = auth.uid());
CREATE POLICY webhook_endpoints_update ON webhook_endpoints FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
CREATE POLICY webhook_endpoints_delete ON webhook_endpoints FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());

CREATE POLICY webhook_deliveries_select ON webhook_deliveries FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids()) AND is_org_admin());
-- No client insert/update/delete policies: only the trigger and service_role write here.

-- ------------------------------------------------------------
-- Fan-out trigger: on each new event, enqueue a delivery per matching endpoint.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION enqueue_webhook_deliveries()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO webhook_deliveries (org_id, endpoint_id, event_type, payload)
  SELECT NEW.org_id, e.id, NEW.event_type, NEW.payload
    FROM webhook_endpoints e
   WHERE e.org_id = NEW.org_id
     AND e.active
     AND (
       '*' = ANY(e.events)
       OR NEW.event_type = ANY(e.events)
       OR EXISTS (
         SELECT 1 FROM unnest(e.events) AS p
          WHERE p LIKE '%.*' AND NEW.event_type LIKE (left(p, length(p) - 1) || '%')
       )
     );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_events_webhooks ON events;
CREATE TRIGGER trg_events_webhooks
  AFTER INSERT ON events
  FOR EACH ROW EXECUTE FUNCTION enqueue_webhook_deliveries();
