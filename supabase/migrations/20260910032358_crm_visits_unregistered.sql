alter table crm_visits
  add column if not exists partner_type  text not null default 'registered',
  add column if not exists owner_name    text,
  add column if not exists owner_mobile  text,
  add column if not exists region        text,
  add column if not exists state         text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_visits_partner_type_chk') then
    alter table crm_visits add constraint crm_visits_partner_type_chk
      check (partner_type in ('registered','unregistered'));
  end if;
end $$;

update crm_visits v set
  partner_type = case when v.account_id is not null then 'registered' else 'unregistered' end,
  region = coalesce(v.region, a.region),
  state  = coalesce(v.state,  a.state)
from crm_partner_details a
where a.id = v.account_id;

update crm_visits
set partner_type = 'unregistered'
where account_id is null and partner_type <> 'unregistered';

notify pgrst, 'reload schema';