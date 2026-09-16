CREATE TABLE IF NOT EXISTS work_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  address text,
  lat numeric(10,7) NOT NULL,
  lng numeric(10,7) NOT NULL,
  radius_m integer NOT NULL DEFAULT 150,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_locations_org ON work_locations (org_id, is_active);

ALTER TABLE work_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS work_locations_select ON work_locations;
CREATE POLICY work_locations_select ON work_locations FOR SELECT
  USING (org_id IN (SELECT auth_user_org_ids()));

DROP POLICY IF EXISTS work_locations_insert ON work_locations;
CREATE POLICY work_locations_insert ON work_locations FOR INSERT
  WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND crm_user_is_org_admin());

DROP POLICY IF EXISTS work_locations_update ON work_locations;
CREATE POLICY work_locations_update ON work_locations FOR UPDATE
  USING (org_id IN (SELECT auth_user_org_ids()) AND crm_user_is_org_admin());

DROP POLICY IF EXISTS work_locations_delete ON work_locations;
CREATE POLICY work_locations_delete ON work_locations FOR DELETE
  USING (org_id IN (SELECT auth_user_org_ids()) AND crm_user_is_org_admin());

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS check_in_selfie_path  text,
  ADD COLUMN IF NOT EXISTS check_out_selfie_path text,
  ADD COLUMN IF NOT EXISTS check_in_location_id  uuid REFERENCES work_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS check_out_location_id uuid REFERENCES work_locations(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION geo_distance_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
    power(sin(radians((lat2 - lat1) / 2)), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians((lng2 - lng1) / 2)), 2)
  ));
$$;

CREATE OR REPLACE FUNCTION enforce_attendance_geofence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  la numeric; lo numeric; matched uuid; has_locs boolean; is_checkin boolean;
BEGIN
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  is_checkin := (TG_OP = 'INSERT' AND NEW.check_in IS NOT NULL);
  IF NOT is_checkin
     AND NOT (TG_OP = 'UPDATE' AND NEW.check_out IS NOT NULL AND OLD.check_out IS NULL) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (SELECT 1 FROM work_locations w WHERE w.org_id = NEW.org_id AND w.is_active)
    INTO has_locs;
  IF NOT has_locs THEN
    RETURN NEW;
  END IF;

  IF is_checkin THEN la := NEW.check_in_lat;  lo := NEW.check_in_lng;
  ELSE               la := NEW.check_out_lat; lo := NEW.check_out_lng; END IF;

  IF la IS NULL OR lo IS NULL THEN
    RAISE EXCEPTION 'LOCATION_REQUIRED: enable location to mark attendance at an allotted workplace';
  END IF;

  SELECT w.id INTO matched
  FROM work_locations w
  WHERE w.org_id = NEW.org_id AND w.is_active
    AND geo_distance_m(la, lo, w.lat, w.lng) <= w.radius_m
  ORDER BY geo_distance_m(la, lo, w.lat, w.lng) ASC
  LIMIT 1;

  IF matched IS NULL THEN
    RAISE EXCEPTION 'OUTSIDE_ALLOTTED_LOCATION: you must be at an approved workplace to mark attendance';
  END IF;

  IF is_checkin THEN NEW.check_in_location_id  := matched;
  ELSE               NEW.check_out_location_id := matched; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_attendance_geofence ON attendance;
CREATE TRIGGER trg_attendance_geofence
  BEFORE INSERT OR UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION enforce_attendance_geofence();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('attendance-selfies', 'attendance-selfies', false, 5242880, ARRAY['image/jpeg','image/webp','image/png'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS attendance_selfies_read ON storage.objects;
CREATE POLICY attendance_selfies_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attendance-selfies'
         AND (NULLIF(split_part(name, '/', 1), ''))::uuid IN (SELECT auth_user_org_ids()));

DROP POLICY IF EXISTS attendance_selfies_insert ON storage.objects;
CREATE POLICY attendance_selfies_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attendance-selfies'
             AND (NULLIF(split_part(name, '/', 1), ''))::uuid IN (SELECT auth_user_org_ids()));

DROP POLICY IF EXISTS attendance_selfies_update ON storage.objects;
CREATE POLICY attendance_selfies_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'attendance-selfies'
         AND (NULLIF(split_part(name, '/', 1), ''))::uuid IN (SELECT auth_user_org_ids()));

DROP POLICY IF EXISTS attendance_selfies_delete ON storage.objects;
CREATE POLICY attendance_selfies_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'attendance-selfies'
         AND (NULLIF(split_part(name, '/', 1), ''))::uuid IN (SELECT auth_user_org_ids()));