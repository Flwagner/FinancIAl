'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, Save, Trash2, Check, ChevronDown, ChevronRight, LockKeyhole } from 'lucide-react';
import { categories, currentSnapshot, euro, freezeCurrentMonth, monthlyReadings, saveCurrentReading, summarize, validatePortfolio, type Portfolio, type Reading, type Position } from '@/lib/portfolio';
import { isKnownMarketCode, livePositions, type MarketData } from '@/lib/market';
import { errorMessage } from '@/lib/errors';
import { readingsFingerprint } from '@/lib/portfolio-save';
import { latestScpi, scpiSource, setScpiSource } from '@/lib/scpi';
const collapsedCategoriesKey = 'financial:editor:collapsed-categories';
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const blank = (positions: Position[] = []): Reading => ({ id: crypto.randomUUID(), date: today(), projected: false, total: summarize(positions).total, positions: structuredClone(positions).map(p => p.category === 'SCPI' && p.scpiId ? { ...p, amountSource: scpiSource(p), rateSource: scpiSource(p) } : p) });
export default function Editor({ data, onSave, market = { returns: [], statuses: [] } }: { data: Portfolio; onSave: (data: Portfolio) => Promise<Portfolio | void>; market?: MarketData }) {
  const latest = currentSnapshot(data);
  const [draft, setDraft] = useState<Reading>(() => ({ ...blank(latest?.positions), categoryRates: latest?.categoryRates }));
  const draftSource = useRef(readingsFingerprint(data.readings));
  const staleDraft = draftSource.current !== readingsFingerprint(data.readings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const freezeDialog = useRef<HTMLDialogElement>(null);
  const [capture, setCapture] = useState<{ date: string; capturedAt: string; total: number } | null>(null);
  const capturedMonth = capture ? new Date(`${capture.date}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) : '';
  const previousMonthly = capture ? monthlyReadings(data.readings, data.monthlySnapshots).find(r => !r.projected && r.date.slice(0, 7) === capture.date.slice(0, 7)) : undefined;
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
      ...(change.code !== undefined && change.code !== p.code ? p.category === 'SCPI' ? { rateSource: 'manual' as const, amountSource: 'manual' as const } : { rateSource: isKnownMarketCode(change.code) ? 'market' as const : 'manual' as const } : {}),
    } : p);
    setDraft({ ...draft, positions, total: summarize(positions).total });
  }
  async function persist(next: Portfolio, success: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      validatePortfolio(next);
      const saved = await onSave(next);
      draftSource.current = readingsFingerprint((saved ?? next).readings);
      setMessage(success);
      return true;
    } catch (e) { setError(errorMessage(e)); return false; } finally { setBusy(false); }
  }
  function saveCurrentPortfolio() {
    if (staleDraft) { setError('Les relevés ont changé depuis le début de ta saisie. Recharge le brouillon avant de sauvegarder.'); return; }
    const date = today();
    void persist(saveCurrentReading(data, draft, date, crypto.randomUUID()), 'Portefeuille du jour enregistré. Les montants mensuels figés sont conservés.');
  }
  function previewFreeze() {
    setError('');
    if (staleDraft) { setError('Les relevés ont changé. Recharge le brouillon avant de figer un montant.'); return; }
    try {
      validatePortfolio({ ...data, readings: [draft] });
      setCapture({ date: today(), capturedAt: new Date().toISOString(), total: draft.total });
      freezeDialog.current?.showModal();
    } catch (e) { setError(errorMessage(e)); }
  }
  async function confirmFreeze() {
    if (!capture || busy) return;
    if (staleDraft) { setError('Les relevés ont changé. Annule puis recharge le brouillon avant de figer le mois.'); return; }
    const saved = await persist(freezeCurrentMonth(data, capture.total, capture.date, capture.capturedAt), `Montant de ${capturedMonth} figé : ${euro(capture.total)}.`);
    if (saved) freezeDialog.current?.close();
  }
  return <>
    {error && <div className="alert" role="alert">{error}</div>}{message && <div className="notice" role="status"><Check size={16} />{message}</div>}
    {staleDraft && <div className="notice" role="status">De nouveaux montants sont disponibles. Ton brouillon n’a pas été écrasé.
      <button type="button" className="text-button" onClick={() => {
        if (!window.confirm('Remplacer ton brouillon par les derniers montants enregistrés ?')) return;
        const current = currentSnapshot(data);
        setDraft({ ...blank(current?.positions), categoryRates: current?.categoryRates });
        draftSource.current = readingsFingerprint(data.readings); setError(''); setMessage('Brouillon rechargé.');
      }}>Recharger le brouillon</button></div>}
    <section className="panel editor">
    <p className="muted">Saisir un ISIN ou un code de cotation reconnu active le suivi marché. Le cours ajusté Yahoo est une approximation de rendement avec distributions réinvesties, dépendante de la qualité de la source. Si ses données manquent, le taux du relevé est conservé avec un avertissement.</p>
    {notices.length > 0 && <div className="notice"><ul>{notices.map(w => <li key={w}>{w}</li>)}</ul></div>}
    <div className="table-scroll"><table>
      <thead><tr><th>Placement</th><th>Classe d’actifs</th><th>Enveloppe</th><th>Code</th><th>Regroupement</th><th>Montant (€)</th><th>Taux annuel (%)</th><th>Source</th><th /></tr></thead>
      {displayedGroups.map(({ category, entries }) => <tbody key={category}>
        <tr className="editor-category"><th scope="rowgroup" colSpan={9}><button type="button" className="editor-category-toggle" aria-expanded={!collapsedCategories.has(category)} onClick={() => toggleCategory(category)}><span>{collapsedCategories.has(category) ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}{category || 'Sans classe d’actifs'}</span><span>{euro(entries.reduce((total, { position }) => total + (Number.isFinite(position.amount) ? position.amount : 0), 0))}</span></button></th></tr>
        {!collapsedCategories.has(category) && entries.map(({ position: p, index: i }) => <tr key={p.id}>
        <td><input aria-label={`Nom ${i + 1}`} autoFocus={p.id === newPositionId} value={p.name} onChange={e => updatePosition(i, { name: e.target.value })} /></td>
        <td><select aria-label={`Catégorie ${i + 1}`} value={p.category} onChange={e => updatePosition(i, { category: e.target.value })}>{[...new Set([...categories, p.category])].filter(Boolean).map(c => <option key={c}>{c}</option>)}</select></td>
        <td><select aria-label={`Enveloppe ${i + 1}`} value={p.envelope} onChange={e => updatePosition(i, { envelope: e.target.value })}>{envelopes.map(envelope => <option key={envelope}>{envelope}</option>)}</select></td>
        <td><input aria-label={`Code ${i + 1}`} placeholder="ISIN ou TICKER" value={p.code} onChange={e => updatePosition(i, { code: e.target.value })} /></td>
        <td><input aria-label={`Regroupement ${i + 1}`} placeholder="Facultatif" value={p.group || ''} onChange={e => updatePosition(i, { group: e.target.value })} /></td>
        <td><input aria-label={`Montant ${i + 1}`} type="number" step="0.01" min="0" readOnly={p.amountSource === 'louve'} value={Number.isFinite(p.amount) ? p.amount : ''} onFocus={() => setFrozenCategoryOrder(positionGroups.map(group => group.category))} onBlur={() => setFrozenCategoryOrder(null)} onChange={e => updatePosition(i, { amount: e.target.value === '' ? NaN : Number(e.target.value), ...(p.category === 'SCPI' ? { amountSource: 'manual' as const, rateSource: 'manual' as const } : {}) })} /></td>
        <td><input aria-label={`Taux ${i + 1}`} type="number" step="any" readOnly={p.rateSource === 'market' || p.rateSource === 'louve'} title={p.rateSource === 'market' ? 'Dernière performance disponible, ou taux de repli du relevé' : p.rateSource === 'louve' ? 'Taux du dernier import Louve : N−1 en priorité, fiche générale en repli' : 'Taux annuel manuel'} placeholder={p.scpiRateUnavailable ? 'Indisponible' : undefined} value={!p.scpiRateUnavailable && Number.isFinite(currentRates.positions[i]?.rate) ? currentRates.positions[i].rate : ''} onChange={e => updatePosition(i, { rate: e.target.value === '' ? NaN : Number(e.target.value), ...(p.category === 'SCPI' ? { scpiRateUnavailable: false, amountSource: 'manual' as const, rateSource: 'manual' as const } : {}) })} />{p.category === 'SCPI' && <small className="muted">{p.rateSource === 'louve' && latestScpi(data)?.positions.find(l => l.id === p.scpiId)?.rateReference === 'general' ? 'Fiche générale · année non précisée' : p.rateAsOf ? `Référence : ${p.rateAsOf.slice(0, 4)}` : 'Année non renseignée'}</small>}</td>
        <td><select aria-label={`Source ${i + 1}`} value={p.category === 'SCPI' ? scpiSource(p) : p.rateSource || 'manual'} onChange={e => {
          if (p.category === 'SCPI') {
            updatePosition(i, setScpiSource(p, e.target.value as 'manual' | 'louve', latestScpi(data)?.positions.find(l => l.id === p.scpiId)));
          } else updatePosition(i, { rateSource: e.target.value as 'manual' | 'market' });
        }}><option value="manual">Manuel</option>{p.category === 'SCPI' ? <option value="louve" disabled={latestScpi(data)?.positions.find(l => l.id === p.scpiId)?.rate === undefined}>Louve Invest</option> : <option value="market" disabled={!isKnownMarketCode(p.code)}>Marché · 365 jours</option>}</select></td>
        <td><button className="icon-button" aria-label={`Supprimer ${p.name || 'placement'}`} onClick={() => { const positions = draft.positions.filter((_, j) => i !== j); setDraft({ ...draft, positions, total: summarize(positions).total }); }}><Trash2 size={16} /></button></td>
      </tr>)}</tbody>)}
    </table></div>
    <button type="button" className="text-button" onClick={addPosition}><Plus size={16} />Ajouter un placement</button>
    {!draft.positions.length && <label className="standalone">Total actuel du portefeuille (sans détail)<input type="number" min="0" step="0.01" value={draft.total} onChange={e => setDraft({ ...draft, total: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>}
    <div className="editor-footer"><strong>Total : {euro(draft.total)}</strong><div className="actions"><button className="button secondary" disabled={busy} onClick={previewFreeze}><LockKeyhole size={16} />Figer le mois en cours</button><button className="button" disabled={busy} onClick={saveCurrentPortfolio}><Save size={16} />{busy ? 'Enregistrement…' : 'Enregistrer mon portefeuille'}</button></div></div></section>
    <dialog ref={freezeDialog} className="panel goals-modal" aria-labelledby="freeze-title" onCancel={e => { if (busy) e.preventDefault(); }}>
      <h2 id="freeze-title">Figer {capturedMonth}</h2>
      <p>Conserver <strong>{euro(capture?.total ?? 0)}</strong> pour {capturedMonth} dans le graphique « Évolution du patrimoine » ?</p>
      <p className="muted">Seul le total affiché est figé. Les prochaines modifications du portefeuille ne changeront pas ce montant. Le détail des placements reste à enregistrer séparément.</p>
      {previousMonthly && <p role="status">Un montant de <strong>{euro(previousMonthly.total)}</strong> existe déjà pour ce mois. Il sera remplacé après confirmation.</p>}
      {error && <p className="negative" role="alert">{error}</p>}
      <div className="actions"><button type="button" className="button secondary" autoFocus disabled={busy} onClick={() => freezeDialog.current?.close()}>Annuler</button><button type="button" className="button" disabled={busy} onClick={() => void confirmFreeze()}>{busy ? 'Enregistrement…' : previousMonthly ? 'Remplacer le montant figé' : 'Confirmer le montant'}</button></div>
    </dialog>
  </>;
}
