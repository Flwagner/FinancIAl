import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Isolated Postgres only. Stub Vault/Cron; inject a clock into the real migration
// so both daily slots and daylight-saving transitions can be tested offline.
const migration = readFileSync(new URL('../supabase/migrations/20261127101439_twice_daily_market_sync.sql', import.meta.url), 'utf8')
  .replaceAll('now()', 'public.test_now()');
const sql = `
create role anon;
create role authenticated;
create role service_role;
create schema financial_private;
create schema vault;
create schema cron;
create table vault.decrypted_secrets(name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('daily_market_sync_token', repeat('a',64));
create table financial_private.daily_market_sync_runs (
  id uuid primary key, day date not null, started_at timestamptz not null,
  finished_at timestamptz, status text not null
);
create function public.test_now() returns timestamptz language sql stable as $$
  select current_setting('test.clock')::timestamptz;
$$;
alter table financial_private.daily_market_sync_runs alter started_at set default public.test_now();
create table cron.job(jobid bigint, jobname text, schedule text, command text, active boolean);
insert into cron.job values (1, 'daily-market-sync', '30 7,8 * * *', '', true);
create function cron.alter_job(job_id bigint, schedule text, command text)
returns void language sql as $$
  update cron.job set schedule = $2, command = $3 where jobid = $1;
$$;
${migration}
do $$
declare
  d date;
  run_id uuid;
  state text;
begin
  if not exists (select 1 from cron.job where active and schedule = '0,30 7,8,12,13 * * *')
  then raise exception 'Cron schedule/state not preserved'; end if;
  if has_function_privilege('anon', 'financial_private.start_daily_market_sync(text,uuid)', 'execute')
    or has_function_privilege('authenticated', 'financial_private.start_daily_market_sync(text,uuid)', 'execute')
  then raise exception 'Unexpected client privilege'; end if;
  foreach d in array array[date '2026-01-01', date '2026-03-29', date '2026-07-01', date '2026-10-25'] loop
    perform set_config('test.clock', ((d + time '09:30') at time zone 'Europe/Paris')::text, false);
    run_id := gen_random_uuid();
    if financial_private.start_daily_market_sync(repeat('0',64), run_id) <> 'unauthorized'
    then raise exception 'Invalid token accepted'; end if;
    if financial_private.start_daily_market_sync(repeat('a',64), run_id) <> 'started'
    then raise exception 'Morning run refused'; end if;
    if financial_private.start_daily_market_sync(repeat('a',64), gen_random_uuid()) <> 'busy'
    then raise exception 'Concurrent run accepted'; end if;
    update financial_private.daily_market_sync_runs set status = 'succeeded' where id = run_id;
    if financial_private.start_daily_market_sync(repeat('a',64), gen_random_uuid()) <> 'completed'
    then raise exception 'Duplicate morning accepted'; end if;
    perform set_config('test.clock', ((d + time '13:59:59') at time zone 'Europe/Paris')::text, false);
    if financial_private.start_daily_market_sync(repeat('a',64), gen_random_uuid()) <> 'completed'
    then raise exception 'Morning slot ended too soon'; end if;
    perform set_config('test.clock', ((d + time '14:00') at time zone 'Europe/Paris')::text, false);
    run_id := gen_random_uuid();
    if financial_private.start_daily_market_sync(repeat('a',64), run_id) <> 'started'
    then raise exception 'Morning success blocked afternoon'; end if;
    update financial_private.daily_market_sync_runs set status = 'partial' where id = run_id;
    run_id := gen_random_uuid();
    if financial_private.start_daily_market_sync(repeat('a',64), run_id) <> 'started'
    then raise exception 'Partial run could not retry'; end if;
    update financial_private.daily_market_sync_runs set status = 'succeeded' where id = run_id;
    if financial_private.start_daily_market_sync(repeat('a',64), gen_random_uuid()) <> 'completed'
    then raise exception 'Duplicate afternoon accepted'; end if;
  end loop;
end;
$$;
`;
const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--user', 'postgres',
  '--interactive', '--entrypoint', 'sh', 'postgres:17.6-alpine', '-c',
  'initdb -D /tmp/schedule-db -A trust > /dev/null && pg_ctl -D /tmp/schedule-db -o "-k /tmp -c listen_addresses=" -w start > /dev/null && psql -h /tmp -U postgres -v ON_ERROR_STOP=1'],
{ input: sql, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
