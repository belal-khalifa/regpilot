-- REG-276 Public chatbot. Run once in Supabase > SQL Editor before using the branch.
-- Adds new tables only; nothing existing changes, so it is safe for the live site.
--   site_settings          one row of contact details, services text and chat limits, read by the whole platform
--   reference_sources      one row per regulation or guideline loaded into the library
--   reference_chunks       the searchable passages of those documents
--   public_chat_usage      daily question counts per visitor, for the limits
--   public_chat_logs       questions and answers, deleted after 30 days
--   storage bucket reference-documents   the original regulation files (private)

create extension if not exists vector with schema extensions;

-- Site settings: change contact details, texts or limits here and every page and function uses them.
create table if not exists public.site_settings (
  id int primary key default 1 check (id = 1),
  contact_email text not null,
  whatsapp_number text not null,
  pricing_en text not null,
  pricing_ar text not null,
  services_en text not null,
  services_ar text not null,
  chat_daily_site_limit int not null default 300,
  chat_daily_visitor_limit int not null default 20,
  chat_max_question_chars int not null default 500,
  updated_at timestamptz not null default now()
);

insert into public.site_settings (
  id, contact_email, whatsapp_number, pricing_en, pricing_ar, services_en, services_ar
) values (
  1,
  'regpilot11@outlook.com',
  '+971503791220',
  'Pricing depends on the number of products and the service you choose. Contact us for a quote.',
  'تعتمد الأسعار على عدد المنتجات والخدمة التي تختارها. تواصل معنا للحصول على عرض سعر.',
  'RegPilot helps companies register cosmetic, personal care and fragrance products with Dubai Municipality (Montaji), faster and with fewer mistakes.

- Registration filling. Upload all your product documents in one go, such as the ingredient list, certificate of analysis, free sale certificate, GMP certificate and label. RegPilot reads them, prepares the registration data for you to review, and our Filling tool fills the Montaji forms in your browser. You review everything and submit it yourself.
- Regulatory check (coming soon). We check your label, claims and ingredients against the Dubai Municipality guidelines and the EU Cosmetics Regulation. You get an instant preliminary brief, and our regulatory experts confirm the result within 1 to 2 working days.
- Regulatory advice. Our team of regulatory specialists can advise you on what your product needs before registration.

Product types today: cosmetics and personal care, and perfumes. Detergents, biocides and health supplements are coming later.',
  'RegPilot يساعد الشركات على تسجيل مستحضرات التجميل ومنتجات العناية الشخصية والعطور لدى بلدية دبي (منصة منتجي) بسرعة أكبر وأخطاء أقل.

- تعبئة طلبات التسجيل. ارفع جميع مستندات المنتج دفعة واحدة، مثل قائمة المكونات وشهادة التحليل وشهادة حرية البيع وشهادة التصنيع الجيد (GMP) والملصق. يقرأ RegPilot المستندات ويجهّز بيانات التسجيل لمراجعتك، ثم تقوم أداة التعبئة بملء نماذج منتجي في متصفحك. تراجع كل شيء وتقدّم الطلب بنفسك.
- الفحص التنظيمي (قريباً). نفحص الملصق والادعاءات والمكونات وفق إرشادات بلدية دبي ولائحة الاتحاد الأوروبي لمستحضرات التجميل. تحصل على ملخص أولي فوري، ويؤكد خبراؤنا التنظيميون النتيجة خلال يوم إلى يومي عمل.
- الاستشارات التنظيمية. يقدّم فريقنا من المتخصصين في الشؤون التنظيمية المشورة حول متطلبات منتجك قبل التسجيل.

أنواع المنتجات حالياً: مستحضرات التجميل والعناية الشخصية، والعطور. المنظفات والمبيدات الحيوية والمكملات الصحية لاحقاً.'
) on conflict (id) do nothing;

