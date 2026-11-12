-- À exécuter APRÈS supabase/schema.sql. Ne contient ni positions ni montants privés.
begin;

create table public.market_instruments (
  symbol text primary key,
  google_code text not null unique,
  name text not null,
  currency text not null,
  provider text not null default 'yahoo' check (provider = 'yahoo'),
  active boolean not null default true
);
insert into public.market_instruments(symbol, google_code, name, currency) values
  ('WPEA.PA', 'EPA:WPEA', 'iShares MSCI World Swap PEA', 'EUR'),
  ('DCAM.PA', 'EPA:DCAM', 'Amundi PEA Monde', 'EUR'),
  ('PCEU.PA', 'EPA:PCEU', 'Amundi PEA MSCI Europe', 'EUR'),
  ('PAEEM.PA', 'EPA:PAEEM', 'Amundi PEA Émergent', 'EUR'),
  ('PAASI.PA', 'EPA:PAASI', 'Amundi PEA Asie Émergente', 'EUR'),
  ('JEQP.L', 'LON:JEQP', 'JPM Nasdaq Equity Premium Income UCITS Dist', 'GBp'),
  ('GLD', 'NYSEARCA:GLD', 'SPDR Gold Shares', 'USD'),
  ('BTC-EUR', 'BTCEUR', 'Bitcoin / euro', 'EUR');

create table public.market_prices (
  symbol text not null references public.market_instruments(symbol),
  date date not null,
  close numeric not null check (close > 0 and close < 'Infinity'::numeric),
  adjusted_close numeric not null check (adjusted_close > 0 and adjusted_close < 'Infinity'::numeric),
  primary key(symbol, date)
);
create table public.market_returns (
  symbol text primary key references public.market_instruments(symbol),
  as_of date not null,
  start_date date not null check (start_date < as_of),
  start_price numeric not null check (start_price > 0 and start_price < 'Infinity'::numeric),
  end_price numeric not null check (end_price > 0 and end_price < 'Infinity'::numeric),
  rate numeric not null check (rate > '-Infinity'::numeric and rate < 'Infinity'::numeric),
  currency text not null,
  method text not null check (method = 'adjusted_close_365d'),
  fetched_at timestamptz not null default now()
);
create table public.market_sync_status (
  symbol text primary key references public.market_instruments(symbol),
  last_attempt_at timestamptz not null default now(),
  error text
);
create table public.market_sync_secrets (
  singleton boolean primary key default true check (singleton),
  token_sha256 text not null check (length(token_sha256) = 64)
);

alter table public.market_instruments enable row level security;
alter table public.market_prices enable row level security;
alter table public.market_returns enable row level security;
alter table public.market_sync_status enable row level security;
alter table public.market_sync_secrets enable row level security;
revoke all on public.market_instruments, public.market_prices, public.market_returns,
  public.market_sync_status, public.market_sync_secrets from anon, authenticated;
grant select on public.market_instruments, public.market_prices, public.market_returns,
  public.market_sync_status to authenticated;
create policy "Owner reads instruments" on public.market_instruments for select to authenticated using ((select financial_private.is_portfolio_owner()));
create policy "Owner reads prices" on public.market_prices for select to authenticated using ((select financial_private.is_portfolio_owner()));
create policy "Owner reads returns" on public.market_returns for select to authenticated using ((select financial_private.is_portfolio_owner()));
create policy "Owner reads sync status" on public.market_sync_status for select to authenticated using ((select financial_private.is_portfolio_owner()));

