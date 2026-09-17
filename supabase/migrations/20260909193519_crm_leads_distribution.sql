alter table crm_leads
  add column if not exists reported_by_partner_id uuid references crm_partner_details(id) on delete set null,
  add column if not exists product_interest text,
  add column if not exists expected_value numeric;

create index if not exists crm_leads_reported_by_idx on crm_leads (org_id, reported_by_partner_id);