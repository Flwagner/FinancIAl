-- Test autonome, uniquement dans une base PostgreSQL jetable vide.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
\ir ../../supabase/schema.sql
\ir ../../supabase/migrations/001_market.sql

insert into auth.users values ('00000000-0000-0000-0000-000000000011');
insert into public.portfolios(user_id, data) values
('00000000-0000-0000-0000-000000000011', '{"goals":{"capital":100},"readings":[
  {"id":"latest","date":"2026-11-01","projected":false,"positions":[
    {"name":"Or","code":"NYSEARCA:GLD","amount":10,"rate":8,"rateSource":"market","rateAsOf":"2026-10-31"},
    {"name":"Bitcoin","code":"BTCEUR","amount":20,"rate":5,"rateSource":"market"},
    {"name":"Obligations","category":"Obligations","code":"","amount":30,"rate":3,"rateSource":"manual"},
    {"name":"WPEA","code":"EPA:WPEA","amount":40,"rate":9,"rateSource":"market","group":"Monde"},
    {"name":"JEQP","code":"LON:JEQP","amount":50,"rate":7,"rateSource":"market"},
    {"name":"Autre","code":"CUSTOM","amount":60,"rate":6,"rateSource":"manual"}]},
  {"id":"old","date":"2026-10-01","positions":[{"name":"Or","code":"NYSEARCA:GLD","amount":5,"rate":4,"rateSource":"market"}]},
  {"id":"empty","date":"2027-01-01","positions":[],"projected":true,"total":100}
]}');
insert into public.market_prices values ('GLD', '2026-10-31', 100, 100);
insert into public.market_returns values ('GLD', '2026-10-31', '2025-10-31', 90, 100, 11.11, 'USD', 'adjusted_close_365d', now());
create temporary table before_portfolios as select * from public.portfolios;
create temporary table before_prices as select * from public.market_prices;
create temporary table before_returns as select * from public.market_returns;

\ir ../../supabase/migrations/20261113103811_correct_instrument_references.sql

do $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select data into v_before from before_portfolios;
  select data into v_after from public.portfolios;
  if v_after->'goals' is distinct from v_before->'goals'
    or v_after #> '{readings,1}' is distinct from v_before #> '{readings,1}'
    or v_after #> '{readings,2}' is distinct from v_before #> '{readings,2}' then
    raise exception 'Objectifs, archives ou projection modifiés';
  end if;
  if v_after #>> '{readings,0,positions,0,code}' <> 'FRSGE001BQW9'
    or v_after #>> '{readings,0,positions,1,code}' <> 'GB00BLD4ZL17'
    or v_after #>> '{readings,0,positions,2,code}' <> 'IE00BDBRDM35'
    or v_after #>> '{readings,0,positions,3,code}' <> 'IE0002XZSHO1'
    or v_after #>> '{readings,0,positions,4,code}' <> 'IE000U9J8HX9' then
    raise exception 'Correspondance ISIN incorrecte';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_before #> '{readings,0,positions}') with ordinality b(p, n)
    join jsonb_array_elements(v_after #> '{readings,0,positions}') with ordinality a(p, n) using(n)
    where (case when b.n = 3 then b.p - 'rateSource' else b.p end) - 'code'
      is distinct from (case when a.n = 3 then a.p - 'rateSource' else a.p end) - 'code'
  ) then raise exception 'Champ non autorisé modifié'; end if;
  if v_after #>> '{readings,0,positions,2,rateSource}' <> 'market' then
    raise exception 'Obligations pas en mode automatique';
  end if;
  if (select count(*) from public.market_instruments where isin is not null) <> 10
    or not exists (select 1 from public.market_instruments where symbol = 'JEQP.L' and isin = 'IE000U9J8HX9' and currency = 'GBp' and active and reference_symbol is null)
    or not exists (select 1 from public.market_instruments where symbol = 'GLD' and not active)
    or not exists (select 1 from public.market_instruments where symbol = 'BTC-EUR' and active and isin is null)
    or not exists (select 1 from public.market_instruments where isin = 'FRSGE001BQW9' and provider = 'unavailable' and not active and reference_symbol = 'SGLD.MI' and reference_note like 'Approximation%')
    or not exists (select 1 from public.market_instruments where isin = 'GB00BLD4ZL17' and not active and reference_symbol = 'BTC-EUR' and reference_note like 'Approximation%')
    or not exists (select 1 from public.market_instruments where symbol = 'SGLD.MI' and active and isin = 'IE00B579F325' and currency = 'EUR') then
    raise exception 'Registre incorrect';
  end if;
  if exists (select * from public.market_prices except select * from before_prices)
    or exists (select * from before_prices except select * from public.market_prices)
    or exists (select * from public.market_returns except select * from before_returns)
    or exists (select * from before_returns except select * from public.market_returns) then
    raise exception 'Cours ou rendements transférés/modifiés';
  end if;
  begin
    insert into public.market_instruments(symbol, google_code, name, currency, provider, active)
      values ('BAD', 'BAD', 'BAD', 'EUR', 'unavailable', true);
    raise exception 'Produit non couvert accepté comme actif';
  exception when check_violation then null;
  end;
  begin
    update public.market_instruments set active = true where symbol = 'BITC.PA';
    raise exception 'Produit avec référence alternative accepté en synchronisation directe';
  exception when check_violation then null;
  end;
end $$;
