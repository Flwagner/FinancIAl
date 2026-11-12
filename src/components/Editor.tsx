'use client';
import { useState } from 'react';
import { Plus, Save, Trash2, Upload, Check, Download } from 'lucide-react';
import { categories, euro, summarize, validatePortfolio, type Portfolio, type Reading, type Position } from '@/lib/portfolio';
import { importSheets, type ImportFiles } from '@/lib/import';
import { livePositions, symbolForCode, type MarketData } from '@/lib/market';
const today = () => new Date().toISOString().slice(0, 10);
const blank = (positions: Position[] = []): Reading => ({ id: crypto.randomUUID(), date: today(), projected: false, total: summarize(positions).total, positions: structuredClone(positions) });
export default function Editor({ data, onSave, demo, market = { returns: [], statuses: [] } }: { data: Portfolio; onSave: (data: Portfolio) => Promise<void>; demo: boolean; market?: MarketData }) {
  const latest = [...data.readings].filter(r => r.positions.length).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  const [draft, setDraft] = useState<Reading>(() => ({ ...blank(latest?.positions), categoryRates: latest?.categoryRates }));
  const [goals, setGoals] = useState(data.goals);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [files, setFiles] = useState<Partial<ImportFiles>>({});
  const [detailDate, setDetailDate] = useState('');
  const [projectionFrom, setProjectionFrom] = useState('');
  const [preview, setPreview] = useState<ReturnType<typeof importSheets> | null>(null);
  const currentRates = livePositions(draft, market);
  function updatePosition(index: number, change: Partial<Position>) {
    const positions = draft.positions.map((p, i) => i === index ? {
      ...p, ...change,
      ...(change.code !== undefined ? { rateSource: symbolForCode(change.code) ? 'market' as const : 'manual' as const } : {}),
    } : p);
    setDraft({ ...draft, positions, total: summarize(positions).total });
  }
  async function persist(next: Portfolio, success: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      validatePortfolio(next);
      await onSave(next);
      if (next === preview?.data) {
        const imported = [...next.readings].filter(r => r.positions.length).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
        setDraft(imported ? structuredClone(imported) : blank());
        setGoals(next.goals);
        setPreview(null);
      }
      setMessage(success);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  function previewImport() {
    setError(''); setPreview(null);
    try {
      if (!files.evolution || !files.portfolio || !files.scpi || !files.actions) throw new Error('Sélectionne les quatre exports CSV.');
      setPreview(importSheets(files as ImportFiles, detailDate, projectionFrom));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  function exportBackup() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `financial-prive-${today()}.json`; a.click(); URL.revokeObjectURL(url);
  }
  return <><div className="page-heading"><div><div className="eyebrow">UNE HABITUDE SIMPLE, UNE VISION PLUS CLAIRE</div><h1>Mes relevés<span>.</span></h1><p>Mets à jour tes placements, à ton rythme.</p></div><button className="button secondary" onClick={exportBackup}><Download size={16} />Exporter une sauvegarde</button></div>
    {demo && <div className="notice">Mode démonstration : les modifications restent en mémoire et disparaissent au rechargement.</div>}
    {error && <div className="alert" role="alert">{error}</div>}{message && <div className="notice" role="status"><Check size={16} />{message}</div>}
    <section className="panel editor"><div className="panel-heading"><div><h2>Relevé périodique</h2><p>Reprends un relevé existant ou crée une nouvelle photographie.</p></div><button className="button secondary" onClick={() => { setDraft({ ...blank(latest?.positions), categoryRates: latest?.categoryRates }); setError(''); setMessage(''); }}><Plus size={16} />Nouveau relevé</button></div>
    <div className="form-grid"><label>Relevé à modifier<select value={data.readings.some(r => r.id === draft.id) ? draft.id : ''} onChange={e => { const r = data.readings.find(r => r.id === e.target.value); if (r) setDraft(structuredClone(r)); }}><option value="">Nouveau relevé</option>{[...data.readings].sort((a, b) => b.date.localeCompare(a.date)).map(r => <option key={r.id} value={r.id}>{r.date} · {r.projected ? 'Projection' : 'Réel'} · {euro(r.total)}</option>)}</select></label><label>Date du relevé<input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} required /></label><label>Nature<select value={draft.projected ? 'projection' : 'actual'} onChange={e => setDraft({ ...draft, projected: e.target.value === 'projection' })}><option value="actual">Relevé réel</option><option value="projection">Projection (non réalisée)</option></select></label></div>
    <p className="muted">Un code reconnu active le rendement automatique. En mode marché, la performance inclut les distributions réinvesties ; aucun dividende manuel à ajouter. Le taux du relevé sert de repli si les données sont absentes.</p>
    <div className="table-scroll"><table>
      <thead><tr><th>Placement</th><th>Classe d’actifs</th><th>Enveloppe</th><th>Code</th><th>Regroupement</th><th>Montant (€)</th><th>Source du taux</th><th>Taux annuel (%)</th><th /></tr></thead>
      <tbody>{draft.positions.map((p, i) => <tr key={p.id}>
        <td><input aria-label={`Nom ${i + 1}`} value={p.name} onChange={e => updatePosition(i, { name: e.target.value })} /></td>
        <td><select aria-label={`Catégorie ${i + 1}`} value={p.category} onChange={e => updatePosition(i, { category: e.target.value })}>{[...new Set([...categories, p.category])].filter(Boolean).map(c => <option key={c}>{c}</option>)}</select></td>
        <td><input aria-label={`Enveloppe ${i + 1}`} value={p.envelope} onChange={e => updatePosition(i, { envelope: e.target.value })} /></td>
        <td><input aria-label={`Code ${i + 1}`} placeholder="EPA:WPEA" value={p.code} onChange={e => updatePosition(i, { code: e.target.value })} /></td>
        <td><input aria-label={`Regroupement ${i + 1}`} placeholder="Facultatif" value={p.group || ''} onChange={e => updatePosition(i, { group: e.target.value })} /></td>
        <td><input aria-label={`Montant ${i + 1}`} type="number" step="0.01" min="0" value={Number.isFinite(p.amount) ? p.amount : ''} onChange={e => updatePosition(i, { amount: e.target.value === '' ? NaN : Number(e.target.value) })} /></td>
        <td><select aria-label={`Source du taux ${i + 1}`} value={p.rateSource || 'manual'} onChange={e => updatePosition(i, { rateSource: e.target.value as 'manual' | 'market' })}><option value="manual">Manuel</option><option value="market" disabled={!symbolForCode(p.code)}>Marché · 365 jours</option></select></td>
        <td><input aria-label={`Taux ${i + 1}`} type="number" step="any" readOnly={p.rateSource === 'market'} title={p.rateSource === 'market' ? 'Dernière performance disponible, ou taux de repli du relevé' : 'Taux annuel manuel'} value={Number.isFinite(currentRates.positions[i]?.rate) ? currentRates.positions[i].rate : ''} onChange={e => updatePosition(i, { rate: e.target.value === '' ? NaN : Number(e.target.value) })} /></td>
        <td><button className="icon-button" aria-label={`Supprimer ${p.name || 'placement'}`} onClick={() => { const positions = draft.positions.filter((_, j) => i !== j); setDraft({ ...draft, positions, total: summarize(positions).total }); }}><Trash2 size={16} /></button></td>
      </tr>)}</tbody>
    </table></div>
    {currentRates.warnings.length > 0 && <div className="notice"><ul>{currentRates.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
    <button className="text-button" onClick={() => setDraft({ ...draft, positions: [...draft.positions, { id: crypto.randomUUID(), name: '', category: 'SCPI', envelope: 'Direct', code: '', amount: 0, rate: 0 }] })}><Plus size={16} />Ajouter un placement</button>
    {!draft.positions.length && <label className="standalone">Total global (historique ou projection sans détail)<input type="number" min="0" step="0.01" value={draft.total} onChange={e => setDraft({ ...draft, total: e.target.value === '' ? NaN : Number(e.target.value) })} /></label>}
    {!!draft.positions.length && <details><summary>Taux de synthèse par catégorie (compatibilité Google Sheet)</summary><p className="muted">Un taux de synthèse remplace les taux détaillés pour les calculs globaux. Laisse vide pour utiliser les taux de chaque placement.</p><div className="form-grid">{[...new Set(draft.positions.map(p => p.category))].map(c => <label key={c}>{c} (%)<input type="number" step="0.001" value={draft.categoryRates?.[c] ?? ''} onChange={e => { const rates = { ...draft.categoryRates }; if (!e.target.value) delete rates[c]; else rates[c] = Number(e.target.value); setDraft({ ...draft, categoryRates: rates }); }} /></label>)}</div></details>}
    <div className="editor-footer"><strong>Total : {euro(draft.total)}</strong><div className="actions">{data.readings.some(r => r.id === draft.id) && <button className="button danger" disabled={busy} onClick={() => { if (window.confirm('Supprimer définitivement ce relevé ?')) void persist({ ...data, readings: data.readings.filter(r => r.id !== draft.id) }, 'Relevé supprimé.'); }}>Supprimer le relevé</button>}<button className="button" disabled={busy} onClick={() => void persist({ ...data, readings: [...data.readings.filter(r => r.id !== draft.id), draft] }, demo ? 'Relevé enregistré pour cette démonstration.' : 'Relevé enregistré dans Supabase.')}><Save size={16} />{busy ? 'Enregistrement…' : 'Enregistrer le relevé'}</button></div></div></section>
    <section className="panel editor"><div className="panel-heading"><div><h2>Mes objectifs</h2><p>Choisis les prochains caps à franchir.</p></div></div><div className="form-grid">{(['capital', 'annual', 'monthly'] as const).map((key, i) => <label key={key}>{['Patrimoine cible (€)', 'Gain annuel cible (€)', 'Équivalent mensuel cible (€)'][i]}<input type="number" min="1" step="1" value={goals[key]} onChange={e => setGoals({ ...goals, [key]: Number(e.target.value) })} /></label>)}</div><button className="button secondary" disabled={busy} onClick={() => void persist({ ...data, goals }, 'Objectifs enregistrés.')}><Save size={16} />Enregistrer les objectifs</button></section>
    <section className="panel editor"><div className="panel-heading"><div><h2>Importer Google Sheets</h2><p>Un import initial contrôlé, sans rendre ton document public.</p></div><Upload size={22} /></div><p className="muted">Dans Google Sheets : Fichier → Télécharger → Valeurs séparées par des virgules (.csv), pour chaque onglet. Les fichiers sont analysés uniquement dans ton navigateur. Aucun envoi avant confirmation.</p><div className="form-grid">{(['evolution', 'portfolio', 'scpi', 'actions'] as const).map((key, i) => <label key={key}>CSV {['Évolution', 'Portefeuille', 'SCPI', 'Actions'][i]}<input type="file" accept=".csv,text/csv" onChange={async e => { const file = e.target.files?.[0]; setPreview(null); if (file) setFiles(f => ({ ...f, [key]: undefined })); try { const text = file ? await file.text() : undefined; setFiles(f => ({ ...f, [key]: text })); } catch { setError('Lecture du fichier impossible.'); } }} /></label>)}<label>Date du détail actuel<input type="date" value={detailDate} onChange={e => { setDetailDate(e.target.value); setPreview(null); }} /></label><label>Projections à partir du<input type="date" value={projectionFrom} onChange={e => { setProjectionFrom(e.target.value); setPreview(null); }} /></label></div><button className="button secondary" onClick={previewImport}>Prévisualiser l’import</button>{preview && <div className="import-preview"><h3>{preview.data.readings.length} relevés · {preview.data.readings.reduce((n, r) => n + r.positions.length, 0)} placements détaillés</h3><ul>{preview.warnings.map(w => <li key={w}>{w}</li>)}</ul><div className="table-scroll"><table><thead><tr><th>Date</th><th>Nature</th><th>Total</th></tr></thead><tbody>{preview.data.readings.map(r => <tr key={r.id}><td>{r.date}</td><td>{r.projected ? 'Projection' : 'Réel'}</td><td>{euro(r.total)}</td></tr>)}</tbody></table></div><p className="negative">Cet import remplace les relevés et objectifs actuels. Exporte une sauvegarde avant de continuer.</p><button className="button" disabled={busy} onClick={() => { if (window.confirm('Remplacer tout le portefeuille par cet import ?')) void persist(preview.data, 'Import enregistré.'); }}>Confirmer le remplacement</button></div>}</section>
  </>;
}
