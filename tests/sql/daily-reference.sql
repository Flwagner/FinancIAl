-- Disposable PostgreSQL only, after all migrations. No real notifications.
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000021');
insert into public.portfolio_owner values ('00000000-0000-0000-0000-000000000021');
insert into public.portfolios(user_id, data) values ('00000000-0000-0000-0000-000000000021',
  '{"goals":{"monthly":4000},"readings":[{"date":"2026-11-01","positions":[{"amount":1000,"rate":9.52,"category":"Actions","code":"","rateSource":"manual"}]}]}');
insert into financial_private.push_sync_secrets values (true, encode(sha256(convert_to('daily-test-only-token-at-least-32-characters', 'UTF8')), 'hex'))
on conflict(singleton) do update set token_sha256 = excluded.token_sha256;
insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values
('00000000-0000-0000-0000-000000000021', 'https://fcm.googleapis.com/test', repeat('a',87), repeat('a',22));

do $$
declare
  p jsonb;
  r jsonb;
  v_time timestamptz := now() - interval '10 minutes';
  v_reference timestamptz;
begin
  p := jsonb_build_object('user_id', '00000000-0000-0000-0000-000000000021',
    'portfolio_updated_at', (select updated_at from public.portfolios where user_id = '00000000-0000-0000-0000-000000000021'),
    'synced_at', v_time, 'run_id', 'init', 'after_rate', 9.52, 'partial', false, 'notify_enabled', true);
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p);
  if not (r->>'accepted')::boolean or r->'impact'->>'reference_at' is not null or (r->>'should_notify')::boolean then
    raise exception 'TEST FAILED: invented daily baseline on initialization';
  end if;
  -- Place this initial observation just before Paris midnight (or a skipped weekend).
  v_reference := (date_trunc('day', v_time at time zone 'Europe/Paris') at time zone 'Europe/Paris') - interval '1 second';
  update public.portfolio_sync_impact set synced_at = v_reference where user_id = (p->>'user_id')::uuid;
  p := p || jsonb_build_object('run_id', 'morning', 'synced_at', v_time + interval '1 second', 'after_rate', 9.43, 'before_rate', 999);
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p);
  if (r->'impact'->>'before_rate')::numeric <> 9.52 or (r->'impact'->>'reference_at')::timestamptz <> v_reference
    or not (r->>'should_notify')::boolean then raise exception 'TEST FAILED: missing previous-day baseline'; end if;
  if (r->'impact'->>'reference_changed')::boolean then raise exception 'TEST FAILED: unchanged holdings marked modified'; end if;
  -- Same day: an hourly job cannot reset the baseline or resend an identical displayed rate.
  p := p || jsonb_build_object('run_id', 'same', 'synced_at', v_time + interval '2 seconds', 'after_rate', 9.431);
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p);
  if (r->'impact'->>'before_rate')::numeric <> 9.52 or (r->>'should_notify')::boolean then raise exception 'TEST FAILED: hourly reset or duplicate alert'; end if;
  p := p || jsonb_build_object('run_id', 'afternoon', 'synced_at', v_time + interval '3 seconds', 'after_rate', 9.48);
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p);
  if (r->'impact'->>'before_rate')::numeric <> 9.52 or not (r->>'should_notify')::boolean then raise exception 'TEST FAILED: afternoon delta is not daily'; end if;
  -- Returning to the daily baseline is a meaningful update, not a duplicate.
  p := p || jsonb_build_object('run_id', 'back-to-zero', 'synced_at', v_time + interval '4 seconds', 'after_rate', 9.52);
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p);
  if not (r->>'should_notify')::boolean then raise exception 'TEST FAILED: return to baseline hidden'; end if;
  if (public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p)->>'accepted')::boolean then raise exception 'TEST FAILED: duplicate run accepted'; end if;
  -- Saving goals changes the version but not the fingerprint of the holdings.
  update public.portfolios set data = jsonb_set(data, '{goals,monthly}', '5000'), updated_at = now()
    where user_id = (p->>'user_id')::uuid;
  p := p || jsonb_build_object('portfolio_updated_at', now(), 'run_id', 'goals-only', 'synced_at', v_time + interval '5 seconds');
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p);
  if (r->'impact'->>'reference_changed')::boolean then raise exception 'TEST FAILED: goals mistaken for holdings'; end if;
  -- Actual holdings modification remains compared to the fixed baseline, with a warning.
  update public.portfolios set data = jsonb_set(data, '{readings,0,positions,0,amount}', '2000')
    where user_id = (p->>'user_id')::uuid;
  p := p || jsonb_build_object('run_id', 'holdings', 'synced_at', v_time + interval '6 seconds', 'after_rate', 9.6, 'partial', true);
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p);
  if not (r->'impact'->>'reference_changed')::boolean or not (r->'impact'->>'partial')::boolean
    or (r->'impact'->>'before_rate')::numeric <> 9.52 then raise exception 'TEST FAILED: changed holdings not identified'; end if;
  -- No Push configured: save comparison but do not advance notification deduplication.
  p := p || jsonb_build_object('run_id', 'no-push', 'synced_at', v_time + interval '7 seconds', 'after_rate', 9.7, 'notify_enabled', false);
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p);
  if (r->>'should_notify')::boolean then raise exception 'TEST FAILED: unconfigured Push claimed'; end if;
  p := p || jsonb_build_object('run_id', 'push-restored', 'synced_at', v_time + interval '8 seconds', 'notify_enabled', true);
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p);
  if not (r->>'should_notify')::boolean then raise exception 'TEST FAILED: unsent update incorrectly deduplicated'; end if;
  -- Simulate a missed day: the latest known prior sample still becomes the next baseline.
  update public.portfolio_sync_impact set reference_at = reference_at - interval '3 days', synced_at = synced_at - interval '2 days'
    where user_id = (p->>'user_id')::uuid;
  p := p || jsonb_build_object('run_id', 'after-gap', 'synced_at', v_time + interval '9 seconds', 'after_rate', 9.8);
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p);
  if (r->'impact'->>'before_rate')::numeric <> 9.7 or (r->'impact'->>'reference_changed')::boolean then raise exception 'TEST FAILED: baseline not rolled after skipped day'; end if;
  -- Une projection datée plus tard ne remplace jamais le dernier relevé réel,
  -- ni pour les pondérations du job, ni pour l'empreinte des placements.
  update public.portfolios p set data = jsonb_set(p.data, '{readings}',
      (p.data->'readings') || jsonb_build_array(jsonb_build_object(
        'id', 'projection', 'date', '2099-01-01', 'projected', true, 'total', 3000,
        'positions', jsonb_build_array(jsonb_build_object('id', 'p', 'name', '', 'envelope', '',
          'category', 'Actions', 'code', '', 'amount', 3000, 'rate', 30, 'rateSource', 'manual'))))),
    updated_at = now()
    where user_id = (p->>'user_id')::uuid;
  p := p || jsonb_build_object('run_id', 'projection', 'synced_at', v_time + interval '10 seconds', 'after_rate', 9.9, 'portfolio_updated_at', now());
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'record', p);
  if (r->'impact'->>'reference_changed')::boolean then raise exception 'TEST FAILED: projection mistaken for holdings change'; end if;
  r := public.push_sync('daily-test-only-token-at-least-32-characters', 'context');
  if jsonb_array_length(r->'portfolios') <> 1
    or (r->'portfolios'->0->'reading'->'positions'->0->>'rate')::numeric <> 9.52
    or (r->'portfolios'->0->'reading'->'positions'->0->>'amount')::numeric <> 1 then
    raise exception 'TEST FAILED: projected reading used as comparison base';
  end if;
  if (timestamptz '2026-07-12 22:00:00+00' at time zone 'Europe/Paris')::date <> date '2026-07-13'
    or (timestamptz '2026-11-12 23:00:00+00' at time zone 'Europe/Paris')::date <> date '2026-11-13' then raise exception 'TEST FAILED: Paris midnight'; end if;
end $$;
rollback;
select 'PASS: daily baseline, hourly jobs, initialization, notification deduplication, goals, holdings, gaps, Paris time' as result;