alter table public.site_settings enable row level security;
create policy "site_settings: anyone can read" on public.site_settings for select using (true);
grant select on public.site_settings to anon, authenticated;
grant select, insert, update, delete on public.site_settings to service_role;

-- Reference library. A source is replaced by loading its new passages under a new load_id and then
-- switching current_load_id in one step, so the bot never sees a half-loaded document.
create table if not exists public.reference_sources (
  id text primary key,                 -- e.g. 'eu-1223-2009', 'dm-gu116'
  title text not null,
  version text not null,               -- e.g. '02009R1223-20260518' or 'V2.1'
  version_date date,
  language text not null,              -- 'en' or 'ar'
  url text,
  content_hash text not null,
  current_load_id uuid,
  chunk_count int not null default 0,
  loaded_at timestamptz not null default now()
);

create table if not exists public.reference_chunks (
  id bigint generated always as identity primary key,
  source_id text not null,
  load_id uuid not null,
  label text not null,                 -- e.g. 'Annex III, entry 75' or 'Section 5.3'
  content text not null,
  embedding extensions.vector(768) not null,
  fts tsvector generated always as (to_tsvector('simple', label || ' ' || content)) stored,
  created_at timestamptz not null default now()
);

create index if not exists reference_chunks_source_load_idx on public.reference_chunks (source_id, load_id);
create index if not exists reference_chunks_fts_idx on public.reference_chunks using gin (fts);
create index if not exists reference_chunks_embedding_idx on public.reference_chunks
  using hnsw (embedding extensions.vector_cosine_ops);

alter table public.reference_sources enable row level security;
alter table public.reference_chunks enable row level security;
-- Published regulations: any signed-in user may read them (the logged-in chat, REG-275, will).
create policy "reference_sources: signed-in users can read" on public.reference_sources for select to authenticated using (true);
create policy "reference_chunks: signed-in users can read" on public.reference_chunks for select to authenticated using (true);
grant select on public.reference_sources, public.reference_chunks to authenticated;
grant select, insert, update, delete on public.reference_sources, public.reference_chunks to service_role;

-- Makes a finished load the current one and removes the passages of the previous load.
create or replace function public.finish_reference_load(
  p_source_id text, p_load_id uuid, p_title text, p_version text, p_version_date date,
  p_language text, p_url text, p_content_hash text
) returns void
language plpgsql
set search_path = public
as $$
declare
  v_count int;
begin
  select count(*) into v_count from reference_chunks where source_id = p_source_id and load_id = p_load_id;
  if v_count = 0 then
    raise exception 'load % of % has no passages', p_load_id, p_source_id;
  end if;
  insert into reference_sources (id, title, version, version_date, language, url, content_hash, current_load_id, chunk_count, loaded_at)
  values (p_source_id, p_title, p_version, p_version_date, p_language, p_url, p_content_hash, p_load_id, v_count, now())
  on conflict (id) do update set
    title = excluded.title, version = excluded.version, version_date = excluded.version_date,
    language = excluded.language, url = excluded.url, content_hash = excluded.content_hash,
    current_load_id = excluded.current_load_id, chunk_count = excluded.chunk_count, loaded_at = excluded.loaded_at;
  delete from reference_chunks where source_id = p_source_id and load_id <> p_load_id;
end;
$$;

-- Removes a source that is no longer in the library (e.g. a guideline file deleted from storage).
create or replace function public.remove_reference_source(p_source_id text) returns void
language sql
set search_path = public
as $$
  delete from reference_chunks where source_id = p_source_id;
  delete from reference_sources where id = p_source_id;
$$;

