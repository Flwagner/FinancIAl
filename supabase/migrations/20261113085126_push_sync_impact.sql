-- After schema.sql and 001_market.sql. No service_role or financial amounts in CI.
begin;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (length(endpoint) between 20 and 4096 and endpoint ~ '^https://'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}=?$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}={0,2}$'),
  unique(user_id, endpoint)
);
create table public.portfolio_sync_impact (
  user_id uuid primary key references auth.users(id) on delete cascade,
  before_rate double precision not null check (before_rate > '-Infinity'::float8 and before_rate < 'Infinity'::float8),
  after_rate double precision not null check (after_rate > '-Infinity'::float8 and after_rate < 'Infinity'::float8),
  portfolio_updated_at timestamptz not null,
  synced_at timestamptz not null,
  partial boolean not null,
  run_id text not null check (length(run_id) between 1 and 100)
);
create table financial_private.push_sync_secrets (
  singleton boolean primary key default true check (singleton),
  token_sha256 text not null check (token_sha256 ~ '^[a-f0-9]{64}$')
);
alter table public.push_subscriptions enable row level security;
alter table public.portfolio_sync_impact enable row level security;
alter table financial_private.push_sync_secrets enable row level security;
revoke all on public.push_subscriptions, public.portfolio_sync_impact, financial_private.push_sync_secrets from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.portfolio_sync_impact to authenticated;

create policy "Owner reads subscriptions" on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) and (select financial_private.is_portfolio_owner()));
create policy "Owner creates subscriptions" on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and (select financial_private.is_portfolio_owner()));
create policy "Owner updates subscriptions" on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()) and (select financial_private.is_portfolio_owner()))
  with check (user_id = (select auth.uid()) and (select financial_private.is_portfolio_owner()));
create policy "Owner deletes subscriptions" on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()) and (select financial_private.is_portfolio_owner()));
create policy "Owner reads sync impact" on public.portfolio_sync_impact for select to authenticated
  using (user_id = (select auth.uid()) and (select financial_private.is_portfolio_owner()));

-- Machine-only capability: token check replaces auth.uid(), never grants portfolio writes.
-- Private SECURITY DEFINER implementation, public SECURITY INVOKER wrapper, as in 001.
create function financial_private.push_sync(sync_token text, operation text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_version timestamptz;
  v_synced timestamptz;
  v_count integer;
begin
  if sync_token is null or length(sync_token) < 32 or not exists (
    select 1 from financial_private.push_sync_secrets
    where token_sha256 = encode(sha256(convert_to(sync_token, 'UTF8')), 'hex')
  ) then raise exception 'Notifications non autorisées' using errcode = '42501'; end if;

  if operation = 'context' then
    return jsonb_build_object(
      'captured_at', now(),
      'market', jsonb_build_object(
        'returns', coalesce((select jsonb_agg(to_jsonb(r)) from public.market_returns r), '[]'::jsonb),
        'statuses', coalesce((select jsonb_agg(to_jsonb(s)) from public.market_sync_status s), '[]'::jsonb)),
      'portfolios', coalesce((
        select jsonb_agg(jsonb_build_object('user_id', p.user_id, 'updated_at', p.updated_at,
          'reading', jsonb_build_object('id', 'weights', 'date', '2000-01-01', 'projected', false,
            'total', 1, 'categoryRates', coalesce(r.value->'categoryRates', '{}'::jsonb),
            'positions', (
              select jsonb_agg(jsonb_build_object('id', x.n::text, 'name', '', 'envelope', '',
                'category', x.value->>'category', 'code', coalesce(x.value->>'code', ''),
                'amount', (x.value->>'amount')::numeric / t.total,
                'rate', (x.value->>'rate')::numeric, 'rateSource', x.value->>'rateSource') order by x.n)
              from jsonb_array_elements(r.value->'positions') with ordinality x(value, n)))))
        from public.portfolios p
        join public.portfolio_owner o on o.user_id = p.user_id
        cross join lateral (
          select value from jsonb_array_elements(p.data->'readings') with ordinality a(value, n)
          where jsonb_array_length(value->'positions') > 0
          order by value->>'date' desc, n desc limit 1
        ) r
        cross join lateral (
          select sum((x->>'amount')::numeric) as total from jsonb_array_elements(r.value->'positions') x
        ) t
        where t.total > 0
      ), '[]'::jsonb));
  elsif operation = 'record' then
    v_user := (payload->>'user_id')::uuid;
    v_version := (payload->>'portfolio_updated_at')::timestamptz;
    v_synced := (payload->>'synced_at')::timestamptz;
    if v_synced is null or v_synced > now() or v_synced < now() - interval '30 minutes' then
      raise exception 'Date de synchronisation invalide';
    end if;
    -- Lock the portfolio while checking its version: edits during the job invalidate the comparison.
    perform 1 from public.portfolios p join public.portfolio_owner o on o.user_id = p.user_id
      where p.user_id = v_user and p.updated_at = v_version for update of p;
    if not found then return jsonb_build_object('accepted', false, 'subscriptions', '[]'::jsonb); end if;
    insert into public.portfolio_sync_impact(user_id, before_rate, after_rate, portfolio_updated_at, synced_at, partial, run_id)
    values (v_user, (payload->>'before_rate')::float8, (payload->>'after_rate')::float8, v_version,
      v_synced, (payload->>'partial')::boolean, payload->>'run_id')
    on conflict(user_id) do update set before_rate = excluded.before_rate, after_rate = excluded.after_rate,
      portfolio_updated_at = excluded.portfolio_updated_at, synced_at = excluded.synced_at,
      partial = excluded.partial, run_id = excluded.run_id
    where public.portfolio_sync_impact.synced_at < excluded.synced_at
      and public.portfolio_sync_impact.run_id <> excluded.run_id;
    get diagnostics v_count = row_count;
    return jsonb_build_object('accepted', v_count > 0, 'subscriptions',
      case when v_count > 0 then coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'endpoint', s.endpoint, 'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth)))
        from public.push_subscriptions s where s.user_id = v_user), '[]'::jsonb) else '[]'::jsonb end);
  elsif operation = 'expire' then
    delete from public.push_subscriptions s using public.portfolio_owner o
      where s.user_id = o.user_id and s.id = (payload->>'id')::uuid;
    return '{}'::jsonb;
  end if;
  raise exception 'Opération non autorisée';
end;
$$;
revoke all on function financial_private.push_sync(text, text, jsonb) from public, anon, authenticated;
grant execute on function financial_private.push_sync(text, text, jsonb) to anon;
create function public.push_sync(sync_token text, operation text, payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select financial_private.push_sync(sync_token, operation, payload);
$$;
revoke all on function public.push_sync(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.push_sync(text, text, jsonb) to anon;
commit;

-- Configure manually (token must differ from MARKET_SYNC_TOKEN):
-- insert into financial_private.push_sync_secrets(singleton, token_sha256)
-- values(true, encode(sha256(convert_to('REPLACE_WITH_RANDOM_TOKEN', 'UTF8')), 'hex'))
-- on conflict(singleton) do update set token_sha256 = excluded.token_sha256;
