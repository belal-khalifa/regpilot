-- REG-275 Logged-in chat. Run once in Supabase > SQL Editor before using the branch.
-- Needs 2026-10-26-public-chatbot.sql (site_settings, reference library) to have run first.
-- Adds new things only; nothing existing changes, so it is safe for the live site.
--   site_settings.chat_daily_user_limit   questions per signed-in user per day (default 50)
--   product_chat_messages                 the logged-in conversations, kept 30 days
--   product_chat_usage                    daily question counts per user, for the limit

alter table public.site_settings add column if not exists chat_daily_user_limit int not null default 50;

-- One conversation per product, plus one per company for the dashboard (product_id null). Deleted
-- with the product, and after 30 days.
create table if not exists public.product_chat_messages (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid references public.products (id) on delete cascade,
  user_id uuid not null default auth.uid(),
  role text not null check (role in ('user', 'assistant')),
  text text not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists product_chat_messages_conversation_idx
  on public.product_chat_messages (company_id, product_id, created_at);

alter table public.product_chat_messages enable row level security;
create policy "product_chat_messages: members can read their company's chats" on public.product_chat_messages
  for select to authenticated using (is_company_member(company_id));
-- The chat function writes as the signed-in user, so a message can only land in that user's own
-- company, on one of that company's products.
create policy "product_chat_messages: members can add to their company's chats" on public.product_chat_messages
  for insert to authenticated with check (
    user_id = auth.uid()
    and is_company_member(company_id)
    and (product_id is null or exists (
      select 1 from products p where p.id = product_chat_messages.product_id and p.company_id = product_chat_messages.company_id
    ))
  );
grant select, insert on public.product_chat_messages to authenticated;
grant usage, select on sequence public.product_chat_messages_id_seq to authenticated;
grant select, insert, update, delete on public.product_chat_messages to service_role;

create table if not exists public.product_chat_usage (
  day date not null,
  user_id uuid not null,
  questions int not null default 0,
  primary key (day, user_id)
);
alter table public.product_chat_usage enable row level security;
grant select, insert, update, delete on public.product_chat_usage to service_role;

-- Counts one question for this user today (UAE time). Returns 'ok' or 'user_limit'. Also clears usage
-- older than two days and chat messages older than 30 days.
create or replace function public.claim_product_chat_question(p_user uuid) returns text
language plpgsql
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Asia/Dubai')::date;
  v_limit int;
  v_used int;
begin
  select chat_daily_user_limit into v_limit from site_settings where id = 1;

  delete from product_chat_usage where day < v_day - 2;
  delete from product_chat_messages where created_at < now() - interval '30 days';

  select questions into v_used from product_chat_usage where day = v_day and user_id = p_user for update;
  if coalesce(v_used, 0) >= v_limit then return 'user_limit'; end if;

  insert into product_chat_usage (day, user_id, questions) values (v_day, p_user, 1)
  on conflict (day, user_id) do update set questions = product_chat_usage.questions + 1;
  return 'ok';
end;
$$;

revoke execute on function public.claim_product_chat_question(uuid) from public, anon, authenticated;
grant execute on function public.claim_product_chat_question(uuid) to service_role;
