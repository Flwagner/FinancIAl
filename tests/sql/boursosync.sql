-- PostgreSQL jetable uniquement. Ce fichier ne doit jamais cibler la base partagée.
\set ON_ERROR_STOP on
begin;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
insert into public.portfolio_owner values ('00000000-0000-0000-0000-000000000001');
insert into public.portfolios(user_id,data) values ('00000000-0000-0000-0000-000000000001',
'{"goals":{"capital":100,"annual":12,"monthly":1},"readings":[
 {"id":"history","date":"2020-01-01","projected":false,"total":5,"positions":[]},
 {"id":"current","date":"2020-01-02","projected":false,"total":30,"positions":[
   {"id":"a","name":"Test A","code":"IE0002XZSHO1","envelope":"PEA","category":"Actions","amount":10,"rate":3},
   {"id":"b","name":"Test B","code":"","envelope":"Direct","category":"Livret A","amount":20,"rate":2}]},
 {"id":"projection","date":"2099-01-01","projected":true,"total":99,"positions":[]}
]}');
create function pg_temp.must_fail(statement text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then return; end;
  raise exception 'TEST FAILURE: statement unexpectedly succeeded: %', statement;
end $$;
grant usage on schema public to anon, authenticated;
set local role anon;
select pg_temp.must_fail($q$select public.boursosync_manage('status')$q$);
select pg_temp.must_fail($q$select * from financial_private.boursosync_connections$q$);
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),'{}')$q$);
reset role;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.must_fail($q$select public.boursosync_manage('status')$q$);
reset role;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
set local role authenticated;
select public.boursosync_manage('configure',jsonb_build_object('tokenHash',encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'),
  'mappings',jsonb_build_array(jsonb_build_object('account',repeat('b',64),'asset','IE0002XZSHO1','positionId','a','label','Test A'))));
do $$ begin
  assert public.boursosync_manage('status')->>'active' = 'true';
  assert not (public.boursosync_manage('status') ? 'token_hash');
end $$;
select pg_temp.must_fail($q$select * from financial_private.boursosync_mappings$q$);
select pg_temp.must_fail($q$select public.boursosync_manage('configure','{"tokenHash":"invalid","mappings":[]}')$q$);
select pg_temp.must_fail($q$select public.boursosync_manage('configure',jsonb_build_object(
  'tokenHash',encode(sha256(convert_to(repeat('a',64),'UTF8')),'hex'),
  'mappings',jsonb_build_array(jsonb_build_object('account',repeat('b',64),'asset','cash','positionId','a','label','Test A'))))$q$);
reset role;
-- Un lot valide construit avec l'heure de la base. Aucun vrai montant utilisateur.
create temporary table batches(payload jsonb);
insert into batches values(jsonb_build_object('version',1,'batchId',gen_random_uuid(),'updates',
  jsonb_build_array(jsonb_build_object('account',repeat('b',64),'asset','IE0002XZSHO1','cents',1234,'capturedAt',now()))));
grant select on batches to anon, authenticated;
set local role anon;
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('c',64),payload) from batches$q$);
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),jsonb_set(payload,'{version}','2')) from batches$q$);
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),jsonb_set(payload,'{updates,0,cents}','-1')) from batches$q$);
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),jsonb_set(payload,'{updates,0,cents}','1.2')) from batches$q$);
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),jsonb_set(payload,'{updates,0,cents}','"1"')) from batches$q$);
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),jsonb_set(payload,'{updates,0,capturedAt}',to_jsonb(now()-interval '31 minutes'))) from batches$q$);
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),jsonb_set(payload,'{updates,0,capturedAt}',to_jsonb(now()+interval '2 minutes'))) from batches$q$);
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),jsonb_set(payload,'{updates,0,asset}','"cash"')) from batches$q$);
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),jsonb_set(payload,'{updates}',(payload->'updates')||(payload->'updates'))) from batches$q$);
select public.boursosync_apply(repeat('a',64),payload) from batches;
do $$ begin
  assert (select (public.boursosync_apply(repeat('a',64),payload)->>'duplicate')::boolean from batches);
end $$;
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),jsonb_set(payload,'{updates,0,cents}','9')) from batches$q$);
reset role;
do $$ declare d jsonb; r jsonb; begin
  select data into d from public.portfolios;
  assert d->'goals' = '{"capital":100,"annual":12,"monthly":1}'::jsonb;
  assert (select value->>'total' = '5' from jsonb_array_elements(d->'readings') where value->>'id'='history');
  assert (select value->>'total' = '99' from jsonb_array_elements(d->'readings') where value->>'id'='projection');
  select value into r from jsonb_array_elements(d->'readings') where value->>'kind'='current';
  assert (r->>'total')::numeric = 32.34;
  assert (select (value->>'amount')::numeric = 12.34 and value->>'rate' = '3' from jsonb_array_elements(r->'positions') where value->>'id'='a');
  assert (select (value->>'amount')::numeric = 20 from jsonb_array_elements(r->'positions') where value->>'id'='b');
