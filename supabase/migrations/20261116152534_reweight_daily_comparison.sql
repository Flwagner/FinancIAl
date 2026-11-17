-- Conserver les taux de marché, pas seulement la moyenne d'un ancien portefeuille.
-- Pas de rétroremplissage : les cours actuels ne prouvent pas les taux d'hier.
begin;
alter table public.portfolio_sync_impact
  add column market_snapshot jsonb,
  add column reference_market jsonb;

create function financial_private.capture_comparison_market()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' then
    if new.synced_at <= old.synced_at then
      new.market_snapshot := old.market_snapshot;
      new.reference_market := old.reference_market;
      return new;
    end if;
    if (old.synced_at at time zone 'Europe/Paris')::date <
       (new.synced_at at time zone 'Europe/Paris')::date then
      new.reference_market := old.market_snapshot;
    else
      new.reference_market := old.reference_market;
    end if;
  else
    new.reference_market := null;
  end if;
  new.market_snapshot := jsonb_build_object('captured_at',new.synced_at,
    'returns',coalesce((select jsonb_agg(to_jsonb(r)) from public.market_returns r),'[]'::jsonb),
    'statuses',coalesce((select jsonb_agg(to_jsonb(s)) from public.market_sync_status s),'[]'::jsonb));
  return new;
end;
$$;
revoke all on function financial_private.capture_comparison_market() from public,anon,authenticated;
create trigger capture_comparison_market before insert or update of synced_at
  on public.portfolio_sync_impact for each row execute function financial_private.capture_comparison_market();
-- RLS et droits existants inchangés : seul le job privilégié écrit ces observations.
notify pgrst,'reload schema';
commit;
