-- Daily baseline shared by the dashboard and Push. Existing samples seed tomorrow,
-- never pretend that an old per-job before_rate was a previous-day observation.
begin;
alter table public.portfolio_sync_impact
  add column reference_at timestamptz,
  add column portfolio_fingerprint text,
  add column reference_fingerprint text,
  add column reference_changed boolean not null default false,
  add column last_notified_rate numeric check (last_notified_rate > '-Infinity'::numeric and last_notified_rate < 'Infinity'::numeric),
  add constraint daily_reference_precedes_sample check (reference_at is null or
    (reference_at at time zone 'Europe/Paris')::date < (synced_at at time zone 'Europe/Paris')::date);

create or replace function financial_private.push_sync(sync_token text, operation text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_version timestamptz;
  v_synced timestamptz;
  v_data jsonb;
  v_fingerprint text;
  v_old public.portfolio_sync_impact%rowtype;
  v_new public.portfolio_sync_impact%rowtype;
  v_subscriptions jsonb := '[]'::jsonb;
  v_notify boolean := false;
  v_rate numeric;
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
    -- Serialize by portfolio, including first inserts and concurrent jobs.
    select p.data into v_data from public.portfolios p join public.portfolio_owner o on o.user_id = p.user_id
      where p.user_id = v_user and p.updated_at = v_version for update of p;
    if not found then return jsonb_build_object('accepted', false, 'subscriptions', '[]'::jsonb); end if;
    select encode(sha256(convert_to(jsonb_build_object('positions', r.value->'positions',
      'categoryRates', coalesce(r.value->'categoryRates', '{}'::jsonb))::text, 'UTF8')), 'hex')
      into v_fingerprint
      from jsonb_array_elements(v_data->'readings') with ordinality r(value, n)
      where jsonb_array_length(r.value->'positions') > 0
      order by r.value->>'date' desc, n desc limit 1;
    select * into v_old from public.portfolio_sync_impact where user_id = v_user for update;
    if found and (v_old.synced_at >= v_synced or v_old.run_id = payload->>'run_id') then
      return jsonb_build_object('accepted', false, 'subscriptions', '[]'::jsonb);
    end if;

    v_new.user_id := v_user;
    v_new.after_rate := (payload->>'after_rate')::float8;
    v_new.portfolio_updated_at := v_version;
    v_new.synced_at := v_synced;
    v_new.partial := (payload->>'partial')::boolean;
    v_new.run_id := payload->>'run_id';
    v_new.portfolio_fingerprint := v_fingerprint;
    v_new.last_notified_rate := v_old.last_notified_rate;
    if v_old.synced_at is not null and
      (v_old.synced_at at time zone 'Europe/Paris')::date < (v_synced at time zone 'Europe/Paris')::date then
      -- First job of the day: freeze the last observation before local midnight.
      v_new.before_rate := v_old.after_rate;
      v_new.reference_at := v_old.synced_at;
      v_new.reference_fingerprint := v_old.portfolio_fingerprint;
    else
      -- Subsequent hourly jobs preserve the same baseline (or pending initialization).
      v_new.before_rate := coalesce(v_old.before_rate, v_new.after_rate);
      v_new.reference_at := v_old.reference_at;
      v_new.reference_fingerprint := v_old.reference_fingerprint;
    end if;
    v_new.reference_changed := v_new.reference_fingerprint is not null and
      v_new.reference_fingerprint is distinct from v_fingerprint;
    select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'endpoint', s.endpoint,
      'keys', jsonb_build_object('p256dh', s.p256dh, 'auth', s.auth))), '[]'::jsonb)
      into v_subscriptions from public.push_subscriptions s where s.user_id = v_user;
    v_rate := round(v_new.after_rate::numeric, 2);
    -- Claim delivery atomically. Also notify a return to baseline after a prior alert.
    v_notify := coalesce((payload->>'notify_enabled')::boolean, false)
      and v_new.reference_at is not null and jsonb_array_length(v_subscriptions) > 0
      and v_rate is distinct from v_old.last_notified_rate
      and (v_old.last_notified_rate is not null or v_rate <> round(v_new.before_rate::numeric, 2));
    if v_notify then v_new.last_notified_rate := v_rate; end if;
    insert into public.portfolio_sync_impact select v_new.*
    on conflict(user_id) do update set
      before_rate = excluded.before_rate, after_rate = excluded.after_rate,
      portfolio_updated_at = excluded.portfolio_updated_at, synced_at = excluded.synced_at,
      partial = excluded.partial, run_id = excluded.run_id,
      reference_at = excluded.reference_at, portfolio_fingerprint = excluded.portfolio_fingerprint,
      reference_fingerprint = excluded.reference_fingerprint, reference_changed = excluded.reference_changed,
      last_notified_rate = excluded.last_notified_rate;
    return jsonb_build_object('accepted', true, 'should_notify', v_notify,
      'impact', jsonb_build_object('before_rate', v_new.before_rate, 'after_rate', v_new.after_rate,
        'synced_at', v_new.synced_at, 'portfolio_updated_at', v_new.portfolio_updated_at,
        'partial', v_new.partial, 'reference_at', v_new.reference_at, 'reference_changed', v_new.reference_changed),
      'subscriptions', case when v_notify then v_subscriptions else '[]'::jsonb end);
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
commit;
