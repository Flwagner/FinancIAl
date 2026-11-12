-- Créer ton utilisateur via Authentication > Users, désactiver les inscriptions.
create schema if not exists financial_private;
revoke all on schema financial_private from public;
grant usage on schema financial_private to anon, authenticated;
create table if not exists public.portfolio_owner (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.portfolio_owner enable row level security;
create table if not exists public.portfolios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.portfolios enable row level security;
create or replace function financial_private.is_portfolio_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.portfolio_owner where user_id = (select auth.uid()));
$$;
revoke all on function financial_private.is_portfolio_owner() from public, anon, authenticated;
grant execute on function financial_private.is_portfolio_owner() to authenticated;
revoke all on public.portfolio_owner from anon, authenticated;
revoke all on public.portfolios from anon, authenticated;
grant select, insert, update, delete on public.portfolios to authenticated;
create policy "Owner only" on public.portfolios for all to authenticated
  using (user_id = (select auth.uid()) and (select financial_private.is_portfolio_owner()))
  with check (user_id = (select auth.uid()) and (select financial_private.is_portfolio_owner()));
-- Ce trigger système n'a aucune raison d'être exécutable depuis la Data API.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
-- Après création de ton compte, remplacer l'UUID :
-- insert into public.portfolio_owner(user_id) values ('UUID_DE_TON_COMPTE');
