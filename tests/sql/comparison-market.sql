-- PostgreSQL jetable exclusivement.
begin;
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000031');
insert into public.portfolio_owner values ('00000000-0000-0000-0000-000000000031');
insert into public.market_returns(symbol,as_of,start_date,start_price,end_price,rate,currency,method)
values ('WPEA.PA','2026-11-12','2025-11-12',100,110,10,'EUR','adjusted_close_365d');
insert into public.portfolio_sync_impact(user_id,before_rate,after_rate,portfolio_updated_at,synced_at,partial,run_id)
values ('00000000-0000-0000-0000-000000000031',8.4,8.4,now(),'2026-11-12T20:00:00Z',false,'init');
do $$ begin
 assert (select reference_market is null from public.portfolio_sync_impact);
 assert (select (market_snapshot->'returns'->0->>'rate')::numeric=10 from public.portfolio_sync_impact);
 assert (select not (market_snapshot ? 'positions') from public.portfolio_sync_impact);
end $$;
update public.market_returns set rate=12;
-- Même forme d'upsert que la RPC : le trigger UPDATE doit garder la référence.
insert into public.portfolio_sync_impact(user_id,before_rate,after_rate,portfolio_updated_at,synced_at,reference_at,partial,run_id)
values ('00000000-0000-0000-0000-000000000031',8.4,9.6,now(),'2026-11-13T09:30:00Z','2026-11-12T20:00:00Z',false,'next')
on conflict(user_id) do update set before_rate=excluded.before_rate,after_rate=excluded.after_rate,
synced_at=excluded.synced_at,reference_at=excluded.reference_at,run_id=excluded.run_id;
do $$ begin
 assert (select (reference_market->'returns'->0->>'rate')::numeric=10 from public.portfolio_sync_impact);
 assert (select (reference_market->>'captured_at')::timestamptz=reference_at from public.portfolio_sync_impact);
 assert (select (market_snapshot->'returns'->0->>'rate')::numeric=12 from public.portfolio_sync_impact);
end $$;
update public.market_returns set rate=14;
update public.portfolio_sync_impact set synced_at='2026-11-13T11:00:00Z',after_rate=10.8;
do $$ begin
 assert (select (reference_market->'returns'->0->>'rate')::numeric=10 from public.portfolio_sync_impact);
 assert (select (market_snapshot->'returns'->0->>'rate')::numeric=14 from public.portfolio_sync_impact);
end $$;
-- Un jour sauté : dernière observation connue, pas les cours du jour courant.
update public.market_returns set rate=16;
update public.portfolio_sync_impact set synced_at='2026-11-16T09:30:00Z',reference_at='2026-11-13T11:00:00Z';
do $$ begin
 assert (select (reference_market->'returns'->0->>'rate')::numeric=14 from public.portfolio_sync_impact);
 assert (select (reference_market->>'captured_at')::timestamptz=reference_at from public.portfolio_sync_impact);
 assert not has_table_privilege('authenticated','public.portfolio_sync_impact','update');
 assert not has_table_privilege('anon','public.portfolio_sync_impact','select');
 assert not has_function_privilege('anon','financial_private.capture_comparison_market()','execute');
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000031';
set local role authenticated;
do $$ begin assert (select count(*)=1 from public.portfolio_sync_impact); end $$;
reset role;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000032';
set local role authenticated;
do $$ begin assert (select count(*)=0 from public.portfolio_sync_impact); end $$;
reset role;
rollback;
\echo 'Comparison market snapshots: initialization, upsert, frozen reference, rollover, skipped days and RLS OK'
