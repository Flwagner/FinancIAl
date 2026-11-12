-- Exécuter après bootstrap.sql, schema.sql et 001_market.sql en tant que postgres.
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.portfolio_owner values ('00000000-0000-0000-0000-000000000001');
insert into public.market_sync_secrets values (true, encode(sha256(convert_to('test-only-token-at-least-32-characters-long', 'UTF8')), 'hex'));

set role anon;
do $$ begin
  begin
    perform public.sync_market_instrument('wrong-token', '{"symbol":"WPEA.PA"}');
    raise exception 'TEST FAILED: invalid token accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.market_sync_secrets;
    raise exception 'TEST FAILED: anonymous secret read';
  exception when insufficient_privilege then null; end;
  begin
    update public.portfolios set updated_at = now();
    raise exception 'TEST FAILED: anonymous portfolio write';
  exception when insufficient_privilege then null; end;
end $$;

select public.sync_market_instrument('test-only-token-at-least-32-characters-long', jsonb_build_object(
  'symbol', 'WPEA.PA',
  'prices', jsonb_build_array(
    jsonb_build_object('date', current_date - 366, 'close', 100, 'adjusted_close', 100),
    jsonb_build_object('date', current_date - 1, 'close', 110, 'adjusted_close', 120)),
  'performance', jsonb_build_object('symbol', 'WPEA.PA', 'currency', 'EUR', 'method', 'adjusted_close_365d',
    'as_of', current_date - 1, 'start_date', current_date - 366, 'rate', 9999)));
select public.sync_market_instrument('test-only-token-at-least-32-characters-long', '{"symbol":"WPEA.PA","error":"HTTP 429"}');

do $$ begin
  begin
    perform public.sync_market_instrument('test-only-token-at-least-32-characters-long', '{"symbol":"UNLISTED","error":"test"}');
    raise exception 'TEST FAILED: unlisted symbol accepted';
  exception when raise_exception then
    if sqlerrm <> 'Instrument non autorisé' then raise; end if;
  end;
  begin
    perform public.sync_market_instrument('test-only-token-at-least-32-characters-long', jsonb_build_object(
      'symbol', 'WPEA.PA', 'prices', jsonb_build_array(
        jsonb_build_object('date', current_date - 366, 'close', -100, 'adjusted_close', 100),
        jsonb_build_object('date', current_date - 1, 'close', 110, 'adjusted_close', 120)),
      'performance', jsonb_build_object('symbol', 'WPEA.PA', 'currency', 'EUR', 'method', 'adjusted_close_365d',
        'as_of', current_date - 1, 'start_date', current_date - 366)));
    raise exception 'TEST FAILED: invalid price accepted';
  exception when raise_exception then
    if sqlerrm <> 'Cours invalides' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if abs((select rate from public.market_returns where symbol = 'WPEA.PA') - 20) > 0.00001 then
    raise exception 'TEST FAILED: server did not recalculate performance';
  end if;
  if (select count(*) from public.market_prices) <> 2 then raise exception 'TEST FAILED: missing prices'; end if;
  if (select error from public.market_sync_status where symbol = 'WPEA.PA') <> 'HTTP 429' then raise exception 'TEST FAILED: error not recorded'; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
do $$ begin
  if exists(select 1 from public.market_returns) then raise exception 'TEST FAILED: non-owner can read'; end if;
  begin
    insert into public.market_prices values ('WPEA.PA', current_date, 999, 999);
    raise exception 'TEST FAILED: client can write prices';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.market_sync_secrets;
    raise exception 'TEST FAILED: authenticated secret read';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
do $$ begin
  if (select count(*) from public.market_returns) <> 1 then raise exception 'TEST FAILED: owner cannot read'; end if;
end $$;
reset role;
select 'PASS: token, least privilege, RLS, server calculation, failure preservation' as result;
