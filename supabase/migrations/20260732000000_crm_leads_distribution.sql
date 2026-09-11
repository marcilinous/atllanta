-- ATLLANTA — distribution-channel fields for crm_leads.
--
-- RTcompu sells through partners and cannot track the end customer: a lead is
-- what a PARTNER reports, and the partner's information is final (not verified
-- downstream). Link each lead to the reporting partner and record what they
-- said they want. Nullable + backward-compatible.

alter table crm_leads
  add column if not exists reported_by_partner_id uuid references crm_partner_details(id) on delete set null,
  add column if not exists product_interest text,
  add column if not exists expected_value numeric;

create index if not exists crm_leads_reported_by_idx on crm_leads (org_id, reported_by_partner_id);
