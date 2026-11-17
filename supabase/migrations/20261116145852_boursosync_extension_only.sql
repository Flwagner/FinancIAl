-- Connexion initiale propriétaire, puis capacité limitée à un catalogue sans
-- montants et aux synchronisations explicitement confirmées dans l'extension.
begin;
create function financial_private.boursosync_connect(token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not exists(select 1 from public.portfolio_owner where user_id = v_user) then
    raise exception 'Compte non autorisé' using errcode = '42501';
  end if;
  if token_hash is null or token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Jeton invalide'; end if;
  perform 1 from public.portfolios where user_id = v_user for update;
  if not found then raise exception 'Portefeuille absent'; end if;
  insert into financial_private.boursosync_connections(user_id,token_hash,expires_at)
    values(v_user,token_hash,clock_timestamp()+interval '180 days')
    on conflict(user_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at;
  return '{"ok":true}';
end;
$$;
create function public.boursosync_connect(token_hash text)
returns jsonb language sql security invoker set search_path = '' as $$
  select financial_private.boursosync_connect(token_hash);
$$;

create function financial_private.boursosync_extension(sync_token text, operation text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_connection financial_private.boursosync_connections%rowtype;
  v_data jsonb;
  v_reading jsonb;
  v_update jsonb;
  v_position jsonb;
  v_batch uuid;
  v_cursor timestamptz;
begin
  if sync_token is null or sync_token !~ '^[a-f0-9]{64}$' then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;
  select c.* into v_connection from financial_private.boursosync_connections c
    join public.portfolio_owner o on o.user_id = c.user_id
    where c.token_hash = encode(sha256(convert_to(sync_token,'UTF8')),'hex') and c.expires_at > now();
  if not found then raise exception 'Accès refusé' using errcode = '42501'; end if;
  v_user := v_connection.user_id;
  if operation = 'context' then
    -- Cette branche est strictement en lecture, sans curseur ni last_seen écrit.
    select data into v_data from public.portfolios where user_id = v_user;
  elsif operation in ('sync','revoke') then
    -- Même ordre de verrous partout : portefeuille puis connexion.
    select data into v_data from public.portfolios where user_id = v_user for update;
    select * into v_connection from financial_private.boursosync_connections where user_id = v_user for update;
    if not found or v_connection.token_hash is distinct from encode(sha256(convert_to(sync_token,'UTF8')),'hex')
      or v_connection.expires_at <= clock_timestamp() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  else raise exception 'Opération interdite'; end if;
  if operation = 'revoke' then
    update financial_private.boursosync_connections set token_hash = null, expires_at = null where user_id = v_user;
    return '{"ok":true}';
  end if;
  select value into v_reading from jsonb_array_elements(v_data->'readings') with ordinality r(value,n)
    where jsonb_array_length(value->'positions') > 0 and not (value->>'projected')::boolean
    order by value->>'date' desc,n desc limit 1;
  if operation = 'context' then
    return jsonb_build_object('expiresAt',v_connection.expires_at,'lastSyncedAt',v_connection.last_synced_at,
      'positions',coalesce((select jsonb_agg(jsonb_build_object(
        'id',p->>'id','name',p->>'name','code',coalesce(p->>'code',''),'envelope',coalesce(p->>'envelope','')))
        from jsonb_array_elements(v_reading->'positions') p),'[]'::jsonb),
      'mappings',coalesce((select jsonb_agg(jsonb_build_object('account',m.account,'asset',m.asset,
        'positionId',m.position_id,'label',m.label)) from financial_private.boursosync_mappings m
        where m.user_id = v_user and m.asset <> 'cash'),'[]'::jsonb));
  end if;
  if payload is null or octet_length(payload::text)>65536 or payload->'version' is distinct from '1'::jsonb
    or jsonb_typeof(payload->'updates') is distinct from 'array' then raise exception 'Lot invalide'; end if;
  if jsonb_array_length(payload->'updates') not between 1 and 100 then raise exception 'Taille invalide'; end if;
  v_batch := (payload->>'batchId')::uuid;
  if v_batch is null then raise exception 'Identifiant requis'; end if;
  -- Une réponse perdue ne doit ni réappliquer le lot, ni modifier ses associations.
  if exists(select 1 from financial_private.boursosync_receipts where user_id=v_user and batch_id=v_batch) then
    return financial_private.boursosync_apply(sync_token,payload);
  end if;
  if v_reading is null then raise exception 'Relevé réel détaillé requis'; end if;
  for v_update in select value from jsonb_array_elements(payload->'updates') loop
    select last_captured_at into v_cursor from financial_private.boursosync_mappings
      where user_id=v_user and account=v_update->>'account' and asset=v_update->>'asset';
    if v_cursor is not null and (v_update->>'capturedAt')::timestamptz <= v_cursor then
      raise exception 'Capture déjà appliquée ou plus ancienne';
    end if;
    if coalesce(v_update->>'account','') !~ '^[a-f0-9]{64}$'
      or coalesce(v_update->>'asset','') !~ '^([A-Z]{2}[A-Z0-9]{9}[0-9]|balance)$'
      or jsonb_typeof(v_update->'positionId') is distinct from 'string'
      or jsonb_typeof(v_update->'code') is distinct from 'string'
      or jsonb_typeof(v_update->'envelope') is distinct from 'string' then raise exception 'Association invalide'; end if;
    if (select count(*) from jsonb_array_elements(payload->'updates')
      where value->>'positionId'=v_update->>'positionId') <> 1 then raise exception 'Destination en double'; end if;
    select value into v_position from jsonb_array_elements(v_reading->'positions')
      where value->>'id'=v_update->>'positionId';
    if v_position is null or (select count(*) from jsonb_array_elements(v_reading->'positions')
      where value->>'id'=v_update->>'positionId')<>1
      or coalesce(v_position->>'code','') is distinct from v_update->>'code'
      or coalesce(v_position->>'envelope','') is distinct from v_update->>'envelope' then
      raise exception 'Destination modifiée depuis l’aperçu'; end if;
  end loop;
  -- Libérer seulement les sources explicitement réaffectées dans ce lot.
  -- Une destination occupée par une autre source non incluse reste protégée
  -- par la contrainte unique(user_id,position_id).
  delete from financial_private.boursosync_mappings m where m.user_id=v_user and exists(
    select 1 from jsonb_array_elements(payload->'updates') u
    where u->>'account'=m.account and u->>'asset'=m.asset and u->>'positionId'<>m.position_id);
  for v_update in select value from jsonb_array_elements(payload->'updates') loop
    select value into v_position from jsonb_array_elements(v_reading->'positions') where value->>'id'=v_update->>'positionId';
    insert into financial_private.boursosync_mappings(user_id,account,asset,position_id,position_code,position_envelope,label)
      values(v_user,v_update->>'account',v_update->>'asset',v_update->>'positionId',v_update->>'code',
        v_update->>'envelope',left(concat(v_position->>'name',' · ',v_position->>'envelope'),200))
      on conflict(user_id,account,asset) do update set
        position_code=excluded.position_code, position_envelope=excluded.position_envelope,label=excluded.label;
  end loop;
  -- La validation des montants, dates, curseurs et le recalcul restent uniques.
  -- Toute erreur annule aussi les associations préparées ci-dessus.
  return financial_private.boursosync_apply(sync_token,payload);
end;
$$;
create function public.boursosync_extension(sync_token text, operation text, payload jsonb default '{}'::jsonb)
returns jsonb language sql security invoker set search_path = '' as $$
  select financial_private.boursosync_extension(sync_token,operation,payload);
$$;

revoke all on function financial_private.boursosync_connect(text),public.boursosync_connect(text),
  financial_private.boursosync_extension(text,text,jsonb),public.boursosync_extension(text,text,jsonb)
  from public,anon,authenticated;
grant execute on function financial_private.boursosync_connect(text),public.boursosync_connect(text) to authenticated;
grant execute on function financial_private.boursosync_extension(text,text,jsonb),public.boursosync_extension(text,text,jsonb) to anon,authenticated;
notify pgrst,'reload schema';
commit;
