-- Disposable PostgreSQL only, after bootstrap/schema/001_market/push migration.
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000011'), ('00000000-0000-0000-0000-000000000012');
insert into public.portfolio_owner values ('00000000-0000-0000-0000-000000000011');
insert into public.portfolios(user_id, data, updated_at) values
('00000000-0000-0000-0000-000000000011', '{"goals":{"capital":999999},"readings":[{"id":"private","date":"2026-11-01","projected":false,"positions":[{"name":"PRIVATE_NAME","category":"Actions","code":"EPA:WPEA","amount":6000,"rate":5,"rateSource":"market"},{"name":"PRIVATE_NAME","category":"SCPI","code":"","amount":4000,"rate":4,"rateSource":"manual"}],"categoryRates":{"SCPI":6}}]}', now());
insert into financial_private.push_sync_secrets values (true, encode(sha256(convert_to('push-test-only-token-at-least-32-characters', 'UTF8')), 'hex'));

set local role anon;
do $$ declare c jsonb; r jsonb; begin
  begin
    perform public.push_sync('invalid', 'context');
    raise exception 'TEST FAILED: invalid token accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.push_subscriptions;
    raise exception 'TEST FAILED: anonymous subscription read';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.portfolio_sync_impact;
    raise exception 'TEST FAILED: anonymous summary read';
  exception when insufficient_privilege then null; end;
  begin
    perform * from financial_private.push_sync_secrets;
    raise exception 'TEST FAILED: token readable';
  exception when insufficient_privilege then null; end;
  c := public.push_sync('push-test-only-token-at-least-32-characters', 'context');
  if c::text like '%PRIVATE_NAME%' or c::text like '%999999%' then
    raise exception 'TEST FAILED: private portfolio data leaked';
  end if;
  select value->'reading' into r from jsonb_array_elements(c->'portfolios') where value->>'user_id' = '00000000-0000-0000-0000-000000000011';
  if (r->>'total')::numeric <> 1 or (r->'positions'->0->>'amount')::numeric <> 0.6 then raise exception 'TEST FAILED: invalid weights'; end if;
  -- Client cannot use the capability to write a portfolio or unknown operation.
  begin
    perform public.push_sync('push-test-only-token-at-least-32-characters', 'write_portfolio');
    raise exception 'TEST FAILED: arbitrary operation accepted';
  exception when raise_exception then if sqlerrm <> 'Opération non autorisée' then raise; end if; end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values
('00000000-0000-0000-0000-000000000011', 'https://fcm.googleapis.com/test', repeat('a',87), repeat('a',22));
do $$ begin
  if (select count(*) from public.push_subscriptions) <> 1 then raise exception 'TEST FAILED: owner cannot read subscription'; end if;
  update public.push_subscriptions set auth = repeat('b',22);
  if (select auth from public.push_subscriptions) <> repeat('b',22) then raise exception 'TEST FAILED: owner cannot update'; end if;
  begin
    update public.push_subscriptions set user_id = '00000000-0000-0000-0000-000000000012';
    raise exception 'TEST FAILED: ownership can be transferred';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.portfolio_sync_impact values ('00000000-0000-0000-0000-000000000011', 1, 2, now(), now(), false, 'forged');
    raise exception 'TEST FAILED: owner can forge summary';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', true);
do $$ declare n integer; begin
  if exists(select 1 from public.push_subscriptions) then raise exception 'TEST FAILED: stranger can read subscriptions'; end if;
  update public.push_subscriptions set auth = repeat('c',22);
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TEST FAILED: stranger can update'; end if;
  delete from public.push_subscriptions;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'TEST FAILED: stranger can delete'; end if;
  begin
    insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values
    ('00000000-0000-0000-0000-000000000011','https://fcm.googleapis.com/stolen',repeat('a',87),repeat('a',22));
    raise exception 'TEST FAILED: stranger can create subscription';
  exception when insufficient_privilege then null; end;
end $$;

set local role anon;
do $$ declare c jsonb; p jsonb; r jsonb; begin
  c := public.push_sync('push-test-only-token-at-least-32-characters','context');
  select value into p from jsonb_array_elements(c->'portfolios') where value->>'user_id' = '00000000-0000-0000-0000-000000000011';
  p := jsonb_build_object('user_id',p->>'user_id','portfolio_updated_at',p->>'updated_at','synced_at',c->>'captured_at','before_rate',8.4,'after_rate',9.6,'partial',true,'run_id','test-run');
  r := public.push_sync('push-test-only-token-at-least-32-characters','record',p);
  if not (r->>'accepted')::boolean or jsonb_array_length(r->'subscriptions') <> 1 then raise exception 'TEST FAILED: comparison not recorded'; end if;
  if r->'subscriptions'->0->'keys'->>'auth' <> repeat('b',22) then raise exception 'TEST FAILED: subscription changed by stranger'; end if;
  if (public.push_sync('push-test-only-token-at-least-32-characters','record',p)->>'accepted')::boolean then raise exception 'TEST FAILED: duplicate accepted'; end if;
  if (public.push_sync('push-test-only-token-at-least-32-characters','record',p || '{"run_id":"other","portfolio_updated_at":"2000-01-01"}') ->>'accepted')::boolean then raise exception 'TEST FAILED: stale portfolio accepted'; end if;
  perform public.push_sync('push-test-only-token-at-least-32-characters','expire',jsonb_build_object('id',r->'subscriptions'->0->>'id'));
end $$;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.portfolio_sync_impact) then raise exception 'TEST FAILED: stranger can read summary'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000011', true);
do $$ begin
  if (select after_rate from public.portfolio_sync_impact) <> 9.6 then raise exception 'TEST FAILED: missing owner summary'; end if;
  if exists(select 1 from public.push_subscriptions) then raise exception 'TEST FAILED: expired subscription not deleted'; end if;
end $$;
reset role;
rollback;
select 'PASS: push capability, weights privacy, RLS, versioning, deduplication, expiration' as result;
