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
import PortfolioStatus from './PortfolioStatus';
import SyncFeedback from './SyncFeedback';
import { marketSyncMessage } from '@/lib/manual-market-sync';

export default function MarketPanel({ data, onSave, tab, sidebar }: { data: Portfolio; onSave: (data: Portfolio) => Promise<void>; tab: 'dashboard' | 'editor' | 'stocks'; sidebar: HTMLDivElement | null }) {
  const [market, setMarket] = useState<MarketData>({ returns: [], statuses: [], loading: true });
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [syncError, setSyncError] = useState(false);
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
    const timer = window.setInterval(() => void update(), 5 * 60 * 1000);
    const onFocus = () => { void update(); };
    window.addEventListener('focus', onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
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
      <h1>{tab === 'dashboard' ? 'Mon patrimoine' : tab === 'stocks' ? 'Portefeuille boursier' : 'Mon portefeuille'}<span>.</span></h1>
      <PortfolioStatus updatedAt={data.updatedAt} syncing={syncing} onSync={() => void synchronize()} />
    </div>
    <SyncFeedback message={syncMessage} error={syncError} />
    {sidebar && createPortal(<div className={tab === 'editor' ? undefined : 'goals-desktop-only'}><SidebarGoals data={data} market={market} onSave={async next => { await save(next); }} /></div>, sidebar)}
    {tab === 'editor' && <div className="market-toolbar"><PushNotifications /></div>}
    {tab === 'dashboard' ? <Dashboard data={data} market={market} /> : tab === 'stocks' ? <StockPortfolio data={data} market={market} /> : <Editor data={data} onSave={save} market={market} />}
    <div className={`market-toolbar${tab === 'dashboard' ? ' market-toolbar-dashboard' : ''}`}><span>{tab === 'stocks' ? 'Marché · Yahoo Finance · cours de clôture ajustés · sans conversion EUR' : 'Marché · Yahoo Finance · performance sur 365 jours, distributions réinvesties · sans conversion EUR'}</span></div>
  </>;
}
