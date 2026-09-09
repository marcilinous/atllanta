-- ATLLANTA — RTcompu partner-details master table.
--
-- A richer partner master than crm_accounts: the fields RTcompu keeps per
-- partner (Tally serial, PAN/GSTIN, bank + UPI, credit limit, AP-CP Taalmel,
-- coordinates, contact + BDE/telecaller names). Owner loads the data directly.
-- Org-scoped + RLS like the rest of the crm_* family; account_id optionally
-- links a row to its crm_accounts partner (nullable so a load need not match
-- first).

CREATE TABLE IF NOT EXISTS public.crm_partner_details (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id             uuid REFERENCES public.crm_accounts(id) ON DELETE SET NULL,

  site_id                text,   -- Site ID
  partner_name           text,   -- Partner Name
  email_address          text,   -- Email Address
  contact_person_name    text,   -- Contact Person Name
  mobile_number          text,   -- Mobile Number
  alternative_mobile_no  text,   -- Alternative Mobile No
  tally_serial_no        text,   -- Tally Serial No.
  address                text,   -- Address
  pincode                text,   -- Pincode
  city                   text,   -- City
  hub                    text,   -- Hub
  district               text,   -- District
  state                  text,   -- State
  region                 text,   -- Region
  role                   text,   -- Role (partner tier)
  role_status            text,   -- Role Status
  top_25_list            text,   -- Top 25 list
  coordinates            text,   -- Co-ordinates
  pan_no                 text,   -- Pan No
  gstin                  text,   -- GSTIN
  bde_name               text,   -- BDE - Name
  telecaller_name        text,   -- Telecaller - Name
  upi_id                 text,   -- UPI ID
  credit_limit           numeric,-- Credit Limit
  account_number         text,   -- Account Number
  bank_name              text,   -- Bank Name
  ifsc_code              text,   -- IFSC Code
  ap_cp_taalmel          text,   -- AP-CP Taalmel
  ap_cp_taalmel_partner  text,   -- AP-CP Taalmel Partner

  created_by             uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Indexes: org_id (mandatory per the tenancy base) + hot filter/lookup columns.
CREATE INDEX IF NOT EXISTS crm_partner_details_org_id_idx      ON public.crm_partner_details (org_id);
CREATE INDEX IF NOT EXISTS crm_partner_details_account_id_idx  ON public.crm_partner_details (account_id);
CREATE INDEX IF NOT EXISTS crm_partner_details_site_id_idx     ON public.crm_partner_details (org_id, site_id);
CREATE INDEX IF NOT EXISTS crm_partner_details_region_idx      ON public.crm_partner_details (org_id, region);
CREATE INDEX IF NOT EXISTS crm_partner_details_hub_idx         ON public.crm_partner_details (org_id, hub);
CREATE INDEX IF NOT EXISTS crm_partner_details_bde_idx         ON public.crm_partner_details (org_id, bde_name);
CREATE INDEX IF NOT EXISTS crm_partner_details_telecaller_idx  ON public.crm_partner_details (org_id, telecaller_name);

-- RLS: same org-isolation pattern as the crm_* family. Read is org-wide (this is
-- shared partner master data); writes are gated to org admins. auth_user_org_ids()
-- resolves the caller's single org (delegates to auth_org_id()).
ALTER TABLE public.crm_partner_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_partner_details_select ON public.crm_partner_details
  FOR SELECT USING (org_id IN (SELECT auth_user_org_ids()));

CREATE POLICY crm_partner_details_insert ON public.crm_partner_details
  FOR INSERT WITH CHECK (org_id IN (SELECT auth_user_org_ids()) AND crm_user_is_org_admin());

CREATE POLICY crm_partner_details_update ON public.crm_partner_details
  FOR UPDATE USING (org_id IN (SELECT auth_user_org_ids()) AND crm_user_is_org_admin());

CREATE POLICY crm_partner_details_delete ON public.crm_partner_details
  FOR DELETE USING (org_id IN (SELECT auth_user_org_ids()) AND crm_user_is_org_admin());
