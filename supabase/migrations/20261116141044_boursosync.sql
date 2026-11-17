-- Boursosync : capacités limitées aux montants explicitement associés.
-- Aucun accès direct aux tables privées, aucun secret administrateur côté client.
begin;

create table financial_private.boursosync_connections (
  user_id uuid primary key references public.portfolio_owner(user_id) on delete cascade,
  token_hash text unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz,
  last_synced_at timestamptz,
  last_captured_at timestamptz,
  last_count integer
);
create table financial_private.boursosync_mappings (
  user_id uuid not null references financial_private.boursosync_connections(user_id) on delete cascade,
  account text not null check (account ~ '^[a-f0-9]{64}$'),
  asset text not null check (asset ~ '^([A-Z]{2}[A-Z0-9]{9}[0-9]|balance|cash)$'),
  position_id text not null,
  position_code text not null,
  position_envelope text not null,
  label text not null,
  last_captured_at timestamptz,
  primary key(user_id, account, asset),
  unique(user_id, position_id)
);
create table financial_private.boursosync_receipts (
  user_id uuid not null references financial_private.boursosync_connections(user_id) on delete cascade,
  batch_id uuid not null,
  payload_hash text not null,
  applied_at timestamptz not null default now(),
  count integer not null,
  primary key(user_id, batch_id)
);
alter table financial_private.boursosync_connections enable row level security;
alter table financial_private.boursosync_mappings enable row level security;
alter table financial_private.boursosync_receipts enable row level security;
revoke all on financial_private.boursosync_connections,
  financial_private.boursosync_mappings, financial_private.boursosync_receipts from public, anon, authenticated;

