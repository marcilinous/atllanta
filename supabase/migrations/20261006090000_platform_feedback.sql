-- v1.15.0: private in-app feedback (spec docs/superpowers/specs/2026-10-06-feedback-design.md).
--
-- Anyone signed in — members of blocked companies included — sends Idea /
-- Problem / Praise with an optional 1–5 rating and a message. Only the
-- platform owner reads it. The table has RLS on and no grants: it is reached
-- only through the three functions below.

create table if not exists public.platform_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  org_id uuid references public.organizations(id) on delete set null,
  role text,
  kind text not null check (kind in ('idea', 'problem', 'praise')),
  rating smallint check (rating between 1 and 5),
  message text not null check (char_length(regexp_replace(message, '^\s+|\s+$', '', 'g')) between 1 and 2000),
  page text check (page is null or char_length(page) <= 300),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists platform_feedback_created_idx on public.platform_feedback (created_at desc);
create index if not exists platform_feedback_unread_idx on public.platform_feedback (created_at desc) where read_at is null;
create index if not exists platform_feedback_user_recent_idx on public.platform_feedback (user_id, created_at desc);

alter table public.platform_feedback enable row level security;
revoke all on table public.platform_feedback from public, anon, authenticated;

-- Send. The sender, company and role come from the caller's own users row —
-- not auth_org_id(), so a company whose trial ended can still say why.
create or replace function public.submit_feedback(p_kind text, p_rating int, p_message text, p_page text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_role text;
  v_org_name text;
  v_msg text := regexp_replace(coalesce(p_message, ''), '^\s+|\s+$', '', 'g');
  v_page text;
  v_id uuid;
  v_label text;
begin
  if v_uid is null then
    raise exception 'Sign in to send feedback' using errcode = '42501';
  end if;
  select u.org_id, u.role into v_org, v_role from public.users u where u.id = v_uid;
  if not found then
    raise exception 'Sign in to send feedback' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('idea', 'problem', 'praise') then
    raise exception 'Choose Idea, Problem or Praise' using errcode = '22023';
  end if;
  if p_rating is not null and (p_rating < 1 or p_rating > 5) then
    raise exception 'Rating must be 1 to 5 stars' using errcode = '22023';
  end if;
  if char_length(v_msg) < 1 or char_length(v_msg) > 2000 then
    raise exception 'Write a message of up to 2,000 characters' using errcode = '22023';
  end if;
  if (select count(*) from public.platform_feedback f
       where f.user_id = v_uid and f.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'You''ve sent a lot of feedback today — please try again tomorrow' using errcode = '22023';
  end if;

  v_page := case when p_page like '/%' and p_page not like '//%' and position(chr(92) in p_page) = 0 then left(p_page, 300) else null end;

  insert into public.platform_feedback (user_id, org_id, role, kind, rating, message, page)
  values (v_uid, v_org, v_role, p_kind, p_rating, v_msg, v_page)
  returning id into v_id;

  select o.name into v_org_name from public.organizations o where o.id = v_org;
  v_label := case p_kind when 'idea' then 'Idea' when 'problem' then 'Problem' else 'Praise' end;

  insert into public.notifications (org_id, user_id, title, body, module, entity_type, entity_id, channel, status, email_status)
  select u.org_id, pa.user_id, 'New feedback: ' || v_label,
         coalesce(v_org_name, 'A company') || ': ' || left(v_msg, 120),
         'platform', 'feedback', v_id, 'in_app', 'unread', 'none'
  from public.platform_admins pa join public.users u on u.id = pa.user_id
  where u.org_id is not null;

  return v_id;
end;
$function$;

-- Read (platform owner only). Left joins: an entry outlives a deleted
-- account or company.
create or replace function public.platform_feedback_list(p_only_unread boolean default false, p_kind text default null)
returns table(id uuid, created_at timestamptz, kind text, rating smallint, message text, page text, read_at timestamptz,
              user_name text, user_email text, role text, org_name text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';
  end if;
  return query
    select f.id, f.created_at, f.kind, f.rating, f.message, f.page, f.read_at,
           u.full_name, u.email, f.role, o.name
    from public.platform_feedback f
    left join public.users u on u.id = f.user_id
    left join public.organizations o on o.id = f.org_id
    where (not coalesce(p_only_unread, false) or f.read_at is null)
      and (p_kind is null or f.kind = p_kind)
    order by f.created_at desc
    limit 500;
end;
$function$;

create or replace function public.platform_feedback_mark_read(p_id uuid, p_read boolean default true)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Only the Atllanta platform owner can do that' using errcode = '42501';
  end if;
  update public.platform_feedback
     set read_at = case when coalesce(p_read, true) then now() else null end
   where id = p_id;
  if not found then
    raise exception 'Feedback not found' using errcode = '22023';
  end if;
end;
$function$;

revoke all on function public.submit_feedback(text, int, text, text) from public, anon;
grant execute on function public.submit_feedback(text, int, text, text) to authenticated;
revoke all on function public.platform_feedback_list(boolean, text) from public, anon;
grant execute on function public.platform_feedback_list(boolean, text) to authenticated;
revoke all on function public.platform_feedback_mark_read(uuid, boolean) from public, anon;
grant execute on function public.platform_feedback_mark_read(uuid, boolean) to authenticated;
