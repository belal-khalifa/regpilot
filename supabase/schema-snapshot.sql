-- RegPilot database: reference snapshot of the LIVE Supabase project, exported 2026-10-17.
--
-- This is for review and for rebuilding the project elsewhere; it is not meant to be run on top of
-- the live database. The database was created through Supabase, so this file is generated from it.
-- When you change the database, change it in Supabase and refresh this file.
-- Checked against the live project on 2026-10-17 (policies, functions, triggers and bucket settings
-- were read back from Supabase when this file was written).
--
-- How access works: every table has Row Level Security on. A person belongs to companies through
-- company_members; is_company_member(company_id) is the single check used by every policy. Files in
-- the private storage bucket live under "<company_id>/<product_id>/..." and storage policies use the
-- first folder name as the company.

-- ---------------------------------------------------------------- storage bucket
-- Private bucket, 15 MB per file, PDF and image types only. (On a new project, run this once.)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-documents', 'product-documents', false, 15 * 1024 * 1024,
        array['application/pdf','image/png','image/jpeg','image/webp','image/heic','image/heif'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------- types
create type public.document_type as enum ('formula_ingredient_list', 'certificate_free_sale', 'label_artwork');
create type public.product_status as enum ('draft', 'extracted', 'ready_to_fill', 'submitted', 'approved', 'rejected');

-- ---------------------------------------------------------------- tables
create table public.profiles (
  id uuid not null,
  display_name text,
  avatar_url text,
  created_at timestamp with time zone not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade
);

create table public.companies (
  id uuid not null default gen_random_uuid(),
  name text not null,
  created_by uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint companies_pkey primary key (id),
  constraint companies_created_by_fkey foreign key (created_by) references auth.users(id)
);

create table public.company_members (
  id uuid not null default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint company_members_pkey primary key (id),
  constraint company_members_company_id_user_id_key unique (company_id, user_id),
  constraint company_members_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade,
  constraint company_members_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);

create table public.products (
  id uuid not null default gen_random_uuid(),
  company_id uuid not null,
  name text not null,
  status public.product_status not null default 'draft',
  extracted_data jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  seq_no integer, -- RegPilot's own per-company number, set by a trigger
  constraint products_pkey primary key (id),
  constraint products_company_id_fkey foreign key (company_id) references public.companies(id) on delete cascade,
  constraint products_created_by_fkey foreign key (created_by) references auth.users(id)
);
create unique index products_company_seq_no_key on public.products using btree (company_id, seq_no);

create table public.product_documents (
  id uuid not null default gen_random_uuid(),
  product_id uuid not null,
  doc_type public.document_type not null,
  storage_path text not null,
  file_name text not null,
  uploaded_by uuid not null,
  created_at timestamp with time zone not null default now(),
  content_type text not null default 'application/octet-stream',
  constraint product_documents_pkey primary key (id),
  constraint product_documents_product_id_fkey foreign key (product_id) references public.products(id) on delete cascade,
  constraint product_documents_uploaded_by_fkey foreign key (uploaded_by) references auth.users(id)
);

-- One row per extraction attempt: limits runs per person and blocks two runs on one product at once.
create table public.extraction_runs (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  product_id uuid not null,
  started_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone,
  constraint extraction_runs_pkey primary key (id),
  constraint extraction_runs_product_id_fkey foreign key (product_id) references public.products(id) on delete cascade,
  constraint extraction_runs_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade
);
create index extraction_runs_product_idx on public.extraction_runs using btree (product_id, started_at desc);
create index extraction_runs_user_started_idx on public.extraction_runs using btree (user_id, started_at desc);

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.products enable row level security;
alter table public.product_documents enable row level security;
alter table public.extraction_runs enable row level security;

-- ---------------------------------------------------------------- functions and triggers
create or replace function public.is_company_member(target_company_id uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.company_members
    where company_id = target_company_id and user_id = auth.uid()
  );
$$;

-- A new company makes its creator its first member.
create or replace function public.handle_new_company() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.company_members (company_id, user_id) values (new.id, new.created_by);
  return new;
end;
$$;
create trigger on_company_created after insert on public.companies
  for each row execute function public.handle_new_company();

-- A new sign-up gets a profile.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Per-company product number: highest existing + 1 (a deleted newest number can be reused).
create or replace function public.assign_product_seq_no() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  if new.seq_no is null then
    perform pg_advisory_xact_lock(hashtext(new.company_id::text));
    select coalesce(max(seq_no), 0) + 1 into new.seq_no from public.products where company_id = new.company_id;
  end if;
  return new;
end;
$$;
create trigger products_assign_seq_no before insert on public.products
  for each row execute function public.assign_product_seq_no();

-- Inserts are serialized per product so the cap cannot be raced.
create or replace function public.limit_documents_per_product() returns trigger
language plpgsql set search_path to 'public' as $$
begin
  perform pg_advisory_xact_lock(hashtext('docs:' || new.product_id::text));
  if (select count(*) from public.product_documents where product_id = new.product_id) >= 20 then
    raise exception 'A product can have at most 20 documents';
  end if;
  return new;
end;
$$;
create trigger product_documents_limit before insert on public.product_documents
  for each row execute function public.limit_documents_per_product();

-- ---------------------------------------------------------------- policies
create policy "profiles: users can view own profile" on public.profiles for select using (id = auth.uid());
create policy "profiles: users can insert own profile" on public.profiles for insert with check (id = auth.uid());
create policy "profiles: users can update own profile" on public.profiles for update using (id = auth.uid());

create policy "companies: authenticated users can create a company" on public.companies for insert with check (created_by = auth.uid());
create policy "companies: members can view their companies" on public.companies for select using (is_company_member(id));
create policy "companies: members can update their companies" on public.companies for update using (is_company_member(id));

-- Only existing members can add members (the creator is added by the trigger above).
create policy "company_members: members can add teammates" on public.company_members for insert with check (is_company_member(company_id));
create policy "company_members: members can view fellow members" on public.company_members for select using (is_company_member(company_id));
create policy "company_members: members can remove teammates" on public.company_members for delete using (is_company_member(company_id));

create policy "products: members can create products" on public.products for insert with check (is_company_member(company_id) and created_by = auth.uid());
create policy "products: members can view their company's products" on public.products for select using (is_company_member(company_id));
create policy "products: members can update their company's products" on public.products for update using (is_company_member(company_id));
create policy "products: members can delete their company's products" on public.products for delete using (is_company_member(company_id));

create policy "product_documents: members can upload documents" on public.product_documents for insert
  with check (uploaded_by = auth.uid() and exists (select 1 from products where products.id = product_documents.product_id and is_company_member(products.company_id)));
create policy "product_documents: members can view their company's documents" on public.product_documents for select
  using (exists (select 1 from products where products.id = product_documents.product_id and is_company_member(products.company_id)));
create policy "product_documents: members can delete their company's documents" on public.product_documents for delete
  using (exists (select 1 from products where products.id = product_documents.product_id and is_company_member(products.company_id)));

create policy "extraction_runs: view own runs" on public.extraction_runs for select using (user_id = auth.uid());
-- Runs are written only through the two functions below (no insert/update policies on purpose).

-- Reserve a run in one atomic step: access check, one run per product at a time (across all members),
-- and a per-person hourly limit. Error codes: RP001 already running, RP002 too many runs.
create or replace function public.claim_extraction_run(p_product_id uuid, p_max_per_hour int, p_stale_seconds int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rid uuid;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not exists (select 1 from public.products p where p.id = p_product_id and public.is_company_member(p.company_id)) then
    raise exception 'no access to this product' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('extract-product:' || p_product_id::text));
  perform pg_advisory_xact_lock(hashtext('extract-user:' || uid::text));
  if exists (select 1 from public.extraction_runs r where r.product_id = p_product_id and r.finished_at is null
             and r.started_at > now() - make_interval(secs => p_stale_seconds)) then
    raise exception 'extraction already running for this product' using errcode = 'RP001';
  end if;
  if (select count(*) from public.extraction_runs r where r.user_id = uid and r.started_at > now() - interval '1 hour') >= p_max_per_hour then
    raise exception 'too many extraction runs this hour' using errcode = 'RP002';
  end if;
  insert into public.extraction_runs (user_id, product_id) values (uid, p_product_id) returning id into rid;
  return rid;
end;
$$;

create or replace function public.finish_extraction_run(p_run_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.extraction_runs set finished_at = now() where id = p_run_id and user_id = auth.uid() and finished_at is null;
$$;

revoke all on function public.claim_extraction_run(uuid, int, int) from public, anon;
revoke all on function public.finish_extraction_run(uuid) from public, anon;
grant execute on function public.claim_extraction_run(uuid, int, int) to authenticated;
grant execute on function public.finish_extraction_run(uuid) to authenticated;

-- storage.objects (private bucket "product-documents"; first folder of the path is the company id)
create policy "product-documents storage: members can read" on storage.objects for select
  using (bucket_id = 'product-documents' and is_company_member(((storage.foldername(name))[1])::uuid));
create policy "product-documents storage: members can upload" on storage.objects for insert
  with check (bucket_id = 'product-documents' and is_company_member(((storage.foldername(name))[1])::uuid));
create policy "product-documents storage: members can delete" on storage.objects for delete
  using (bucket_id = 'product-documents' and is_company_member(((storage.foldername(name))[1])::uuid));
