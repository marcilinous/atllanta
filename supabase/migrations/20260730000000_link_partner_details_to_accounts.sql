-- ATLLANTA — link crm_partner_details to crm_accounts.
--
-- The partner-details master (Site ID) and the analytics backbone crm_accounts
-- (external_id) describe the same partners. Populate the account_id FK by
-- matching site_id = external_id within the same org, so a partner's detail card
-- and the sales/distribution analytics share one identity.
--
-- Idempotent join backfill; safe to re-run. Partners with no matching account
-- (e.g. newly added ones not yet in crm_accounts) simply stay unlinked.

update crm_partner_details pd
set account_id = a.id, updated_at = now()
from crm_accounts a
where a.org_id = pd.org_id
  and a.external_id = pd.site_id
  and pd.account_id is distinct from a.id;
