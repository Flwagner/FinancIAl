-- Test autonome, uniquement dans une base PostgreSQL jetable vide.
-- Couvre la bascule JEQP vers la cotation EUR puis la suppression complète de
-- l'ancienne cotation en pence : cours, rendement, statut, instrument et codes
-- de relevés. Ce test crée volontairement l'état à supprimer.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
\ir ../../supabase/schema.sql
\ir ../../supabase/migrations/001_market.sql
\ir ../../supabase/migrations/20261113103811_correct_instrument_references.sql

-- État initial : ancienne cotation en pence, son historique, et un relevé qui la
-- référence encore (taux marché et taux manuel sur le même ISIN).
insert into public.market_prices values
  ('JEQP.L', '2025-11-12', 2020.5, 2018.2467),
  ('JEQP.L', '2026-11-12', 1954.4, 1954.4);
insert into public.market_returns values
  ('JEQP.L', '2026-11-12', '2025-11-12', 2018.2467, 1954.4, -3.16, 'GBp', 'adjusted_close_365d', now());
insert into public.market_sync_status values ('JEQP.L', now(), null);
insert into auth.users values ('00000000-0000-0000-0000-000000000012');
insert into public.portfolios(user_id, data) values
('00000000-0000-0000-0000-000000000012', '{"goals":{"capital":100},"readings":[
  {"id":"latest","date":"2026-11-13","projected":false,"positions":[
    {"name":"JEQP","code":"LON:JEQP","amount":50,"rate":-3.16,"rateAsOf":"2026-11-12","rateSource":"market"},
    {"name":"JEQP manuel","code":"IE000U9J8HX9","amount":10,"rate":7,"rateSource":"manual"}]},
  {"id":"vide","date":"2026-10-01","projected":false,"positions":[]}
]}');

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
    raise exception 'Ancienne cotation encore active ou ISIN non libéré';
  end if;
  if (select count(*) from public.market_instruments where isin = 'IE000U9J8HX9') <> 1 then
    raise exception 'ISIN partagé par plusieurs lignes';
  end if;
  if (select count(*) from public.market_prices where symbol = 'JEQP.L') <> 2 then
    raise exception 'Cours de l''ancienne cotation perdus avant la suppression';
  end if;
end $$;

-- Rendement EUR disponible au moment du nettoyage : sert de taux de secours.
insert into public.market_returns values
  ('JEQP.DE', '2026-11-13', '2025-11-13', 100, 113.3523912903285, 13.3523912903285, 'EUR', 'adjusted_close_365d', now());

\ir ../../supabase/migrations/20261114095504_remove_jeqp_london.sql

do $$
declare
  v_data jsonb;
begin
  if exists (select 1 from public.market_instruments where symbol = 'JEQP.L')
    or exists (select 1 from public.market_prices where symbol = 'JEQP.L')
    or exists (select 1 from public.market_returns where symbol = 'JEQP.L')
    or exists (select 1 from public.market_sync_status where symbol = 'JEQP.L') then
    raise exception 'Traces de l''ancienne cotation encore présentes';
  end if;
  if not exists (select 1 from public.market_instruments where symbol = 'JEQP.DE' and active and isin = 'IE000U9J8HX9') then
    raise exception 'Cotation EUR supprimée par erreur';
  end if;

  select data into v_data from public.portfolios
    where user_id = '00000000-0000-0000-0000-000000000012';

  if v_data::text like '%LON:JEQP%' or v_data::text like '%"JEQP.L"%' then
    raise exception 'Ancien code conservé dans les relevés';
  end if;
  if v_data #>> '{readings,0,positions,0,code}' <> 'XETRA:JEQP' then
    raise exception 'Code du relevé non réécrit';
  end if;
  if (v_data #>> '{readings,0,positions,0,rate}')::numeric <> 13.3523912903285
    or v_data #>> '{readings,0,positions,0,rateAsOf}' <> '2026-11-13' then
    raise exception 'Taux de secours non aligné sur la cotation EUR';
  end if;
  if (v_data #>> '{readings,0,positions,1,rate}')::numeric <> 7
    or v_data #>> '{readings,0,positions,1,rateSource}' <> 'manual' then
    raise exception 'Taux saisi manuellement modifié';
  end if;
  if v_data #>> '{readings,1,date}' <> '2026-10-01' or v_data #>> '{readings,1,positions}' <> '[]' then
    raise exception 'Relevé sans placement modifié';
  end if;
end $$;

-- Deuxième exécution : aucun effet supplémentaire.
\ir ../../supabase/migrations/20261114095504_remove_jeqp_london.sql
do $$
begin
  if (select count(*) from public.market_instruments where isin = 'IE000U9J8HX9') <> 1 then
    raise exception 'Migration non idempotente';
  end if;
end $$;
