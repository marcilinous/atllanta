CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  count        INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION rate_limit_hit(p_key TEXT, p_limit INT, p_window_seconds INT)
RETURNS TABLE (allowed BOOLEAN, remaining INT, retry_after INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_now   TIMESTAMPTZ := now();
  v_start TIMESTAMPTZ;
  v_count INT;
BEGIN
  IF p_limit IS NULL OR p_limit <= 0 OR p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'rate_limit_hit: limit and window must be positive';
  END IF;
  INSERT INTO rate_limits (key, window_start, count)
       VALUES (p_key, v_now, 1)
  ON CONFLICT (key) DO UPDATE
     SET count = CASE WHEN rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
                      THEN 1 ELSE rate_limits.count + 1 END,
         window_start = CASE WHEN rate_limits.window_start < v_now - make_interval(secs => p_window_seconds)
                      THEN v_now ELSE rate_limits.window_start END
  RETURNING rate_limits.window_start, rate_limits.count INTO v_start, v_count;
  IF v_count > p_limit THEN
    allowed := false;
    remaining := 0;
    retry_after := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_start + make_interval(secs => p_window_seconds) - v_now)))::INT);
  ELSE
    allowed := true;
    remaining := p_limit - v_count;
    retry_after := 0;
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION rate_limit_hit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION rate_limit_gc()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n INT;
BEGIN
  DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION rate_limit_gc() FROM PUBLIC, anon, authenticated;