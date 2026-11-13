-- À relire puis appliquer avec le nouveau registre applicatif. Aucun cours de proxy
-- n'est transféré au produit réel ; anciens cours/relevés conservés pour audit.
begin;
set local lock_timeout = '5s';

alter table public.market_instruments add column isin text
  check (isin is null or isin ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$');
create unique index market_instruments_isin_key on public.market_instruments(isin)
  where isin is not null;
alter table public.market_instruments drop constraint market_instruments_provider_check;
alter table public.market_instruments add constraint market_instruments_provider_check
  check (provider in ('yahoo', 'unavailable'));
alter table public.market_instruments add constraint market_instruments_unavailable_inactive
  check (provider <> 'unavailable' or not active);
alter table public.market_instruments
  add column reference_symbol text references public.market_instruments(symbol),
  add column reference_note text,
  add constraint market_instruments_reference_check check (
    (reference_symbol is null and reference_note is null)
    or (reference_symbol is not null and reference_note is not null
      and length(btrim(reference_note)) > 0 and reference_symbol <> symbol and not active)
  );
create index market_instruments_reference_symbol_idx on public.market_instruments(reference_symbol)
  where reference_symbol is not null;

update public.market_instruments i set isin = refs.isin
from (values
  ('WPEA.PA', 'IE0002XZSHO1'), ('DCAM.PA', 'FR001400U5Q4'),
  ('PCEU.PA', 'FR0013412038'), ('PAEEM.PA', 'FR0013412020'),
  ('PAASI.PA', 'FR0013412012'), ('JEQP.L', 'IE000U9J8HX9')
) as refs(symbol, isin) where i.symbol = refs.symbol;

-- GLD (USD) n'est plus utilisé. BTC-EUR reste une référence spot explicite,
-- jamais renommée en CoinShares : aucun historique n'est réattribué.
update public.market_instruments set active = false where symbol = 'GLD';
update public.market_instruments set active = true where symbol = 'BTC-EUR';
insert into public.market_instruments(symbol, google_code, isin, name, currency, provider, active) values
  ('AGGH.MI', 'BIT:AGGH', 'IE00BDBRDM35', 'iShares Core Global Aggregate Bond EUR Hedged Acc', 'EUR', 'yahoo', true),
  ('SGLD.MI', 'BIT:SGLD', 'IE00B579F325', 'Invesco Physical Gold ETC', 'EUR', 'yahoo', true),
  ('BITC.PA', 'EPA:BITC', 'GB00BLD4ZL17', 'CoinShares Bitcoin ETP', 'EUR', 'yahoo', false),
  ('FRSGE001BQW9', 'FRSGE001BQW9', 'FRSGE001BQW9', 'GOLD/SGE OPEN', 'EUR', 'unavailable', false);
update public.market_instruments set reference_symbol = 'BTC-EUR',
  reference_note = 'Approximation par le bitcoin spot en euros : hors frais, suivi et horaires propres à CoinShares. Historique annuel BITC.PA inexploitable sur Yahoo.'
where symbol = 'BITC.PA';
update public.market_instruments set reference_symbol = 'SGLD.MI',
  reference_note = 'Approximation par Invesco Physical Gold ETC coté en euros : produit différent de GOLD/SGE OPEN, frais et mécanismes Société Générale non reproduits.'
where symbol = 'FRSGE001BQW9';

-- Correction ciblée du dernier relevé détaillé de chaque propriétaire seulement.
-- L'ordre, les montants, les taux et les autres champs sont préservés, sauf le
-- mode AGGH explicitement passé en marché. « Obligations » est le nom constaté.
with latest as (
  select p.user_id, s.reading, s.ordinality
  from public.portfolios p
  cross join lateral (
    select r.reading, r.ordinality
    from jsonb_array_elements(p.data->'readings') with ordinality as r(reading, ordinality)
    where jsonb_array_length(r.reading->'positions') > 0
    order by r.reading->>'date' desc, r.ordinality desc limit 1
  ) s
), corrected as (
  select l.user_id, l.ordinality,
    jsonb_agg(case
      when upper(btrim(p.position->>'code')) in ('IE00BDBRDM35', 'BIT:AGGH', 'AGGH.MI')
        or (p.position->>'name' = 'Obligations' and p.position->>'category' = 'Obligations'
          and coalesce(p.position->>'code', '') = '')
        then p.position || '{"code":"IE00BDBRDM35","rateSource":"market"}'::jsonb
      when refs.isin is not null then jsonb_set(p.position, '{code}', to_jsonb(refs.isin))
      else p.position end order by p.ordinality) as positions
  from latest l
  cross join lateral jsonb_array_elements(l.reading->'positions') with ordinality as p(position, ordinality)
  left join (values
    ('EPA:WPEA', 'IE0002XZSHO1'), ('WPEA.PA', 'IE0002XZSHO1'),
    ('EPA:DCAM', 'FR001400U5Q4'), ('DCAM.PA', 'FR001400U5Q4'),
    ('EPA:PCEU', 'FR0013412038'), ('PCEU.PA', 'FR0013412038'),
    ('EPA:PAEEM', 'FR0013412020'), ('PAEEM.PA', 'FR0013412020'),
    ('EPA:PAASI', 'FR0013412012'), ('PAASI.PA', 'FR0013412012'),
    ('LON:JEQP', 'IE000U9J8HX9'), ('JEQP.L', 'IE000U9J8HX9'),
    ('NYSEARCA:GLD', 'FRSGE001BQW9'), ('GLD', 'FRSGE001BQW9'),
    ('BTCEUR', 'GB00BLD4ZL17'), ('BTC-EUR', 'GB00BLD4ZL17'),
    ('EPA:BITC', 'GB00BLD4ZL17'), ('BITC.PA', 'GB00BLD4ZL17'),
    ('BIT:AGGH', 'IE00BDBRDM35'), ('AGGH.MI', 'IE00BDBRDM35')
  ) as refs(code, isin) on upper(btrim(p.position->>'code')) = refs.code
  group by l.user_id, l.ordinality
)
update public.portfolios p
set data = jsonb_set(p.data, array['readings', (c.ordinality - 1)::text, 'positions'], c.positions),
    updated_at = now()
from corrected c where p.user_id = c.user_id
  and p.data #> array['readings', (c.ordinality - 1)::text, 'positions'] is distinct from c.positions;

commit;
