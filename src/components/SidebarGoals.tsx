'use client';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Save, Target, X } from 'lucide-react';
import { currentSnapshot, displayedRate, euro, normalizeGoals, summarize, validatePortfolio, type Portfolio } from '@/lib/portfolio';
import { livePositions, type MarketData } from '@/lib/market';
import { errorMessage } from '@/lib/errors';

function Goal({ label, value, target }: { label: string; value: number; target: number }) {
  return <div className="goal"><div><span>{label}</span><b>{Math.round(value / target * 100)} %</b></div><progress aria-label={label} max={target} value={Math.max(0, value)} /><div><strong>{euro(value)}</strong><small>sur {euro(target)}</small></div></div>;
}

export default function SidebarGoals({ data, market, onSave }: { data: Portfolio; market: MarketData; onSave: (data: Portfolio) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [goals, setGoals] = useState(data.goals);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const detailed = currentSnapshot(data);
  const live = livePositions(detailed, market);
  const stats = summarize(live.positions, live.categoryRates);
  // Même base que la tuile « Équivalent mensuel » du dashboard.
  const monthly = stats.total * displayedRate(stats.rate) / 100 / 12;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const next = { ...data, goals: normalizeGoals(goals) };
      validatePortfolio(next);
      await onSave(next);
      dialog.current?.close();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <>
    <section className="sidebar-goals" aria-labelledby="sidebar-goals-title"><h2 id="sidebar-goals-title"><Target size={17} />Mes objectifs<button className="icon-button goals-edit" aria-label="Modifier mes objectifs" title="Modifier mes objectifs" onClick={() => { setGoals({ ...data.goals }); setError(''); dialog.current?.showModal(); }}><Pencil size={14} /></button></h2><Goal label="Patrimoine" value={stats.total} target={data.goals.capital} /><Goal label="Gain mensuel" value={monthly} target={data.goals.monthly} /></section>
    {createPortal(<dialog ref={dialog} className="panel goals-modal" aria-labelledby="goals-modal-title" onCancel={e => { if (busy) e.preventDefault(); }}><button type="button" className="modal-close icon-button" disabled={busy} aria-label="Fermer les objectifs" onClick={() => dialog.current?.close()}><X size={20} /></button><h2 id="goals-modal-title">Mes objectifs</h2><form onSubmit={e => void save(e)}><div className="goals-fields">{(['capital', 'monthly'] as const).map((key, i) => <label key={key}>{['Patrimoine cible (€)', 'Gain mensuel cible (€)'][i]}<input type="number" min="1" step="any" required disabled={busy} value={Number.isNaN(goals[key]) ? '' : goals[key]} onChange={e => setGoals(normalizeGoals({ ...goals, [key === 'monthly' ? 'annual' : key]: e.target.valueAsNumber * (key === 'monthly' ? 12 : 1) }))} /></label>)}</div>{error && <p className="negative" role="alert">{error}</p>}<div className="actions"><button type="button" className="button secondary" disabled={busy} onClick={() => dialog.current?.close()}>Annuler</button><button type="submit" className="button" disabled={busy}><Save size={16} />{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div></form></dialog>, document.body)}
  </>;
}
