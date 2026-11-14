-- JEQP : la ligne JEQP.L (Londres, GBp) est retirée de la synchronisation.
-- Son cours ajusté Yahoo ignore les distributions (~11 % par an), ce qui
-- affichait un rendement annuel faux (négatif alors que le rendement total est
-- positif). La même part (ISIN IE000U9J8HX9) est cotée en EUR à Xetra, devise
-- des ordres détenus, et son ajustement Yahoo est fiable.
-- Aucun cours n'est réattribué : les clôtures en pence restent sous 'JEQP.L'
-- pour audit, mais l'instrument devient inactif et n'est plus résolu par
-- l'application (ni synchronisé : le registre applicatif ne le liste plus).
begin;
set local lock_timeout = '5s';

-- L'ISIN est unique dans le registre : l'ancienne ligne le libère au profit de
-- la nouvelle cotation. Les montants, taux et relevés ne sont pas modifiés.
update public.market_instruments
  set active = false, isin = null
where symbol = 'JEQP.L';

insert into public.market_instruments(symbol, google_code, isin, name, currency, provider, active)
values ('JEQP.DE', 'XETRA:JEQP', 'IE000U9J8HX9', 'JPM Nasdaq Equity Premium Income UCITS Dist', 'EUR', 'yahoo', true)
on conflict (symbol) do update set
  google_code = excluded.google_code,
  isin = excluded.isin,
  name = excluded.name,
  currency = excluded.currency,
  provider = excluded.provider,
  active = excluded.active;
commit;
