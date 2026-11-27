-- Configuration/lease checks only. All run metadata writes are rolled back.
-- Never invokes Yahoo, Push, or the portfolio comparison RPC.
begin;
do $$
declare
  token text;
  run_id uuid := gen_random_uuid();
  state text;
begin
  if has_function_privilege('anon', 'public.start_daily_market_sync(text,uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.daily_market_push(text,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.finish_daily_market_sync(uuid,integer,integer,boolean)', 'execute')
    or has_function_privilege('authenticated', 'financial_private.invoke_daily_market_sync()', 'execute')
  then raise exception 'Unexpected client privilege'; end if;
  state := financial_private.start_daily_market_sync(repeat('0',64), run_id);
  if state <> 'unauthorized' then raise exception 'Invalid token accepted'; end if;
  select decrypted_secret into strict token from vault.decrypted_secrets where name = 'daily_market_sync_token';
  state := financial_private.start_daily_market_sync(token, run_id);
  if state = 'started' then
    if financial_private.start_daily_market_sync(token, gen_random_uuid()) <> 'busy'
    then raise exception 'Concurrent lease accepted'; end if;
    perform public.finish_daily_market_sync(run_id, 1, 0, false);
    if financial_private.start_daily_market_sync(token, gen_random_uuid()) <> 'completed'
    then raise exception 'Duplicate slot run accepted'; end if;
  elsif state not in ('busy','completed') then raise exception 'Unexpected lease state';
  end if;
  if exists (
    select d from (values (date '2026-03-29'), (date '2026-10-25'),
      (date '2026-07-01'), (date '2026-11-17')) dates(d)
    cross join (values (7),(8),(12),(13)) hours(h)
    cross join (values (0),(30)) minutes(m)
    group by d having count(*) filter (
      where ((d::timestamp at time zone 'UTC' + make_interval(hours => h, mins => m))
        at time zone 'Europe/Paris')::time in (time '09:30', time '14:00')) <> 2
  ) then raise exception 'Invalid Paris daylight-saving schedule'; end if;
end;
$$;
rollback;
