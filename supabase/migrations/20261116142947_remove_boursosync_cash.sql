-- Retrait des espèces, sans supprimer de configuration ni modifier de montant.
begin;
alter table financial_private.boursosync_mappings
  add constraint boursosync_no_cash check (asset <> 'cash') not valid;
-- Préserve les droits et attributs des fonctions existantes. Les anciennes lignes
-- éventuelles restent stockées, mais aucune nouvelle capture cash n'est acceptée.
do $migration$
declare
  signature text;
  definition text;
begin
  foreach signature in array array[
    'financial_private.boursosync_manage(text,jsonb)',
    'financial_private.boursosync_apply(text,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if strpos(definition, '|balance|cash') = 0 then
      raise exception 'Validation Boursosync inattendue pour %', signature;
    end if;
    execute replace(definition, '|balance|cash', '|balance');
  end loop;
end;
$migration$;
notify pgrst, 'reload schema';
commit;