end $$;
-- Captures anciennes, identité changée, lot partiel invalide : atomicité.
update financial_private.boursosync_connections set last_synced_at = now()-interval '1 minute';
update batches set payload = jsonb_set(payload,'{batchId}',to_jsonb(gen_random_uuid()));
set local role anon;
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),payload) from batches$q$);
reset role;
update batches set payload = jsonb_set(payload,'{updates,0,capturedAt}',to_jsonb(now()+interval '1 second'));
update public.portfolios set data = jsonb_set(data,array['readings',(jsonb_array_length(data->'readings')-1)::text,'positions','0','envelope'],'"CTO"');
set local role anon;
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),payload) from batches$q$);
reset role;
update public.portfolios set data = jsonb_set(data,array['readings',(jsonb_array_length(data->'readings')-1)::text,'positions','0','envelope'],'"PEA"');
update batches set payload = jsonb_set(payload,'{updates}',(payload->'updates')||jsonb_build_array(jsonb_set(payload->'updates'->0,'{asset}','"cash"')));
set local role anon;
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),payload) from batches$q$);
reset role;
do $$ begin
  assert (select count(*) = 1 from financial_private.boursosync_receipts);
  assert (select last_captured_at = now() from financial_private.boursosync_mappings);
end $$;
-- CAS : le document précédent doit correspondre, y compris pour les objectifs.
set local role authenticated;
select pg_temp.must_fail($q$select public.save_portfolio_checked('{"goals":{}}','{}')$q$);
create temporary table before_save as select data,updated_at from public.portfolios;
select public.save_portfolio_checked(jsonb_set(data,'{goals,capital}','200'),data) from before_save;
do $$ begin
  assert (select p.updated_at = b.updated_at from public.portfolios p cross join before_save b);
end $$;
select pg_temp.must_fail($q$select public.save_portfolio_checked(data,data) from before_save$q$);
reset role;
-- Zéro lu explicitement accepté ; rotation du jeton sans perdre les curseurs.
update financial_private.boursosync_connections set last_synced_at = now()-interval '1 minute';
update batches set payload = jsonb_set(payload,'{updates}',jsonb_build_array(
  jsonb_set(jsonb_set(payload->'updates'->0,'{cents}','0'),'{capturedAt}',to_jsonb(now()+interval '2 seconds'))));
set local role anon;
select public.boursosync_apply(repeat('a',64),payload) from batches;
reset role;
do $$ begin
  assert (select (value->'positions'->0->>'amount')::numeric = 0
    from public.portfolios p, jsonb_array_elements(p.data->'readings') where value->>'kind' = 'current');
end $$;
set local role authenticated;
select public.boursosync_manage('configure',jsonb_build_object('tokenHash',encode(sha256(convert_to(repeat('d',64),'UTF8')),'hex'),
  'mappings',jsonb_build_array(jsonb_build_object('account',repeat('b',64),'asset','IE0002XZSHO1','positionId','a','label','Test A'))));
set local role anon;
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('a',64),payload) from batches$q$);
reset role;
do $$ begin assert (select last_captured_at = now()+interval '2 seconds' from financial_private.boursosync_mappings); end $$;
-- Capture antérieure à une saisie manuelle : refus, même avec un nouveau jeton.
update financial_private.boursosync_connections set last_synced_at = now()-interval '1 minute';
update public.portfolios set updated_at = now()+interval '10 seconds';
update batches set payload = jsonb_set(payload,'{batchId}',to_jsonb(gen_random_uuid()));
set local role anon;
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('d',64),payload) from batches$q$);
reset role;
set local role authenticated;
select public.boursosync_manage('revoke');
set local role anon;
select pg_temp.must_fail($q$select public.boursosync_apply(repeat('d',64),payload) from batches$q$);
reset role;
do $$ begin
  assert not has_function_privilege('anon','public.save_portfolio_checked(jsonb,jsonb)','execute');
  assert not has_function_privilege('anon','public.boursosync_manage(text,jsonb)','execute');
  assert not has_table_privilege('authenticated','financial_private.boursosync_connections','select');
  assert not has_table_privilege('anon','financial_private.boursosync_receipts','insert');
end $$;
rollback;
\echo 'Boursosync SQL: security, validation, preservation, idempotency, atomicity, CAS, revocation OK'
