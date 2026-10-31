-- REG-255 Regulatory check, stage A (checks and instant brief). Run once in Supabase > SQL Editor.
-- Needs 2026-10-26-public-chatbot.sql (site_settings, reference library) to have run first.
-- Adds new things only; nothing existing changes, so it is safe for the live site.
--   ingredient_rules            the EU banned and restricted ingredient lists (Annexes II to VI), one row
--                               per entry and product type, loaded by the weekly reference update
--   ingredient_rule_versions    which EU version the rules come from (one row)
--   regulatory_checks           one row per check a client runs on a product
--   regulatory_findings         the findings of each check (Pass / Issue / Needs expert, with the clause)
--   site_settings.check_daily_company_limit   checks per company per day (default 10)

alter table public.site_settings add column if not exists check_daily_company_limit int not null default 10;

-- ---------------------------------------------------------------- fixed rules (REG-261)
create table if not exists public.ingredient_rules (
  id bigint generated always as identity primary key,
  version text not null,                     -- the EU consolidated version, e.g. 02009R1223-20260518
  annex text not null,                       -- 'Annex II' (prohibited) ... 'Annex VI' (UV filters)
  ref text not null,                         -- the entry number in that annex
  chemical_name text not null,
  inci_name text not null default '',
  cas_numbers text[] not null default '{}',
  names text[] not null default '{}',        -- lower-case names the entry is recognised by
  product_type text not null default '',
  max_concentration text not null default '',
  other_conditions text not null default '',
  warnings text not null default ''
);
create index if not exists ingredient_rules_names_idx on public.ingredient_rules using gin (names);
create index if not exists ingredient_rules_cas_idx on public.ingredient_rules using gin (cas_numbers);
create index if not exists ingredient_rules_version_idx on public.ingredient_rules (version);

create table if not exists public.ingredient_rule_versions (
  version text primary key,
  rule_count int not null,
  loaded_at timestamptz not null default now()
);

alter table public.ingredient_rules enable row level security;
alter table public.ingredient_rule_versions enable row level security;
-- Published regulation data: any signed-in user may read it.
create policy "ingredient_rules: signed-in users can read" on public.ingredient_rules for select to authenticated using (true);
create policy "ingredient_rule_versions: signed-in users can read" on public.ingredient_rule_versions for select to authenticated using (true);
grant select on public.ingredient_rules, public.ingredient_rule_versions to authenticated;
grant select, insert, update, delete on public.ingredient_rules, public.ingredient_rule_versions to service_role;
grant usage, select on sequence public.ingredient_rules_id_seq to service_role;

-- Makes a finished load the current version and removes the rules of older versions.
create or replace function public.finish_ingredient_rules(p_version text) returns void
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count from ingredient_rules where version = p_version;
  if v_count = 0 then raise exception 'version % has no rules', p_version; end if;
  delete from ingredient_rule_versions;
  insert into ingredient_rule_versions (version, rule_count) values (p_version, v_count);
  delete from ingredient_rules where version <> p_version;
end;
$$;
revoke execute on function public.finish_ingredient_rules(text) from public, anon, authenticated;
grant execute on function public.finish_ingredient_rules(text) to service_role;

-- ---------------------------------------------------------------- checks and findings
create table if not exists public.regulatory_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  requested_by uuid not null references auth.users (id),
  -- running: the AI is working; under_review: instant brief ready, waiting for an expert;
  -- confirmed: an expert signed it off (stage B); failed: the check could not finish.
  status text not null default 'running' check (status in ('running', 'under_review', 'confirmed', 'failed')),
  guideline text not null default '',        -- e.g. 'dm-gu116' (cosmetics) or 'dm-gu117' (perfumes)
  sources jsonb not null default '[]'::jsonb, -- the reference versions the findings come from
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  confirmed_by uuid references auth.users (id),
  confirmed_at timestamptz
);
create index if not exists regulatory_checks_product_idx on public.regulatory_checks (product_id, created_at desc);
create index if not exists regulatory_checks_company_idx on public.regulatory_checks (company_id, created_at desc);

create table if not exists public.regulatory_findings (
  id bigint generated always as identity primary key,
  check_id uuid not null references public.regulatory_checks (id) on delete cascade,
  position int not null,
  area text not null check (area in ('claims', 'label', 'ingredients', 'certificates')),
  item text not null,                        -- e.g. 'Batch number', 'Claim: "antibacterial"', 'Salicylic Acid'
  status text not null check (status in ('pass', 'issue', 'needs_expert')),
  explanation text not null default '',
  evidence text not null default '',         -- what RegPilot saw in the documents
  changes_product_type boolean not null default false,
  clause text not null default '',           -- the rule, quoted
  source_title text not null default '',
  source_version text not null default '',
  source_label text not null default '',     -- e.g. 'GU116, Section 7.1 Required Label Components'
  -- Filled by the expert in stage B.
  expert_status text check (expert_status in ('pass', 'issue', 'needs_expert')),
  expert_note text,
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz
);
create index if not exists regulatory_findings_check_idx on public.regulatory_findings (check_id, position);

alter table public.regulatory_checks enable row level security;
alter table public.regulatory_findings enable row level security;
-- Clients read their own company's checks. Only the regulatory-check function (service role) writes
-- them, so a client cannot make up or change a finding.
create policy "regulatory_checks: members can read their company's checks" on public.regulatory_checks
  for select to authenticated using (is_company_member(company_id));
create policy "regulatory_findings: members can read their company's findings" on public.regulatory_findings
  for select to authenticated using (exists (
    select 1 from regulatory_checks c where c.id = regulatory_findings.check_id and is_company_member(c.company_id)
  ));
grant select on public.regulatory_checks, public.regulatory_findings to authenticated;
grant select, insert, update, delete on public.regulatory_checks, public.regulatory_findings to service_role;
grant usage, select on sequence public.regulatory_findings_id_seq to service_role;

-- Starts a check in one atomic step: one running check per product at a time, and the daily limit
-- per company (UAE days). Returns the new check id, or 'running' / 'company_limit'. A check still
-- "running" after 10 minutes is treated as failed.
create or replace function public.claim_regulatory_check(p_company uuid, p_product uuid, p_user uuid, p_guideline text)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_limit int;
  v_today timestamptz := ((now() at time zone 'Asia/Dubai')::date)::timestamp at time zone 'Asia/Dubai';
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('regulatory-check:' || p_company::text));
  update regulatory_checks set status = 'failed', error = 'Timed out', finished_at = now()
    where product_id = p_product and status = 'running' and created_at < now() - interval '10 minutes';
  if exists (select 1 from regulatory_checks where product_id = p_product and status = 'running') then
    return 'running';
  end if;
  select check_daily_company_limit into v_limit from site_settings where id = 1;
  if (select count(*) from regulatory_checks where company_id = p_company and created_at >= v_today) >= v_limit then
    return 'company_limit';
  end if;
  insert into regulatory_checks (company_id, product_id, requested_by, guideline)
    values (p_company, p_product, p_user, p_guideline) returning id into v_id;
  return v_id::text;
end;
$$;
revoke execute on function public.claim_regulatory_check(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_regulatory_check(uuid, uuid, uuid, text) to service_role;