-- Toutes les opérations propriétaires vérifient auth.uid() ET portfolio_owner.
create function financial_private.boursosync_manage(operation text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_data jsonb;
  v_reading jsonb;
  v_mapping jsonb;
  v_position jsonb;
  v_result jsonb;
  v_count integer;
begin
  if v_user is null or not exists(select 1 from public.portfolio_owner where user_id = v_user) then
    raise exception 'Accès propriétaire requis' using errcode = '42501';
  end if;
  if operation = 'status' then
    select jsonb_build_object(
      'active', c.token_hash is not null and c.expires_at > now(),
      'expiresAt', c.expires_at, 'lastSyncedAt', c.last_synced_at,
      'lastCapturedAt', c.last_captured_at, 'lastCount', c.last_count,
      'mappings', coalesce((select jsonb_agg(jsonb_build_object('account', m.account,
        'asset', m.asset, 'positionId', m.position_id, 'label', m.label) order by m.account, m.asset)
        from financial_private.boursosync_mappings m where m.user_id = v_user), '[]'::jsonb))
    into v_result from financial_private.boursosync_connections c where c.user_id = v_user;
    return coalesce(v_result, '{"active":false,"mappings":[]}'::jsonb);
  end if;
  -- Même ordre de verrous que la synchronisation : portefeuille, puis connexion.
  select data into v_data from public.portfolios where user_id = v_user for update;
  if not found then raise exception 'Enregistre ton portefeuille avant de configurer Boursosync'; end if;
  if operation = 'revoke' then
    update financial_private.boursosync_connections set token_hash = null, expires_at = null where user_id = v_user;
    return '{"ok":true}';
  end if;
  if operation is distinct from 'configure' then raise exception 'Opération inconnue'; end if;
  if payload is null or octet_length(payload::text) > 65536
    or jsonb_typeof(payload->'tokenHash') is distinct from 'string'
    or (payload->>'tokenHash') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(payload->'mappings') is distinct from 'array' then
    raise exception 'Configuration invalide';
  end if;
  v_count := jsonb_array_length(payload->'mappings');
  if v_count < 1 or v_count > 100 then raise exception 'Entre 1 et 100 associations requises'; end if;
  select value into v_reading from jsonb_array_elements(v_data->'readings') with ordinality r(value,n)
    where jsonb_array_length(value->'positions') > 0 and not (value->>'projected')::boolean
    order by value->>'date' desc, n desc limit 1;
  if v_reading is null then raise exception 'Un relevé réel détaillé est nécessaire'; end if;
  insert into financial_private.boursosync_connections(user_id, token_hash, expires_at)
    values(v_user, payload->>'tokenHash', now() + interval '180 days')
    on conflict(user_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at;
  -- Les curseurs des associations inchangées sont conservés lors d'une rotation.
  for v_mapping in select value from jsonb_array_elements(payload->'mappings') loop
    if jsonb_typeof(v_mapping) is distinct from 'object'
      or coalesce(v_mapping->>'account','') !~ '^[a-f0-9]{64}$'
      or coalesce(v_mapping->>'asset','') !~ '^([A-Z]{2}[A-Z0-9]{9}[0-9]|balance|cash)$'
      or length(coalesce(v_mapping->>'positionId','')) not between 1 and 200
      or length(coalesce(v_mapping->>'label','')) not between 1 and 200 then
      raise exception 'Association invalide';
    end if;
    select value into v_position from jsonb_array_elements(v_reading->'positions')
      where value->>'id' = v_mapping->>'positionId';
    if v_position is null or (select count(*) from jsonb_array_elements(v_reading->'positions')
      where value->>'id' = v_mapping->>'positionId') <> 1 then raise exception 'Placement inconnu ou ambigu'; end if;
    if (select count(*) from jsonb_array_elements(payload->'mappings')
        where value->>'positionId' = v_mapping->>'positionId') <> 1
      or (select count(*) from jsonb_array_elements(payload->'mappings')
        where value->>'account' = v_mapping->>'account' and value->>'asset' = v_mapping->>'asset') <> 1 then
      raise exception 'Association en double';
    end if;
  end loop;
  -- Supprime uniquement les associations retirées ou modifiées.
  delete from financial_private.boursosync_mappings m where m.user_id = v_user and not exists(
    select 1 from jsonb_array_elements(payload->'mappings') x where x->>'account' = m.account
      and x->>'asset' = m.asset and x->>'positionId' = m.position_id);
  for v_mapping in select value from jsonb_array_elements(payload->'mappings') loop
    select value into v_position from jsonb_array_elements(v_reading->'positions') where value->>'id' = v_mapping->>'positionId';
    insert into financial_private.boursosync_mappings(user_id,account,asset,position_id,position_code,position_envelope,label)
      values(v_user,v_mapping->>'account',v_mapping->>'asset',v_mapping->>'positionId',
        coalesce(v_position->>'code',''),coalesce(v_position->>'envelope',''),v_mapping->>'label')
      on conflict(user_id,account,asset) do update set label = excluded.label,
        position_code = excluded.position_code, position_envelope = excluded.position_envelope;
  end loop;
  return '{"ok":true}';
end;
$$;

create function public.boursosync_manage(operation text, payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select financial_private.boursosync_manage(operation,payload);
$$;

-- Le jeton n'autorise que cette opération. Aucun retour des montants ou du portefeuille.
create function financial_private.boursosync_apply(sync_token text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_connection financial_private.boursosync_connections%rowtype;
  v_receipt financial_private.boursosync_receipts%rowtype;
  v_mapping financial_private.boursosync_mappings%rowtype;
  v_data jsonb;
  v_reading jsonb;
  v_existing jsonb;
  v_positions jsonb;
  v_snapshots jsonb;
  v_update jsonb;
  v_position jsonb;
  v_total numeric;
  v_cents numeric;
  v_captured timestamptz;
  v_last_captured timestamptz;
  v_batch uuid;
  v_hash text;
  v_date text := to_char(now() at time zone 'Europe/Paris', 'YYYY-MM-DD');
  v_count integer;
  v_portfolio_updated timestamptz;
begin
  if sync_token is null or sync_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Synchronisation non autorisée' using errcode = '42501';
  end if;
  select c.user_id into v_user from financial_private.boursosync_connections c
    join public.portfolio_owner o on o.user_id = c.user_id
    where c.token_hash = encode(sha256(convert_to(sync_token,'UTF8')),'hex') and c.expires_at > now();
  if not found then raise exception 'Synchronisation non autorisée' using errcode = '42501'; end if;
  select data, updated_at into v_data, v_portfolio_updated from public.portfolios where user_id = v_user for update;
  if not found then raise exception 'Portefeuille absent'; end if;
  -- Revérifier après les verrous : une révocation concurrente doit être effective.
  select * into v_connection from financial_private.boursosync_connections
    where user_id = v_user for update;
  if v_connection.token_hash is distinct from encode(sha256(convert_to(sync_token,'UTF8')),'hex')
    or v_connection.expires_at <= now() then
    raise exception 'Synchronisation non autorisée' using errcode = '42501';
  end if;
  if payload is null or octet_length(payload::text) > 65536
    or payload->'version' is distinct from '1'::jsonb
    or jsonb_typeof(payload->'updates') is distinct from 'array' then raise exception 'Lot invalide'; end if;
  v_count := jsonb_array_length(payload->'updates');
  if v_count < 1 or v_count > 100 then raise exception 'Taille du lot invalide'; end if;
  v_batch := (payload->>'batchId')::uuid;
  if v_batch is null then raise exception 'Identifiant de lot requis'; end if;
  v_hash := encode(sha256(convert_to(payload::text,'UTF8')),'hex');
  select * into v_receipt from financial_private.boursosync_receipts where user_id = v_user and batch_id = v_batch;
  if found then
    if v_receipt.payload_hash <> v_hash then raise exception 'Identifiant de lot réutilisé avec un autre contenu'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'batchId',v_batch,'count',v_receipt.count);
  end if;
  if v_connection.last_synced_at > now() - interval '2 seconds' then raise exception 'Attends quelques secondes avant un nouvel envoi'; end if;
  select value into v_reading from jsonb_array_elements(v_data->'readings') with ordinality r(value,n)
    where jsonb_array_length(value->'positions') > 0 and not (value->>'projected')::boolean
    order by value->>'date' desc, n desc limit 1;
  if v_reading is null or v_reading->>'date' > v_date then raise exception 'Relevé réel courant indisponible'; end if;
  v_positions := v_reading->'positions';
  for v_update in select value from jsonb_array_elements(payload->'updates') loop
    if jsonb_typeof(v_update) is distinct from 'object'
      or jsonb_typeof(v_update->'cents') is distinct from 'number'
      or coalesce(v_update->>'account','') !~ '^[a-f0-9]{64}$'
      or coalesce(v_update->>'asset','') !~ '^([A-Z]{2}[A-Z0-9]{9}[0-9]|balance|cash)$'
      or jsonb_typeof(v_update->'capturedAt') is distinct from 'string' then raise exception 'Montant invalide'; end if;
    v_cents := (v_update->>'cents')::numeric;
    if v_cents < 0 or v_cents > 100000000000 or trunc(v_cents) <> v_cents then raise exception 'Montant hors limites'; end if;
    v_captured := (v_update->>'capturedAt')::timestamptz;
    if v_captured is null or v_captured < now() - interval '30 minutes' or v_captured > now() + interval '1 minute' then
      raise exception 'Capture expirée ou future';
    end if;
    if v_portfolio_updated > v_captured
      and (v_connection.last_synced_at is null or v_portfolio_updated > v_connection.last_synced_at) then
      raise exception 'Une saisie plus récente existe : relis les pages bancaires avant de synchroniser';
    end if;
    if (select count(*) from jsonb_array_elements(payload->'updates')
      where value->>'account' = v_update->>'account' and value->>'asset' = v_update->>'asset') <> 1 then
      raise exception 'Source en double';
    end if;
    select * into v_mapping from financial_private.boursosync_mappings
      where user_id = v_user and account = v_update->>'account' and asset = v_update->>'asset';
    if not found then raise exception 'Source non associée'; end if;
    if v_mapping.last_captured_at is not null and v_captured <= v_mapping.last_captured_at then
      raise exception 'Capture déjà appliquée ou plus ancienne';
    end if;
    select value into v_position from jsonb_array_elements(v_positions) where value->>'id' = v_mapping.position_id;
    if v_position is null or (select count(*) from jsonb_array_elements(v_positions) where value->>'id' = v_mapping.position_id) <> 1
      or coalesce(v_position->>'code','') <> v_mapping.position_code
      or coalesce(v_position->>'envelope','') <> v_mapping.position_envelope then
      raise exception 'Placement supprimé ou identité modifiée : reconfigure les associations';
    end if;
    select jsonb_agg(case when value->>'id' = v_mapping.position_id then
      jsonb_set(value,'{amount}',to_jsonb(v_cents / 100)) else value end order by n)
      into v_positions from jsonb_array_elements(v_positions) with ordinality p(value,n);
    update financial_private.boursosync_mappings set last_captured_at = v_captured
      where user_id = v_user and account = v_mapping.account and asset = v_mapping.asset;
    v_last_captured := greatest(v_last_captured,v_captured);
  end loop;
  select sum((value->>'amount')::numeric) into v_total from jsonb_array_elements(v_positions);
  select value into v_existing from jsonb_array_elements(v_data->'readings') where value->>'date' = v_date;
  v_snapshots := coalesce(v_data->'monthlySnapshots','[]'::jsonb);
  -- Même règle que saveCurrentReading : ne pas écraser un ancien point mensuel réel le 1er.
  if v_existing is not null and not (v_existing->>'projected')::boolean
    and coalesce(v_existing->>'kind','') <> 'current' and right(v_date,3) = '-01'
    and not exists(select 1 from jsonb_array_elements(v_snapshots) where value->>'month' = left(v_date,7)) then
    v_snapshots := v_snapshots || jsonb_build_array(jsonb_build_object('month',left(v_date,7),'capturedAt',v_date,'total',v_existing->'total'));
    v_data := jsonb_set(v_data,'{monthlySnapshots}',v_snapshots);
  end if;
  v_reading := v_reading || jsonb_build_object('id',coalesce(v_existing->>'id',gen_random_uuid()::text),
    'date',v_date,'projected',false,'kind','current','positions',v_positions,'total',v_total);
  v_data := jsonb_set(v_data,'{readings}',coalesce((select jsonb_agg(value order by n)
    from jsonb_array_elements(v_data->'readings') with ordinality r(value,n) where value->>'date' <> v_date),'[]'::jsonb)
    || jsonb_build_array(v_reading));
  update public.portfolios set data = v_data, updated_at = clock_timestamp() where user_id = v_user;
  update financial_private.boursosync_connections set last_synced_at = clock_timestamp(),
    last_captured_at = v_last_captured, last_count = v_count where user_id = v_user;
  insert into financial_private.boursosync_receipts(user_id,batch_id,payload_hash,count) values(v_user,v_batch,v_hash,v_count);
  delete from financial_private.boursosync_receipts where user_id = v_user and applied_at < now() - interval '7 days';
  return jsonb_build_object('ok',true,'duplicate',false,'batchId',v_batch,'count',v_count);
end;
$$;
create function public.boursosync_apply(sync_token text, payload jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select financial_private.boursosync_apply(sync_token,payload);
$$;

-- Comparaison atomique du document précédent : protège également les objectifs,
-- sans changer updated_at lors d'une modification des objectifs seulement.
create function public.save_portfolio_checked(next_data jsonb, expected_data jsonb)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare
  v_previous jsonb;
  v_updated timestamptz;
begin
  if auth.uid() is null then raise exception 'Connexion requise' using errcode = '42501'; end if;
  if jsonb_typeof(next_data) is distinct from 'object' then raise exception 'Portefeuille invalide'; end if;
  select data into v_previous from public.portfolios where user_id = auth.uid() for update;
  if not found then
    if expected_data is not null then raise exception 'Portefeuille modifié. Recharge avant de sauvegarder.' using errcode = '40001'; end if;
    insert into public.portfolios(user_id,data) values(auth.uid(),next_data) returning updated_at into v_updated;
    return v_updated;
  end if;
  if v_previous is distinct from expected_data then
    raise exception 'Portefeuille modifié depuis son ouverture. Recharge avant de sauvegarder.' using errcode = '40001';
  end if;
  update public.portfolios set data = next_data,
    updated_at = case when data->'readings' is distinct from next_data->'readings'
      or data->'monthlySnapshots' is distinct from next_data->'monthlySnapshots' then clock_timestamp() else updated_at end
    where user_id = auth.uid() returning updated_at into v_updated;
  return v_updated;
end;
$$;

revoke all on function financial_private.boursosync_manage(text,jsonb),
  public.boursosync_manage(text,jsonb), financial_private.boursosync_apply(text,jsonb),
  public.boursosync_apply(text,jsonb), public.save_portfolio_checked(jsonb,jsonb) from public, anon, authenticated;
grant execute on function financial_private.boursosync_manage(text,jsonb),
  public.boursosync_manage(text,jsonb), public.save_portfolio_checked(jsonb,jsonb) to authenticated;
grant execute on function financial_private.boursosync_apply(text,jsonb), public.boursosync_apply(text,jsonb) to anon, authenticated;
-- financial_private doit rester NON exposé dans la Data API.
notify pgrst, 'reload schema';
commit;