-- Capacité d'écriture limitée aux cours. PAS de service_role dans GitHub Actions.
-- Le jeton brut n'est jamais stocké en base ; générer au moins 32 octets aléatoires.
create function financial_private.sync_market_instrument(sync_token text, payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_symbol text;
  v_currency text;
  v_result jsonb;
  v_as_of date;
  v_start date;
  v_start_price numeric;
  v_end_price numeric;
  v_count integer;
begin
  if sync_token is null or length(sync_token) < 32 or not exists (
    select 1 from public.market_sync_secrets
    where token_sha256 = encode(sha256(convert_to(sync_token, 'UTF8')), 'hex')
  ) then raise exception 'Synchronisation non autorisée' using errcode = '42501'; end if;

  v_symbol := payload->>'symbol';
  select currency into v_currency from public.market_instruments where symbol = v_symbol and active;
  if not found then raise exception 'Instrument non autorisé'; end if;

  if payload ? 'error' then
    insert into public.market_sync_status(symbol, error) values (v_symbol, left(payload->>'error', 500))
    on conflict(symbol) do update set last_attempt_at = now(), error = excluded.error;
    return;
  end if;

  if jsonb_typeof(payload->'prices') <> 'array' then raise exception 'Cours attendus'; end if;
  v_count := jsonb_array_length(payload->'prices');
  if v_count is null or v_count < 2 or v_count > 1000 then raise exception 'Nombre de cours invalide'; end if;
  v_result := payload->'performance';
  if v_result->>'symbol' is distinct from v_symbol or v_result->>'currency' is distinct from v_currency
     or v_result->>'method' is distinct from 'adjusted_close_365d' then raise exception 'Méthode ou devise invalide'; end if;
  v_as_of := (v_result->>'as_of')::date;
  v_start := (v_result->>'start_date')::date;
  if v_as_of is null or v_start is null or v_as_of >= (now() at time zone 'UTC')::date
     or v_as_of < (now() at time zone 'UTC')::date - 7
     or v_as_of - v_start not between 358 and 365 then raise exception 'Période invalide'; end if;

  if exists(select 1 from public.market_returns where symbol = v_symbol and as_of > v_as_of) then
    raise exception 'Une synchronisation ancienne ne peut pas remplacer une plus récente';
  end if;
  if exists(select 1 from jsonb_array_elements(payload->'prices') p
    where (p->>'date') is null or (p->>'date')::date > v_as_of
      or (p->>'close') is null or (p->>'adjusted_close') is null
      or (p->>'close')::numeric <= 0 or (p->>'adjusted_close')::numeric <= 0
      or (p->>'close') in ('NaN', 'Infinity', '-Infinity')
      or (p->>'adjusted_close') in ('NaN', 'Infinity', '-Infinity')) then raise exception 'Cours invalides'; end if;

  select (p->>'adjusted_close')::numeric into v_start_price
    from jsonb_array_elements(payload->'prices') p where (p->>'date')::date = v_start;
  select (p->>'adjusted_close')::numeric into v_end_price
    from jsonb_array_elements(payload->'prices') p where (p->>'date')::date = v_as_of;
  if v_start_price is null or v_end_price is null then raise exception 'Clôtures de référence absentes'; end if;

  insert into public.market_prices(symbol, date, close, adjusted_close)
    select v_symbol, (p->>'date')::date, (p->>'close')::numeric, (p->>'adjusted_close')::numeric
    from jsonb_array_elements(payload->'prices') p
    on conflict(symbol, date) do update set close = excluded.close, adjusted_close = excluded.adjusted_close;
  -- Recalcul en SQL : ne pas faire confiance au taux envoyé par le client.
  insert into public.market_returns(symbol, as_of, start_date, start_price, end_price, rate, currency, method)
    values(v_symbol, v_as_of, v_start, v_start_price, v_end_price, (v_end_price / v_start_price - 1) * 100, v_currency, 'adjusted_close_365d')
    on conflict(symbol) do update set as_of = excluded.as_of, start_date = excluded.start_date,
      start_price = excluded.start_price, end_price = excluded.end_price, rate = excluded.rate,
      currency = excluded.currency, method = excluded.method, fetched_at = now();
  insert into public.market_sync_status(symbol, error) values(v_symbol, null)
    on conflict(symbol) do update set last_attempt_at = now(), error = null;
end;
$$;
revoke all on function financial_private.sync_market_instrument(text, jsonb) from public, anon, authenticated;
grant execute on function financial_private.sync_market_instrument(text, jsonb) to anon;
-- Surface REST minimale : seul un wrapper non privilégié est exposé.
create function public.sync_market_instrument(sync_token text, payload jsonb)
returns void language sql security invoker set search_path = '' as $$
  select financial_private.sync_market_instrument(sync_token, payload);
$$;
revoke all on function public.sync_market_instrument(text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_market_instrument(text, jsonb) to anon;
commit;

-- Configuration MANUELLE après génération d'un jeton hors du dépôt :
-- insert into public.market_sync_secrets(singleton, token_sha256)
-- values(true, encode(sha256(convert_to('REMPLACER_PAR_LE_JETON_ALEATOIRE', 'UTF8')), 'hex'))
-- on conflict(singleton) do update set token_sha256 = excluded.token_sha256;
-- Enregistrer le même jeton dans le secret GitHub MARKET_SYNC_TOKEN.
