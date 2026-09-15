create or replace function public.crm_convert_prospect(p_partner_id uuid, p_mobile text default ''::text, p_firm text default ''::text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer; v_org uuid;
begin
  select org_id into v_org from crm_partner_details where id = p_partner_id;
  if v_org is null or v_org not in (select auth_user_org_ids()) then
    raise exception 'partner not found in your organization';
  end if;

  update crm_visits v
     set account_id = p_partner_id, partner_type = 'registered'
   where v.org_id = v_org
     and v.partner_type = 'unregistered'
     and (
       (coalesce(p_mobile,'') <> '' and v.owner_mobile = p_mobile)
       or (coalesce(p_mobile,'') = '' and coalesce(p_firm,'') <> '' and lower(v.firm_name) = lower(p_firm))
     );
  get diagnostics n = row_count;
  return n;
end $function$;

notify pgrst, 'reload schema';