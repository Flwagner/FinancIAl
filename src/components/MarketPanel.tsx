'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadMarketData } from '@/lib/supabase';
import { freezeChangedReadings, type MarketData } from '@/lib/market';
import type { Portfolio } from '@/lib/portfolio';
import Dashboard from './Dashboard';
import Editor from './Editor';
import SidebarGoals from './SidebarGoals';

export default function MarketPanel({ data, onSave, tab, sidebar }: { data: Portfolio; onSave: (data: Portfolio) => Promise<void>; tab: 'dashboard' | 'editor'; sidebar: HTMLDivElement | null }) {
  const [market, setMarket] = useState<MarketData>({ returns: [], statuses: [], loading: true });
  useEffect(() => {
    let active = true;
    async function update() {
      try { const result = await loadMarketData(); if (active) setMarket(result); }
      catch { if (active) setMarket({ returns: [], statuses: [], error: 'Lecture des données de marché impossible.' }); }
    }
    void update();
    const timer = window.setInterval(() => void update(), 5 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  async function save(next: Portfolio) {
    // Figer les cours connus uniquement lors de la validation d'un relevé modifié.
    const readings = freezeChangedReadings(data.readings, next.readings, market);
    await onSave({ ...next, readings });
  }
  return <>
    {sidebar && createPortal(<SidebarGoals data={data} market={market} onSave={save} />, sidebar)}
    <div className="market-toolbar"><span>Marché · Yahoo Finance · performance sur 365 jours, distributions réinvesties · sans conversion EUR</span></div>
    {tab === 'dashboard' ? <Dashboard data={data} market={market} /> : <Editor data={data} onSave={save} market={market} />}
  </>;
}
