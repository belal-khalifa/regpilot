-- REG-269 Free but limited instant regulatory check. Run once in Supabase > SQL Editor, after
-- 2026-10-31-product-chat.sql (REG-275). Adds new things only; nothing existing changes.
--   site_settings.instant_check_monthly_limit   free instant checks per company per calendar month (UAE time), default 10
--   instant_check_usage                          checks used per company per month, for the limit
-- To change the allowance later: update site_settings set instant_check_monthly_limit = 20 where id = 1;

alter table public.site_settings add column if not exists instant_check_monthly_limit int not null default 10;

create table if not exists public.instant_check_usage (
  month date not null, -- first day of the month, UAE time
  company_id uuid not null references public.companies (id) on delete cascade,
  checks int not null default 0,
  primary key (month, company_id)
);
alter table public.instant_check_usage enable row level security;
grant select, insert, update, delete on public.instant_check_usage to service_role;

-- Counts one instant check for this company this month. Returns 'ok' or 'check_limit'.
create or replace function public.claim_instant_check(p_company uuid) returns text
language plpgsql
set search_path = public
as $$
declare
  v_month date := date_trunc('month', now() at time zone 'Asia/Dubai')::date;
  v_limit int;
  v_used int;
begin
  select instant_check_monthly_limit into v_limit from site_settings where id = 1;
  select checks into v_used from instant_check_usage where month = v_month and company_id = p_company for update;
  if coalesce(v_used, 0) >= v_limit then return 'check_limit'; end if;
  insert into instant_check_usage (month, company_id, checks) values (v_month, p_company, 1)
  on conflict (month, company_id) do update set checks = instant_check_usage.checks + 1;
  return 'ok';
end;
$$;

-- Gives a check back when the AI could not answer, so a failed attempt does not use the allowance.
create or replace function public.release_instant_check(p_company uuid) returns void
language sql
set search_path = public
as $$
  update instant_check_usage set checks = greatest(checks - 1, 0)
  where month = date_trunc('month', now() at time zone 'Asia/Dubai')::date and company_id = p_company;
$$;

revoke execute on function public.claim_instant_check(uuid) from public, anon, authenticated;
revoke execute on function public.release_instant_check(uuid) from public, anon, authenticated;
grant execute on function public.claim_instant_check(uuid) to service_role;
grant execute on function public.release_instant_check(uuid) to service_role;
