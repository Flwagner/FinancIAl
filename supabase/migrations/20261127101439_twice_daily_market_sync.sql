begin;

-- Keep the existing capability check and five-minute concurrency lease.
-- A successful morning run must not suppress the afternoon refresh.
create or replace function financial_private.start_daily_market_sync(sync_token text, run_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  paris_now timestamp := now() at time zone 'Europe/Paris';
  slot_start timestamptz;
begin
  if sync_token is null or length(sync_token) <> 64 or not exists (
    select 1 from vault.decrypted_secrets where name = 'daily_market_sync_token'
    and sha256(convert_to(decrypted_secret, 'UTF8')) = sha256(convert_to(sync_token, 'UTF8'))
  ) then return 'unauthorized'; end if;
  perform pg_advisory_xact_lock(74921035);
  if exists (select 1 from financial_private.daily_market_sync_runs
    where status = 'running' and started_at > now() - interval '5 minutes')
  then return 'busy'; end if;
  slot_start := (paris_now::date + case when paris_now::time >= time '14:00'
    then time '14:00' else time '00:00' end) at time zone 'Europe/Paris';
  if exists (select 1 from financial_private.daily_market_sync_runs
    where day = paris_now::date and status = 'succeeded' and started_at >= slot_start)
  then return 'completed'; end if;
  update financial_private.daily_market_sync_runs set status = 'failed', finished_at = now()
    where status = 'running';
  insert into financial_private.daily_market_sync_runs(id, day, status)
    values(run_id, paris_now::date, 'running');
  return 'started';
end;
$$;
revoke all on function financial_private.start_daily_market_sync(text,uuid) from public, anon, authenticated;
grant execute on function financial_private.start_daily_market_sync(text,uuid) to service_role;

-- pg_cron is UTC: guard both possible summer/winter hours in Paris.
-- alter_job preserves the current active/inactive state.
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'daily-market-sync'),
  schedule := '0,30 7,8,12,13 * * *',
  command := $job$
    select financial_private.invoke_daily_market_sync()
    where ((now() at time zone 'Europe/Paris')::time >= time '09:30'
        and (now() at time zone 'Europe/Paris')::time < time '09:31')
      or ((now() at time zone 'Europe/Paris')::time >= time '14:00'
        and (now() at time zone 'Europe/Paris')::time < time '14:01');
  $job$
);

commit;
