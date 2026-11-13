'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadMarketData } from '@/lib/supabase';
import { freezeChangedReadings, type MarketData } from '@/lib/market';
import type { Portfolio } from '@/lib/portfolio';
import Dashboard from './Dashboard';
import Editor from './Editor';
import SidebarGoals from './SidebarGoals';
import PushNotifications from './PushNotifications';

export default function MarketPanel({ data, onSave, tab, sidebar }: { data: Portfolio; onSave: (data: Portfolio) => Promise<void>; tab: 'dashboard' | 'editor'; sidebar: HTMLDivElement | null }) {
  const [market, setMarket] = useState<MarketData>({ returns: [], statuses: [], loading: true });
  useEffect(() => {
    let active = true;
    let request = 0;
    async function update() {
      const revision = ++request;
      try { const result = await loadMarketData(); if (active && revision === request) setMarket(result); }
      catch { if (active && revision === request) setMarket({ returns: [], statuses: [], error: 'Lecture des données de marché impossible.' }); }
    }
    void update();
    const timer = window.setInterval(() => void update(), 5 * 60 * 1000);
    const onFocus = () => { void update(); };
    window.addEventListener('focus', onFocus);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);
  async function save(next: Portfolio) {
    // Figer les cours connus uniquement lors de la validation d'un relevé modifié.
    const readings = freezeChangedReadings(data.readings, next.readings, market);
    await onSave({ ...next, readings });
  }
  return <>
    {sidebar && createPortal(<div className={tab === 'dashboard' ? 'sidebar-goals-dashboard' : undefined}><SidebarGoals data={data} market={market} onSave={save} /></div>, sidebar)}
    <div className={`market-toolbar${tab === 'dashboard' ? ' market-toolbar-dashboard' : ''}`}><span>Marché · Yahoo Finance · performance sur 365 jours, distributions réinvesties · sans conversion EUR</span><PushNotifications /></div>
    {tab === 'dashboard' ? <Dashboard data={data} market={market} /> : <Editor data={data} onSave={save} market={market} />}
  </>;
}
