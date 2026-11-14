-- Supprime les dernières traces de l'ancienne cotation JEQP en pence sterling
-- (Londres), remplacée par la même part cotée en EUR à Xetra (ISIN identique).
-- Après cette migration, la base ne conserve ni cours, ni rendement, ni statut,
-- ni instrument, ni code de relevé issus de cette place.

-- Relevés : l'ancien code redevient la cotation EUR suivie.
update public.portfolios p
set data = jsonb_set(p.data, '{readings}', coalesce((
  select jsonb_agg(
    case when rd ? 'positions' then
      jsonb_set(rd, '{positions}', coalesce((
        select jsonb_agg(
          case when pos->>'code' in ('LON:JEQP', 'JEQP.L')
            then jsonb_set(pos, '{code}', '"XETRA:JEQP"'::jsonb)
            else pos end
          order by o), '[]'::jsonb)
        from jsonb_array_elements(rd->'positions') with ordinality as t(pos, o)
      ))
    else rd end
    order by ro), '[]'::jsonb)
  from jsonb_array_elements(p.data->'readings') with ordinality as u(rd, ro)
), '[]'::jsonb))
where p.data->'readings' is not null;

-- Taux de secours : remplacer la valeur calculée sur les cours en pence par le
-- taux EUR connu, sans toucher aux taux saisis manuellement.
update public.portfolios p
set data = jsonb_set(p.data, '{readings}', coalesce((
  select jsonb_agg(
    case when rd ? 'positions' then
      jsonb_set(rd, '{positions}', coalesce((
        select jsonb_agg(
          case
            when pos->>'code' in ('IE000U9J8HX9', 'XETRA:JEQP', 'JEQP.DE')
              and coalesce(pos->>'rateSource', '') = 'market'
              then jsonb_set(jsonb_set(pos, '{rate}', to_jsonb(mr.rate)), '{rateAsOf}', to_jsonb(mr.as_of))
            else pos end
          order by o), '[]'::jsonb)
        from jsonb_array_elements(rd->'positions') with ordinality as t(pos, o)
      ))
    else rd end
    order by ro), '[]'::jsonb)
  from jsonb_array_elements(p.data->'readings') with ordinality as u(rd, ro)
), '[]'::jsonb))
from (select rate, as_of::text as as_of from public.market_returns where symbol = 'JEQP.DE') mr
where p.data->'readings' is not null;

-- Cours, rendement et statut de l'ancienne cotation, puis la ligne elle-même.
delete from public.market_prices where symbol = 'JEQP.L';
delete from public.market_returns where symbol = 'JEQP.L';
delete from public.market_sync_status where symbol = 'JEQP.L';
delete from public.market_instruments where symbol = 'JEQP.L';
