-- Test autonome, uniquement dans une base PostgreSQL jetable vide.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
\ir ../../supabase/schema.sql
\ir ../../supabase/migrations/001_market.sql
\ir ../../supabase/migrations/20261113103811_correct_instrument_references.sql

-- Historique de l'ancienne ligne GBp : il doit rester intact après la bascule.
insert into public.market_prices values
  ('JEQP.L', '2025-11-12', 2020.5, 2018.2467),
  ('JEQP.L', '2026-11-12', 1954.4, 1954.4);
insert into public.market_returns values
  ('JEQP.L', '2026-11-12', '2025-11-12', 2018.2467, 1954.4, -3.16, 'GBp', 'adjusted_close_365d', now());
create temporary table before_prices as select * from public.market_prices;
create temporary table before_returns as select * from public.market_returns;

\ir ../../supabase/migrations/20261114094306_jeqp_xetra_eur.sql

do $$
begin
  if not exists (
    select 1 from public.market_instruments
    where symbol = 'JEQP.DE' and google_code = 'XETRA:JEQP' and isin = 'IE000U9J8HX9'
      and currency = 'EUR' and provider = 'yahoo' and active
      and reference_symbol is null and reference_note is null
  ) then raise exception 'Nouvelle cotation EUR absente ou incomplète'; end if;
  if not exists (select 1 from public.market_instruments where symbol = 'JEQP.L' and not active and isin is null) then
    raise exception 'Ancienne cotation GBp encore active ou ISIN non libéré';
  end if;
  if (select count(*) from public.market_instruments where isin = 'IE000U9J8HX9') <> 1 then
    raise exception 'ISIN partagé par plusieurs lignes';
  end if;
  if exists (select * from public.market_prices except select * from before_prices)
    or exists (select * from before_prices except select * from public.market_prices) then
    raise exception 'Cours GBp modifiés ou réattribués';
  end if;
  if exists (select * from public.market_returns except select * from before_returns)
    or exists (select * from before_returns except select * from public.market_returns) then
    raise exception 'Rendement GBp modifié ou réattribué';
  end if;
  -- L'ISIN ne peut pas être réutilisé par une troisième ligne.
  begin
    insert into public.market_instruments(symbol, google_code, isin, name, currency)
      values ('BAD.DE', 'XETRA:BAD', 'IE000U9J8HX9', 'BAD', 'EUR');
    raise exception 'ISIN dupliqué accepté';
  exception when unique_violation then null;
  end;
end $$;

-- Deuxième exécution : la migration reste sans effet supplémentaire.
\ir ../../supabase/migrations/20261114094306_jeqp_xetra_eur.sql
do $$
begin
  if (select count(*) from public.market_instruments where isin = 'IE000U9J8HX9') <> 1 then
    raise exception 'Migration non idempotente';
  end if;
end $$;
