'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil, Save, Target, X } from 'lucide-react';
import { aggregate, allocationCategories, allocationScore, currentAllocationTarget, currentSnapshot, displayedRate, euro, normalizeGoals, percent, percent1, summarize, validatePortfolio, type AllocationTarget, type Portfolio } from '@/lib/portfolio';
import { livePositions, type MarketData } from '@/lib/market';
import { errorMessage } from '@/lib/errors';

function Goal({ label, value, target }: { label: string; value: number; target: number }) {
  return <div className="goal"><div><span>{label}</span><b>{Math.round(value / target * 100)} %</b></div><progress aria-label={label} max={target} value={Math.max(0, value)} /><div><strong>{euro(value)}</strong><small>sur {euro(target)}</small></div></div>;
}

export default function SidebarGoals({ data, market, onSave, openRequest = 0 }: { data: Portfolio; market: MarketData; onSave: (data: Portfolio) => Promise<void>; openRequest?: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const allocationDetails = useRef<HTMLDetailsElement>(null);
  const [goals, setGoals] = useState(data.goals);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [allocation, setAllocation] = useState<AllocationTarget>(data.allocationTarget ?? {});
  const [allocationEnabled, setAllocationEnabled] = useState(!!data.allocationTarget);
  const names = allocationCategories(data);
  const allocationTotal = Object.values(allocation).reduce((sum, value) => sum + value, 0);
  const allocationValid = Object.values(allocation).every(value => Number.isFinite(value) && value >= 0 && value <= 100) && Math.abs(allocationTotal - 100) < 0.000001;
  function open() {
    setGoals({ ...data.goals });
    setAllocation(Object.fromEntries(names.map(name => [name, data.allocationTarget?.[name] ?? 0])));
    setAllocationEnabled(!!data.allocationTarget);
    setError('');
    if (allocationDetails.current) allocationDetails.current.open = false;
    dialog.current?.showModal();
  }
  useEffect(() => { if (openRequest) open(); }, [openRequest]);
  const detailed = currentSnapshot(data);
  const live = livePositions(detailed, market);
  const stats = summarize(live.positions, live.categoryRates);
  const score = data.allocationTarget ? allocationScore(aggregate(live.positions, 'category'), data.allocationTarget) : null;
  // Même base que la tuile « Équivalent mensuel » du dashboard.
  const monthly = stats.total * displayedRate(stats.rate) / 100 / 12;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const next = { ...data, goals: normalizeGoals(goals) };
      if (allocationEnabled) next.allocationTarget = allocation;
      else delete next.allocationTarget;
      validatePortfolio(next);
      await onSave(next);
      dialog.current?.close();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <>
    <section className="sidebar-goals" aria-labelledby="sidebar-goals-title"><h2 id="sidebar-goals-title"><Target size={17} />Mes objectifs<button className="icon-button goals-edit" aria-label="Modifier mes objectifs" title="Modifier mes objectifs" onClick={open}><Pencil size={14} /></button></h2><Goal label="Patrimoine" value={stats.total} target={data.goals.capital} /><Goal label="Gain mensuel" value={monthly} target={data.goals.monthly} />
      <div className="goal allocation-score">
        <div><span>Allocation cible</span><b>{score === null ? '—' : `${Math.round(score)} %`}</b></div>
        <progress aria-label="Proximité de l’allocation cible" max={100} value={score ?? 0} />
        {score !== null && <div><strong>{percent1(100 - score).replace(' %', ' pts')}</strong><small>à réallouer</small></div>}
        {score === null && <div><small>{!data.allocationTarget ? 'Aucune cible définie' : 'Aucun capital à comparer'}</small>{!data.allocationTarget && <button type="button" className="allocation-edit" onClick={open}>Définir ↗</button>}</div>}
      </div>
    </section>
    {createPortal(<dialog ref={dialog} className="panel goals-modal" aria-labelledby="goals-modal-title" onCancel={e => { if (busy) e.preventDefault(); }}>
      <button type="button" className="modal-close icon-button" disabled={busy} aria-label="Fermer les objectifs" onClick={() => dialog.current?.close()}><X size={20} /></button>
      <h2 id="goals-modal-title">Mes objectifs</h2>
      <form onSubmit={e => void save(e)}>
        <div className="goals-fields">{(['capital', 'monthly'] as const).map((key, i) => <label key={key}>{['Patrimoine cible (€)', 'Gain mensuel cible (€)'][i]}<input type="number" min="1" step="any" required disabled={busy} value={Number.isNaN(goals[key]) ? '' : goals[key]} onChange={e => setGoals(normalizeGoals({ ...goals, [key === 'monthly' ? 'annual' : key]: e.target.valueAsNumber * (key === 'monthly' ? 12 : 1) }))} /></label>)}</div>
        <details ref={allocationDetails} className="allocation-editor allocation-accordion">
          <summary><span>Allocation cible</span><small>{allocationEnabled ? 'Activée' : 'Non définie'}</small></summary>
          <div className="allocation-editor-heading"><label><input type="checkbox" checked={allocationEnabled} disabled={busy || !names.length} onChange={e => setAllocationEnabled(e.target.checked)} />Activer l’allocation cible</label></div>
          <p>Répartis 100 % entre tes classes d’actifs. Une cible à 0 % reste visible dans le comparatif.</p>
          {!names.length && <p>Ajoute d’abord des placements pour définir tes classes d’actifs.</p>}
          {allocationEnabled && <>
            <button type="button" className="allocation-edit" disabled={busy || stats.total <= 0} onClick={() => { const actual = currentAllocationTarget(aggregate(live.positions, 'category'), 0); setAllocation(Object.fromEntries(names.map(name => [name, actual[name] ?? 0]))); }}>Partir de mon allocation actuelle ↗</button>
            <div className="allocation-inputs">{names.map(name => <label key={name}><span>{name}</span><div><input aria-label={`Cible ${name} (%)`} type="number" min="0" max="100" step="1" required disabled={busy} value={Number.isNaN(allocation[name]) ? '' : allocation[name] ?? 0} onChange={e => setAllocation({ ...allocation, [name]: e.target.valueAsNumber })} /><span>%</span></div></label>)}</div>
            <div className={`allocation-total ${allocationValid ? 'positive' : ''}`} role="status"><span>Total de l’allocation</span><strong>{Number.isFinite(allocationTotal) ? percent(allocationTotal) : '—'} / 100 %</strong></div>
            {!allocationValid && <p className="allocation-note">Le total doit être de 100 % pour enregistrer.</p>}
          </>}
        </details>
        {error && <p className="negative" role="alert">{error}</p>}
        <div className="actions"><button type="button" className="button secondary" disabled={busy} onClick={() => dialog.current?.close()}>Annuler</button><button type="submit" className="button" disabled={busy || (allocationEnabled && !allocationValid)}><Save size={16} />{busy ? 'Enregistrement…' : 'Enregistrer'}</button></div>
      </form>
    </dialog>, document.body)}
  </>;
}
