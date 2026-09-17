CREATE TABLE IF NOT EXISTS public.crm_partner_details (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id             uuid REFERENCES public.crm_accounts(id) ON DELETE SET NULL,
  site_id                text,
  partner_name           text,
  email_address          text,
  contact_person_name    text,
  mobile_number          text,
  alternative_mobile_no  text,
  tally_serial_no        text,
  address                text,
  pincode                text,
  city                   text,
  hub                    text,
  district               text,
  state                  text,
  region                 text,
  role                   text,
  role_status            text,
  top_25_list            text,
  coordinates            text,
  pan_no                 text,
  gstin                  text,
  bde_name               text,
  telecaller_name        text,
  upi_id                 text,
  credit_limit           numeric,
  account_number         text,
  bank_name              text,
  ifsc_code              text,
  ap_cp_taalmel          text,
  ap_cp_taalmel_partner  text,
  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_partner_details_org_id_idx      ON public.crm_partner_details (org_id);
CREATE INDEX IF NOT EXISTS crm_partner_details_account_id_idx  ON public.crm_partner_details (account_id);
CREATE INDEX IF NOT EXISTS crm_partner_details_site_id_idx     ON public.crm_partner_details (org_id, site_id);
CREATE INDEX IF NOT EXISTS crm_partner_details_region_idx      ON public.crm_partner_details (org_id, region);
CREATE INDEX IF NOT EXISTS crm_partner_details_hub_idx         ON public.crm_partner_details (org_id, hub);
CREATE INDEX IF NOT EXISTS crm_partner_details_bde_idx         ON public.crm_partner_details (org_id, bde_name);
CREATE INDEX IF NOT EXISTS crm_partner_details_telecaller_idx  ON public.crm_partner_details (org_id, telecaller_name);

ALTER TABLE public.crm_partner_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_partner_details_select ON public.crm_partner_details
  FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));

CREATE POLICY crm_partner_details_insert ON public.crm_partner_details
  FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND crm_user_is_org_admin());

CREATE POLICY crm_partner_details_update ON public.crm_partner_details
  FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()) AND crm_user_is_org_admin());

CREATE POLICY crm_partner_details_delete ON public.crm_partner_details
  FOR DELETE USING (org_id IN (SELECT auth_user_org_ids()) AND crm_user_is_org_admin());