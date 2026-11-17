begin;

-- La validation et les écritures restent identiques pour le cron et le bouton.
-- Extraire le corps existant sans recopier ni affaiblir ses contrôles métier.
do $$
declare
  definition text;
  token_check text := $check$  if sync_token is null or length(sync_token) < 32 or not exists (
    select 1 from public.market_sync_secrets
    where token_sha256 = encode(sha256(convert_to(sync_token, 'UTF8')), 'hex')
  ) then raise exception 'Synchronisation non autorisée' using errcode = '42501'; end if;$check$;
begin
  select pg_get_functiondef('financial_private.sync_market_instrument(text,jsonb)'::regprocedure) into definition;
  -- Les anciennes installations ont parfois une indentation différente.
  definition := regexp_replace(definition, '^[[:blank:]]+', '', 'gn');
  token_check := regexp_replace(token_check, '^[[:blank:]]+', '', 'gn');
  if position(token_check in definition) = 0 then
    raise exception 'Validation du jeton inattendue : migration interrompue';
  end if;
  definition := replace(definition,
    'financial_private.sync_market_instrument(sync_token text, payload jsonb)',
    'financial_private.publish_market_instrument(payload jsonb)');
  definition := replace(definition, token_check, '');
  execute definition;
end;
$$;
revoke all on function financial_private.publish_market_instrument(jsonb) from public, anon, authenticated;
grant usage on schema financial_private to service_role;
grant execute on function financial_private.publish_market_instrument(jsonb) to service_role;

create or replace function financial_private.sync_market_instrument(sync_token text, payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if sync_token is null or length(sync_token) < 32 or not exists (
    select 1 from public.market_sync_secrets
    where token_sha256 = encode(sha256(convert_to(sync_token, 'UTF8')), 'hex')
  ) then raise exception 'Synchronisation non autorisée' using errcode = '42501'; end if;
  perform financial_private.publish_market_instrument(payload);
end;
$$;

-- Seule l'Edge Function peut publier sans le jeton GitHub.
create function public.publish_manual_market_instrument(payload jsonb)
returns void language sql security invoker set search_path = '' as $$
  select financial_private.publish_market_instrument(payload);
$$;
revoke all on function public.publish_manual_market_instrument(jsonb) from public, anon, authenticated;
grant execute on function public.publish_manual_market_instrument(jsonb) to service_role;

create table financial_private.manual_market_sync (
  singleton boolean primary key default true check (singleton),
  next_allowed_at timestamptz not null
);
alter table financial_private.manual_market_sync enable row level security;
revoke all on financial_private.manual_market_sync from public, anon, authenticated;
grant select, insert, update on financial_private.manual_market_sync to service_role;

-- Une seule acquisition atomique, commune à tous les onglets/appareils.
create function public.try_start_manual_market_sync()
returns boolean language sql security invoker set search_path = '' as $$
  with acquired as (
    insert into financial_private.manual_market_sync(singleton, next_allowed_at)
    values (true, now() + interval '2 minutes')
    on conflict (singleton) do update set next_allowed_at = excluded.next_allowed_at
    where financial_private.manual_market_sync.next_allowed_at <= now()
    returning singleton
  ) select exists(select 1 from acquired);
$$;
revoke all on function public.try_start_manual_market_sync() from public, anon, authenticated;
grant execute on function public.try_start_manual_market_sync() to service_role;
commit;