-- Finds the passages closest to a question: by meaning (embedding) and by exact words (names, CAS
-- numbers), from current loads only.
create or replace function public.match_reference_chunks(
  query_embedding extensions.vector(768), query_text text, match_count int default 8
) returns table (id bigint, source_id text, label text, content text, title text, version text, url text, score float)
language sql stable
set search_path = public, extensions
as $$
  with current as (
    select c.* from reference_chunks c join reference_sources s on s.id = c.source_id and s.current_load_id = c.load_id
  ),
  by_meaning as (
    select current.id, 1 - (current.embedding <=> query_embedding) as score
    from current order by current.embedding <=> query_embedding limit match_count
  ),
  by_words as (
    select current.id, 0.5 + ts_rank(current.fts, websearch_to_tsquery('simple', query_text)) as score
    from current
    where query_text <> '' and current.fts @@ websearch_to_tsquery('simple', query_text)
    order by ts_rank(current.fts, websearch_to_tsquery('simple', query_text)) desc
    limit greatest(match_count / 2, 2)
  ),
  merged as (
    select m.id, max(m.score) as score from (select * from by_meaning union all select * from by_words) m group by m.id
  )
  select c.id, c.source_id, c.label, c.content, s.title, s.version, s.url, merged.score
  from merged
  join reference_chunks c on c.id = merged.id
  join reference_sources s on s.id = c.source_id
  order by merged.score desc
  limit match_count;
$$;

-- Chat limits and logs. Only the public-chat function (service role) touches these.
create table if not exists public.public_chat_usage (
  day date not null,
  visitor text not null,               -- scrambled visitor id, or '*' for the whole site
  questions int not null default 0,
  primary key (day, visitor)
);

create table if not exists public.public_chat_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  language text,
  question text not null,
  answer text not null,
  sources jsonb not null default '[]'::jsonb,
  answered_from_references boolean not null default false
);

alter table public.public_chat_usage enable row level security;
alter table public.public_chat_logs enable row level security;
grant select, insert, update, delete on public.public_chat_usage, public.public_chat_logs to service_role;

-- Counts one question against today's limits (UAE time). Returns 'ok', 'site_limit' or 'visitor_limit'.
-- Also clears usage older than two days and logs older than 30 days.
create or replace function public.claim_public_chat_question(p_visitor text) returns text
language plpgsql
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Dubai')::date;
  v_site_limit int;
  v_visitor_limit int;
  v_site int;
  v_visitor int;
begin
  select chat_daily_site_limit, chat_daily_visitor_limit into v_site_limit, v_visitor_limit from site_settings where id = 1;

  delete from public_chat_usage where day < v_day - 2;
  delete from public_chat_logs where created_at < now() - interval '30 days';

  select questions into v_site from public_chat_usage where day = v_day and visitor = '*' for update;
  if coalesce(v_site, 0) >= v_site_limit then return 'site_limit'; end if;
  select questions into v_visitor from public_chat_usage where day = v_day and visitor = p_visitor for update;
  if coalesce(v_visitor, 0) >= v_visitor_limit then return 'visitor_limit'; end if;

  insert into public_chat_usage (day, visitor, questions) values (v_day, '*', 1), (v_day, p_visitor, 1)
  on conflict (day, visitor) do update set questions = public_chat_usage.questions + 1;
  return 'ok';
end;
$$;

revoke execute on function public.finish_reference_load(text, uuid, text, text, date, text, text, text) from public, anon, authenticated;
revoke execute on function public.remove_reference_source(text) from public, anon, authenticated;
revoke execute on function public.claim_public_chat_question(text) from public, anon, authenticated;
revoke execute on function public.match_reference_chunks(extensions.vector, text, int) from public, anon;
grant execute on function public.finish_reference_load(text, uuid, text, text, date, text, text, text) to service_role;
grant execute on function public.remove_reference_source(text) to service_role;
grant execute on function public.claim_public_chat_question(text) to service_role;
grant execute on function public.match_reference_chunks(extensions.vector, text, int) to authenticated, service_role;

-- Private bucket for the original regulation files. Upload the Dubai Municipality guideline PDFs to
-- its top level; the loader saves the EU regulation under eu/ itself. No policies: only the loader
-- (service role) reads and writes it.
insert into storage.buckets (id, name, public) values ('reference-documents', 'reference-documents', false)
on conflict (id) do nothing;
