'use client';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { loadMarketData } from '@/lib/supabase';
import { freezeChangedReadings, type MarketData } from '@/lib/market';
import type { Portfolio } from '@/lib/portfolio';
import Dashboard from './Dashboard';
import Editor from './Editor';

export default function MarketPanel({ data, onSave, demo, tab }: { data: Portfolio; onSave: (data: Portfolio) => Promise<void>; demo: boolean; tab: 'dashboard' | 'editor' }) {
  const [market, setMarket] = useState<MarketData>({ returns: [], statuses: [] });
  const [loading, setLoading] = useState(false);
  async function refresh() {
    if (demo) return;
    setLoading(true);
    try { setMarket(await loadMarketData()); }
    catch { setMarket({ returns: [], statuses: [], error: 'Lecture des données de marché impossible ; taux des relevés conservés.' }); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (demo) return;
    let active = true;
    async function update() {
      try { const result = await loadMarketData(); if (active) setMarket(result); }
      catch { if (active) setMarket({ returns: [], statuses: [], error: 'Lecture des données de marché impossible.' }); }
    }
    void update();
    const timer = window.setInterval(() => void update(), 5 * 60 * 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [demo]);
  async function save(next: Portfolio) {
    // Figer les cours connus uniquement lors de la validation d'un relevé modifié.
    const readings = freezeChangedReadings(data.readings, next.readings, market);
    await onSave({ ...next, readings });
  }
  return <>
    {!demo && <div className="market-toolbar"><span>Marché · Yahoo Finance · performance sur 365 jours, distributions réinvesties · sans conversion EUR</span><button className="button secondary small" disabled={loading} onClick={() => void refresh()}><RefreshCw size={13} />{loading ? 'Lecture…' : 'Relire les dernières données'}</button></div>}
    {tab === 'dashboard' ? <Dashboard data={data} market={market} /> : <Editor data={data} onSave={save} demo={demo} market={market} />}
  </>;
}
