-- Base Docker jetable exclusivement ; aucune donnée réelle.
\set ON_ERROR_STOP on
begin;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.portfolio_owner values ('00000000-0000-0000-0000-000000000001');
insert into public.portfolios(user_id,data,updated_at) values ('00000000-0000-0000-0000-000000000001',
'{"goals":{"capital":100},"readings":[{"id":"current","date":"2020-01-01","projected":false,"positions":[
{"id":"a","name":"Test A","code":"IE0002XZSHO1","envelope":"PEA","category":"Actions","amount":10,"rate":3},
{"id":"b","name":"Test B","code":"","envelope":"Direct","category":"Livret A","amount":20,"rate":2}]}]}',
now()-interval '1 day');
create function pg_temp.must_fail(statement text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then return; end;
  raise exception 'TEST FAILURE: unexpectedly succeeded: %',statement;
end $$;
set local role anon;
select pg_temp.must_fail($q$select public.boursosync_connect(repeat('a',64))$q$);
select pg_temp.must_fail($q$select public.boursosync_extension(repeat('a',64),'context')$q$);
reset role;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.must_fail($q$select public.boursosync_connect(repeat('a',64))$q$);
reset role;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local role authenticated;
select public.boursosync_connect(encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'));
reset role;
create temporary table batches(payload jsonb);
insert into batches values(jsonb_build_object('version',1,'batchId',gen_random_uuid(),'updates',
jsonb_build_array(jsonb_build_object('account',repeat('b',64),'asset','IE0002XZSHO1','positionId','a',
'code','IE0002XZSHO1','envelope','PEA','cents',1234,'capturedAt',now()))));
grant select on batches to anon;
set local role anon;
do $$ declare c jsonb; begin
 c := public.boursosync_extension(repeat('a',64),'context');
 assert jsonb_array_length(c->'positions')=2;
 assert c->'mappings'='[]';
 assert not (c->'positions'->0 ? 'amount');
 assert not (c->'positions'->0 ? 'rate');
 assert not (c ? 'goals');
end $$;
select pg_temp.must_fail($q$select public.boursosync_extension(repeat('a',64),'configure')$q$);
select pg_temp.must_fail($q$select public.boursosync_extension(repeat('a',64),'sync',jsonb_set(payload,'{updates,0,code}','"changed"')) from batches$q$);
select pg_temp.must_fail($q$select public.boursosync_extension(repeat('a',64),'sync',jsonb_set(payload,'{updates,0,cents}','-1')) from batches$q$);
select pg_temp.must_fail($q$select public.boursosync_extension(repeat('a',64),'sync',jsonb_set(payload,'{updates}',(payload->'updates')||(payload->'updates'))) from batches$q$);
reset role;
do $$ begin
 assert (select count(*)=0 from financial_private.boursosync_mappings);
 assert (select count(*)=0 from financial_private.boursosync_receipts);
end $$;
set local role anon;
select public.boursosync_extension(repeat('a',64),'sync',payload) from batches;
do $$ begin
 assert (select (public.boursosync_extension(repeat('a',64),'sync',payload)->>'duplicate')::boolean from batches);
 assert jsonb_array_length(public.boursosync_extension(repeat('a',64),'context')->'mappings')=1;
end $$;
select pg_temp.must_fail($q$select public.boursosync_extension(repeat('a',64),'sync',jsonb_set(payload,'{updates,0,positionId}','"b"')) from batches$q$);
reset role;
do $$ begin
 assert (select position_id='a' from financial_private.boursosync_mappings);
 assert (select (value->'positions'->0->>'amount')::numeric=12.34
 from public.portfolios, jsonb_array_elements(data->'readings') where value->>'kind'='current');
end $$;
-- Pas de vol de destination par un autre compte ; pas de remise à zéro du curseur.
update financial_private.boursosync_connections set last_synced_at=now()-interval '1 minute';
update batches set payload=jsonb_set(payload,'{batchId}',to_jsonb(gen_random_uuid()));
set local role anon;
select pg_temp.must_fail($q$select public.boursosync_extension(repeat('a',64),'sync',jsonb_set(payload,'{updates,0,account}',to_jsonb(repeat('c',64)))) from batches$q$);
select pg_temp.must_fail($q$select public.boursosync_extension(repeat('a',64),'sync',
jsonb_set(jsonb_set(jsonb_set(payload,'{updates,0,positionId}','"b"'),'{updates,0,code}','""'),'{updates,0,envelope}','"Direct"')) from batches$q$);
reset role;
set local role authenticated;
select public.boursosync_connect(encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'));
set local role anon;
select pg_temp.must_fail($q$select public.boursosync_extension(repeat('a',64),'context')$q$);
select public.boursosync_extension(repeat('d',64),'revoke');
select pg_temp.must_fail($q$select public.boursosync_extension(repeat('d',64),'context')$q$);
reset role;
rollback;
\echo 'Boursosync extension: authorization, minimal catalog, atomic sync, idempotency, identity, cursors, revocation OK'
