begin;
do $$ begin
  if has_function_privilege('anon', 'public.publish_manual_market_instrument(jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.publish_manual_market_instrument(jsonb)', 'execute')
    or has_function_privilege('authenticated', 'public.try_start_manual_market_sync()', 'execute')
    or has_function_privilege('anon', 'financial_private.publish_market_instrument(jsonb)', 'execute')
    or not has_function_privilege('service_role', 'public.publish_manual_market_instrument(jsonb)', 'execute')
  then raise exception 'Privilèges de synchronisation incorrects'; end if;
end $$;

set local role service_role;
do $$ begin
  if not public.try_start_manual_market_sync() then raise exception 'Premier lancement refusé'; end if;
  if public.try_start_manual_market_sync() then raise exception 'Double lancement autorisé'; end if;
end $$;
select public.publish_manual_market_instrument(jsonb_build_object(
  'symbol','WPEA.PA','prices',jsonb_build_array(
    jsonb_build_object('date',current_date - 366,'close',100,'adjusted_close',100),
    jsonb_build_object('date',current_date - 1,'close',110,'adjusted_close',110)
  ),'performance',jsonb_build_object(
    'symbol','WPEA.PA','currency','EUR','method','adjusted_close_365d',
    'as_of',current_date - 1,'start_date',current_date - 366,'rate',99999
  )
));
reset role;
do $$ begin
  if (select rate from public.market_returns where symbol='WPEA.PA') <> 10 then
    raise exception 'Le taux doit être recalculé par SQL'; end if;
  begin
    perform public.sync_market_instrument(null, '{}'::jsonb);
    raise exception 'Un jeton nul doit rester interdit au cron';
  exception when insufficient_privilege then null;
  end;
end $$;
insert into public.market_sync_secrets values(true, encode(sha256(convert_to(repeat('x',32),'UTF8')),'hex'));
set local role anon;
select public.sync_market_instrument(repeat('x',32), '{"symbol":"WPEA.PA","error":"Test local"}'::jsonb);
reset role;
do $$ begin
  if (select rate from public.market_returns where symbol='WPEA.PA') <> 10 then
    raise exception 'Un échec ne doit jamais effacer le dernier taux valide'; end if;
end $$;
rollback;
