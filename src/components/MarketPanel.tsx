'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadMarketData, syncMarketReturns } from '@/lib/supabase';
import { freezeChangedReadings, type MarketData } from '@/lib/market';
import type { Portfolio } from '@/lib/portfolio';
import Dashboard from './Dashboard';
import Editor from './Editor';
import SidebarGoals from './SidebarGoals';
import PushNotifications from './PushNotifications';
import StockPortfolio from './StockPortfolio';
import ScpiPortfolio from './ScpiPortfolio';
import Simulation from './Simulation';
import PortfolioStatus from './PortfolioStatus';
import SyncFeedback from './SyncFeedback';
import { marketSyncMessage } from '@/lib/manual-market-sync';
import { scpiPositions } from '@/lib/scpi';

export default function MarketPanel({ data, onSave, tab, sidebar, owner }: { data: Portfolio; onSave: (data: Portfolio) => Promise<void>; tab: 'dashboard' | 'editor' | 'stocks' | 'scpi' | 'simulation'; sidebar: HTMLDivElement | null; owner: string }) {
  const [market, setMarket] = useState<MarketData>({ returns: [], statuses: [], loading: true });
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState(false);
  const [goalsRequest, setGoalsRequest] = useState(0);
  const [simulationActions, setSimulationActions] = useState<HTMLDivElement | null>(null);
  const syncLock = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    async function update() {
      const request = ++revision.current;
      try { const result = await loadMarketData(); if (active && request === revision.current) setMarket(result); }
      catch { if (active && request === revision.current) setMarket({ returns: [], statuses: [], error: 'Lecture des données de marché impossible.' }); }
    }
    void update();
    // Pas de relecture périodique ni au retour sur la fenêtre : seule une
    // synchronisation manuelle ou un rechargement de la page actualise le marché.
    return () => { active = false; };
  }, []);
  async function synchronize() {
    if (syncLock.current) return;
    syncLock.current = true;
    setSyncing(true); setSyncMessage(''); setSyncError(false);
    try {
      const result = await syncMarketReturns();
      const request = ++revision.current;
      const refreshed = await loadMarketData();
      if (request === revision.current) setMarket(refreshed);
      setSyncError(result.failed > 0 || !!refreshed.error);
      setSyncMessage(`${marketSyncMessage(result)}${refreshed.error ? ' Actualisation de l’affichage impossible ; réessaie de charger la page.' : ''}`);
    } catch (error) {
      setSyncError(true);
      setSyncMessage(error instanceof Error ? error.message : 'Synchronisation impossible. Réessaie plus tard.');
    } finally { syncLock.current = false; setSyncing(false); }
  }
  async function save(next: Portfolio) {
    // Figer les cours connus uniquement lors de la validation d'un relevé modifié.
    const readings = freezeChangedReadings(data.readings, next.readings, market);
    const saved = { ...next, readings };
    await onSave(saved);
    return saved;
  }
  return <>
    <div className="page-heading portfolio-heading">
      <h1>{tab === 'dashboard' ? 'Mon patrimoine' : tab === 'stocks' ? 'Portefeuille boursier' : tab === 'scpi' ? 'Portefeuille SCPI' : tab === 'simulation' ? 'Simulation' : 'Mon portefeuille'}<span>.</span></h1>
      <div className="portfolio-heading-actions">
        {tab === 'simulation' && <div className="simulation-heading-slot" ref={setSimulationActions} />}
        {tab === 'scpi' && <a className="sync-market-button" href="https://app.louveinvest.com/dashboard" target="_blank" rel="noopener noreferrer">Louve Invest <span aria-hidden="true">↗</span></a>}
        {tab === 'stocks' && <a className="sync-market-button" href="https://www.google.com/finance/portfolio/4f945656-361f-46ac-abdc-72abd01ed02c?tab=insights&window=1M" target="_blank" rel="noopener noreferrer">Google Finance <span aria-hidden="true">↗</span></a>}
        {tab !== 'simulation' && <PortfolioStatus updatedAt={data.updatedAt} syncing={syncing} onSync={() => void synchronize()} hideSync={tab === 'scpi'} />}
      </div>
    </div>
    <SyncFeedback message={syncMessage} error={syncError} />
    {scpiPositions(data).some(p => p.scpiRateUnavailable) && <p className="notice" role="status">Certains taux SCPI sont indisponibles : les estimations de revenus et de rendement sont incomplètes.</p>}
    {sidebar && createPortal(<div className={tab === 'editor' ? undefined : 'goals-desktop-only'}><SidebarGoals data={data} market={market} openRequest={goalsRequest} onSave={async next => { await save(next); }} /></div>, sidebar)}
    {tab === 'editor' && <div className="market-toolbar"><PushNotifications /></div>}
    {tab === 'dashboard' ? <Dashboard data={data} market={market} onEditAllocation={() => setGoalsRequest(value => value + 1)} /> : tab === 'stocks' ? <StockPortfolio data={data} market={market} /> : tab === 'scpi' ? <ScpiPortfolio data={data} onSave={onSave} /> : tab === 'simulation' ? market.loading ? <section className="panel empty">Chargement des taux du portefeuille…</section> : <Simulation data={data} market={market} owner={owner} onSave={onSave} actions={simulationActions} /> : <Editor data={data} onSave={save} market={market} />}
    {tab !== 'scpi' && tab !== 'simulation' && <div className={`market-toolbar${tab === 'dashboard' ? ' market-toolbar-dashboard' : ''}`}><span>{tab === 'stocks' ? 'Marché · Yahoo Finance · cours de clôture ajustés · sans conversion EUR' : 'Marché · Yahoo Finance · performance sur 365 jours, distributions réinvesties · sans conversion EUR'}</span></div>}
  </>;
}
