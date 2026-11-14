'use client';
import { useEffect, useState } from 'react';
import { Plus, Save, Trash2, Check, Download, ChevronDown, ChevronRight } from 'lucide-react';
import { categories, currentSnapshot, euro, summarize, validatePortfolio, type Portfolio, type Reading, type Position } from '@/lib/portfolio';
import { isKnownMarketCode, livePositions, type MarketData } from '@/lib/market';
import { errorMessage } from '@/lib/errors';
const collapsedCategoriesKey = 'financial:editor:collapsed-categories';
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const blank = (positions: Position[] = []): Reading => ({ id: crypto.randomUUID(), date: today(), projected: false, total: summarize(positions).total, positions: structuredClone(positions) });
export default function Editor({ data, onSave, market = { returns: [], statuses: [] } }: { data: Portfolio; onSave: (data: Portfolio) => Promise<void>; market?: MarketData }) {
  const latest = currentSnapshot(data);
  const [draft, setDraft] = useState<Reading>(() => ({ ...blank(latest?.positions), categoryRates: latest?.categoryRates }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => new Set());
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(collapsedCategoriesKey) ?? '[]');
      if (Array.isArray(stored) && stored.every(category => typeof category === 'string')) {
        setCollapsedCategories(new Set(stored));
      }
    } catch { /* Le stockage peut être indisponible ou contenir une valeur invalide. */ }
    setPreferencesLoaded(true);
  }, []);
  useEffect(() => {
    if (!preferencesLoaded) return;
    try {
      localStorage.setItem(collapsedCategoriesKey, JSON.stringify([...collapsedCategories]));
    } catch { /* Le repli reste utilisable même sans stockage local. */ }
  }, [collapsedCategories, preferencesLoaded]);
  const [newPositionId, setNewPositionId] = useState<string | null>(null);
  const [frozenCategoryOrder, setFrozenCategoryOrder] = useState<string[] | null>(null);
  function addPosition() {
    const id = crypto.randomUUID();
    setNewPositionId(id);
    setCollapsedCategories(previous => {
      const next = new Set(previous);
      next.delete('Nouveau placement');
      return next;
    });
    setDraft(previous => ({ ...previous, positions: [...previous.positions, { id, name: '', category: 'SCPI', envelope: 'Direct', code: '', amount: 0, rate: 0 }] }));
  }
  function toggleCategory(category: string) {
    setCollapsedCategories(previous => {
      const next = new Set(previous);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }
  const currentRates = livePositions(draft, market);
  const notices = [...currentRates.referenceNotes, ...currentRates.warnings];
  const envelopes = [...new Set(['Direct', 'PEA', 'CTO', 'Assurance vie', ...data.readings.flatMap(r => r.positions.map(p => p.envelope)), ...draft.positions.map(p => p.envelope)])].filter(envelope => Boolean(envelope) && !['PEA-PME', 'PER'].includes(envelope));
  const positionGroups = [...new Set(draft.positions.filter(p => p.id !== newPositionId).map(p => p.category))].map(category => ({
    category,
    entries: draft.positions.map((position, index) => ({ position, index })).filter(({ position }) => position.category === category && position.id !== newPositionId),
  })).sort((a, b) =>
    frozenCategoryOrder
      ? frozenCategoryOrder.indexOf(a.category) - frozenCategoryOrder.indexOf(b.category)
      : b.entries.reduce((total, { position }) => total + (Number.isFinite(position.amount) ? position.amount : 0), 0)
    - a.entries.reduce((total, { position }) => total + (Number.isFinite(position.amount) ? position.amount : 0), 0)
  );
  const newEntries = draft.positions.map((position, index) => ({ position, index })).filter(({ position }) => position.id === newPositionId);
  const displayedGroups = [...positionGroups, ...(newEntries.length ? [{ category: 'Nouveau placement', entries: newEntries }] : [])];
  function updatePosition(index: number, change: Partial<Position>) {
    const positions = draft.positions.map((p, i) => i === index ? {
      ...p, ...change,
      ...(change.code !== undefined ? { rateSource: isKnownMarketCode(change.code) ? 'market' as const : 'manual' as const } : {}),
    } : p);
    setDraft({ ...draft, positions, total: summarize(positions).total });
  }
  async function persist(next: Portfolio, success: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      validatePortfolio(next);
      await onSave(next);
      setMessage(success);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  function saveCurrentPortfolio() {
    const date = today();
    const existing = data.readings.find(r => r.date === date);
    const reading: Reading = { ...draft, id: existing?.id ?? crypto.randomUUID(), date, projected: false };
    void persist({ ...data, readings: [...data.readings.filter(r => r.date !== date), reading] }, 'Portefeuille du jour enregistré.');
  }
  function exportBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `financial-prive-${today()}.json`; a.click(); URL.revokeObjectURL(url);
  }
  return <><div className="page-heading"><div><h1>Mon portefeuille<span>.</span></h1></div><button className="button secondary" onClick={exportBackup}><Download size={16} />Exporter une sauvegarde</button></div>
    {error && <div className="alert" role="alert">{error}</div>}{message && <div className="notice" role="status"><Check size={16} />{message}</div>}
    <section className="panel editor">
    <p className="muted">Saisir un ISIN ou un code de cotation reconnu active le suivi marché. Le cours ajusté Yahoo est une approximation de rendement avec distributions réinvesties, dépendante de la qualité de la source. Si ses données manquent, le taux du relevé est conservé avec un avertissement.</p>
    {notices.length > 0 && <div className="notice"><ul>{notices.map(w => <li key={w}>{w}</li>)}</ul></div>}
    <div className="table-scroll"><table>
      <thead><tr><th>Placement</th><th>Classe d’actifs</th><th>Enveloppe</th><th>Code</th><th>Regroupement</th><th>Montant (€)</th><th>Source du taux</th><th>Taux annuel (%)</th><th /></tr></thead>
      {displayedGroups.map(({ category, entries }) => <tbody key={category}>
        <tr className="editor-category"><th scope="rowgroup" colSpan={9}><button type="button" className="editor-category-toggle" aria-expanded={!collapsedCategories.has(category)} onClick={() => toggleCategory(category)}><span>{collapsedCategories.has(category) ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}{category || 'Sans classe d’actifs'}</span><span>{euro(entries.reduce((total, { position }) => total + (Number.isFinite(position.amount) ? position.amount : 0), 0))}</span></button></th></tr>
        {!collapsedCategories.has(category) && entries.map(({ position: p, index: i }) => <tr key={p.id}>
        <td><input aria-label={`Nom ${i + 1}`} autoFocus={p.id === newPositionId} value={p.name} onChange={e => updatePosition(i, { name: e.target.value })} /></td>
        <td><select aria-label={`Catégorie ${i + 1}`} value={p.category} onChange={e => updatePosition(i, { category: e.target.value })}>{[...new Set([...categories, p.category])].filter(Boolean).map(c => <option key={c}>{c}</option>)}</select></td>
        <td><select aria-label={`Enveloppe ${i + 1}`} value={p.envelope} onChange={e => updatePosition(i, { envelope: e.target.value })}>{envelopes.map(envelope => <option key={envelope}>{envelope}</option>)}</select></td>
        <td><input aria-label={`Code ${i + 1}`} placeholder="ISIN ou TICKER" value={p.code} onChange={e => updatePosition(i, { code: e.target.value })} /></td>
        <td><input aria-label={`Regroupement ${i + 1}`} placeholder="Facultatif" value={p.group || ''} onChange={e => updatePosition(i, { group: e.target.value })} /></td>
        <td><input aria-label={`Montant ${i + 1}`} type="number" step="0.01" min="0" value={Number.isFinite(p.amount) ? p.amount : ''} onFocus={() => setFrozenCategoryOrder(positionGroups.map(group => group.category))} onBlur={() => setFrozenCategoryOrder(null)} onChange={e => updatePosition(i, { amount: e.target.value === '' ? NaN : Number(e.target.value) })} /></td>
        <td><select aria-label={`Source du taux ${i + 1}`} value={p.rateSource || 'manual'} onChange={e => updatePosition(i, { rateSource: e.target.value as 'manual' | 'market' })}><option value="manual">Manuel</option><option value="market" disabled={!isKnownMarketCode(p.code)}>Marché · 365 jours</option></select></td>
        <td><input aria-label={`Taux ${i + 1}`} type="number" step="any" readOnly={p.rateSource === 'market'} title={p.rateSource === 'market' ? 'Dernière performance disponible, ou taux de repli du relevé' : 'Taux annuel manuel'} value={Number.isFinite(currentRates.positions[i]?.rate) ? currentRates.positions[i].rate : ''} onChange={e => updatePosition(i, { rate: e.target.value === '' ? NaN : Number(e.target.value) })} /></td>
        <td><button className="icon-button" aria-label={`Supprimer ${p.name || 'placement'}`} onClick={() => { const positions = draft.positions.filter((_, j) => i !== j); setDraft({ ...draft, positions, total: summarize(positions).total }); }}><Trash2 size={16} /></button></td>
      </tr>)}</tbody>)}
    </table></div>
    <button type="button" className="text-button" onClick={addPosition}><Plus size={16} />Ajouter un placement</button>
    {!draft.positions.length && <label className="standalone">Total actuel du portefeuille (sans détail)<input type="number" min="0" step="0.01" value={draft.total} onChange={e => setDraft({ ...draft, total: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>}
    <div className="editor-footer"><strong>Total : {euro(draft.total)}</strong><div className="actions"><button className="button" disabled={busy} onClick={saveCurrentPortfolio}><Save size={16} />{busy ? 'Enregistrement…' : 'Enregistrer mon portefeuille'}</button></div></div></section>
  </>;
}
