begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Generated in the database, never returned in SQL results or committed to Git.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'daily_market_sync_token');

create table financial_private.daily_market_sync_runs (
  id uuid primary key,
  day date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null check (status in ('running', 'succeeded', 'partial', 'failed')),
  succeeded integer not null default 0,
  failed integer not null default 0,
  push_failed boolean not null default false
);
create index daily_market_sync_runs_started on financial_private.daily_market_sync_runs(started_at desc);
alter table financial_private.daily_market_sync_runs enable row level security;
revoke all on financial_private.daily_market_sync_runs from public, anon, authenticated;
grant select, insert, update on financial_private.daily_market_sync_runs to service_role;

-- Reuse the latest installed comparison logic, including its business checks.
-- The original token-protected entrypoint remains unchanged for the local CLI.
do $$
declare
  definition text;
  token_check text := $check$  if sync_token is null or length(sync_token) < 32 or not exists (
    select 1 from financial_private.push_sync_secrets
    where token_sha256 = encode(sha256(convert_to(sync_token, 'UTF8')), 'hex')
  ) then raise exception 'Notifications non autorisées' using errcode = '42501'; end if;$check$;
begin
  select pg_get_functiondef('financial_private.push_sync(text,text,jsonb)'::regprocedure) into definition;
  definition := regexp_replace(definition, '^[[:blank:]]+', '', 'gn');
  token_check := regexp_replace(token_check, '^[[:blank:]]+', '', 'gn');
  if position(token_check in definition) = 0 then
    raise exception 'Validation du jeton Push inattendue';
  end if;
  definition := replace(definition,
    'financial_private.push_sync(sync_token text, operation text, payload jsonb)',
    'financial_private.daily_market_push(operation text, payload jsonb)');
  execute replace(definition, token_check, '');
end;
$$;
revoke all on function financial_private.daily_market_push(text,jsonb) from public, anon, authenticated;
grant execute on function financial_private.daily_market_push(text,jsonb) to service_role;
create function public.daily_market_push(operation text, payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select financial_private.daily_market_push(operation, payload);
$$;
revoke all on function public.daily_market_push(text,jsonb) from public, anon, authenticated;
grant execute on function public.daily_market_push(text,jsonb) to service_role;

-- Only the server can validate the cron capability and acquire the lease.
create function public.start_daily_market_sync(sync_token text, run_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
begin
  if sync_token is null or length(sync_token) <> 64 or not exists (
    select 1 from vault.decrypted_secrets where name = 'daily_market_sync_token'
    and sha256(convert_to(decrypted_secret, 'UTF8')) = sha256(convert_to(sync_token, 'UTF8'))
  ) then return 'unauthorized'; end if;
  perform pg_advisory_xact_lock(74921035);
  if exists (select 1 from financial_private.daily_market_sync_runs
    where status = 'running' and started_at > now() - interval '5 minutes')
  then return 'busy'; end if;
  if exists (select 1 from financial_private.daily_market_sync_runs
    where day = (now() at time zone 'Europe/Paris')::date and status = 'succeeded')
  then return 'completed'; end if;
  update financial_private.daily_market_sync_runs set status = 'failed', finished_at = now()
    where status = 'running';
  insert into financial_private.daily_market_sync_runs(id, day, status)
    values(run_id, (now() at time zone 'Europe/Paris')::date, 'running');
  return 'started';
end;
$$;
-- Vault is never granted to service_role: a private SECURITY DEFINER validates
-- the capability, with a service-only SECURITY INVOKER wrapper.
alter function public.start_daily_market_sync(text,uuid) set schema financial_private;
alter function financial_private.start_daily_market_sync(text,uuid) security definer;
revoke all on function financial_private.start_daily_market_sync(text,uuid) from public, anon, authenticated;
grant execute on function financial_private.start_daily_market_sync(text,uuid) to service_role;
create function public.start_daily_market_sync(sync_token text, run_id uuid)
returns text language sql security invoker set search_path = '' as $$
  select financial_private.start_daily_market_sync(sync_token, run_id);
$$;
revoke all on function public.start_daily_market_sync(text,uuid) from public, anon, authenticated;
grant execute on function public.start_daily_market_sync(text,uuid) to service_role;

create function public.finish_daily_market_sync(run_id uuid, successes integer, failures integer, push_error boolean)
returns void language sql security invoker set search_path = '' as $$
  update financial_private.daily_market_sync_runs
  set finished_at = now(), succeeded = successes, failed = failures, push_failed = push_error,
    status = case when successes = 0 then 'failed'
      when failures > 0 or push_error then 'partial' else 'succeeded' end
  where id = run_id and status = 'running';
$$;
revoke all on function public.finish_daily_market_sync(uuid,integer,integer,boolean) from public, anon, authenticated;
grant execute on function public.finish_daily_market_sync(uuid,integer,integer,boolean) to service_role;

create function financial_private.invoke_daily_market_sync()
returns bigint language plpgsql security invoker set search_path = '' as $$
declare
  project_url text;
  token text;
begin
  select decrypted_secret into strict project_url from vault.decrypted_secrets where name = 'daily_market_sync_url';
  select decrypted_secret into strict token from vault.decrypted_secrets where name = 'daily_market_sync_token';
  return net.http_post(
    url := project_url || '/functions/v1/daily-market-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || token),
    body := '{}'::jsonb, timeout_milliseconds := 120000);
end;
$$;
revoke all on function financial_private.invoke_daily_market_sync() from public, anon, authenticated, service_role;

-- pg_cron uses UTC. Only one of the two UTC hours is 09:30 in Paris,
-- including on daylight-saving transition days.
select cron.schedule('daily-market-sync', '30 7,8 * * *', $job$
  select financial_private.invoke_daily_market_sync()
  where (now() at time zone 'Europe/Paris')::time >= time '09:30'
    and (now() at time zone 'Europe/Paris')::time < time '09:31';
$job$);
-- Activate only after URL, VAPID secrets and deployment have been checked.
select cron.alter_job((select jobid from cron.job where jobname = 'daily-market-sync'), active := false);
commit;
