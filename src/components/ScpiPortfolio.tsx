'use client';
import { useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { currentSnapshot, euro, percent, type Portfolio } from '@/lib/portfolio';
import { importScpi, latestScpi, matchScpi, scpiAllocation, scpiPositions, validateScpiImport, type ScpiImport } from '@/lib/scpi';
import { errorMessage } from '@/lib/errors';
import { nextScpiSort, scpiColumns, sortScpiPositions, type ScpiSort } from '@/lib/scpi-sort';
import { scpiCapitalHistory } from '@/lib/scpi-history';
import { groupSmallSlices } from '@/lib/distribution';
import { Distribution } from './Charts';
import './scpi.css';

const sectors: Record<string, string> = { business: 'Commerces', health: 'Santé', hotels: 'Hôtels', local: 'Locaux d’activité', logistic: 'Logistique', office: 'Bureaux', residential: 'Résidentiel', diversified: 'Diversifié', forest: 'Forêts', transportation: 'Transports', other: 'Autres' };
const countries: Record<string, string> = { FRA: 'France', DEU: 'Allemagne', ESP: 'Espagne', GBR: 'Royaume-Uni', IRL: 'Irlande', ITA: 'Italie', NLD: 'Pays-Bas', BEL: 'Belgique', PRT: 'Portugal', POL: 'Pologne', USA: 'États-Unis', CAN: 'Canada', FIN: 'Finlande', LTU: 'Lituanie', SVN: 'Slovénie', LVA: 'Lettonie', CZE: 'Tchéquie', EST: 'Estonie', SVK: 'Slovaquie', AUT: 'Autriche', HUN: 'Hongrie', DNK: 'Danemark', SWE: 'Suède', GRC: 'Grèce', CYP: 'Chypre', LUX: 'Luxembourg', CHE: 'Suisse', other: 'Autres pays' };
const date = (s: string) => new Date(`${s}T12:00:00`).toLocaleDateString('fr-FR');
const chartDate = (timestamp: number) => date(new Date(timestamp).toISOString().slice(0, 10));
const signed = (n: number) => `${n > 0 ? '+' : ''}${euro(n)}`;
const monthlyEuro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export default function ScpiPortfolio({ data, onSave, previewOnly = false }: { data: Portfolio; onSave: (next: Portfolio) => Promise<Portfolio | void>; previewOnly?: boolean }) {
  const [pending, setPending] = useState<ScpiImport | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [sort, setSort] = useState<ScpiSort | null>({ key: 'rate', direction: 'descending' });
  const positions = scpiPositions(data);
  const last = latestScpi(data);
  const sortedPositions = sortScpiPositions(positions, last, sort);
  const total = positions.reduce((s, p) => s + p.amount, 0);
  const annual = positions.reduce((s, p) => s + p.amount * p.rate / 100, 0);
  const incompleteIncome = positions.some(p => p.scpiRateUnavailable);
  const covered = positions.filter(p => last?.positions.some(l => l.id === p.scpiId) && p.amountSource !== 'manual');
  const invested = covered.reduce((s, p) => s + last!.positions.find(l => l.id === p.scpiId)!.invested, 0);
  const gain = covered.reduce((s, p) => s + p.amount, 0) - invested;
  const completeGain = covered.length === positions.length && positions.length > 0;
  const { points: history, incompletePayments } = scpiCapitalHistory(data);
  const historyTicks = history.length ? [
    history[0].timestamp,
    ...Array.from({ length: Math.max(0, Number(history.at(-1)!.date.slice(0, 4)) - Number(history[0].date.slice(0, 4))) }, (_, i) => Date.UTC(Number(history[0].date.slice(0, 4)) + i + 1, 0, 1, 12)).filter(t => t < history.at(-1)!.timestamp),
    history.at(-1)!.timestamp,
  ] : [];
  const capitalValues = history.map(p => p.value).filter((v): v is number => v !== null);
  const capitalDomain: [number, number] = capitalValues.length
    ? [Math.floor(Math.min(...capitalValues) * (Math.min(...capitalValues) < 0 ? 1.02 : .98) / 1000) * 1000, Math.max(1000, Math.ceil(Math.max(...capitalValues) * 1.02 / 1000) * 1000)]
    : [0, 1000];
  const snapshot = currentSnapshot(data);
  let previewError = '';
  let previewData: Portfolio | undefined;
  if (pending) {
    try { previewData = importScpi(data, pending); }
    catch (e) { previewError = errorMessage(e); }
  }
  async function preview(file?: File) {
    setError(''); setMessage(''); setPending(null);
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('Fichier trop volumineux (5 Mo maximum).');
      const input: unknown = JSON.parse(await file.text());
      validateScpiImport(input);
      // Les rapprochements de noms différents sont proposés dans l'aperçu.
      // Aucun renommage ni aucune écriture n'a lieu à cette étape.
      setPending(input);
    } catch (e) { setError(errorMessage(e)); }
  }
  async function confirm() {
    if (!pending || busy) return;
    setBusy(true); setError('');
    try { const next = importScpi(data, pending); if (next !== data) await onSave(next); setPending(null); setMessage('Portefeuille SCPI importé. Les dérogations manuelles sont conservées.'); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  return <section className="scpi-portfolio">
    {previewOnly && <p className="notice" role="status">Aperçu non enregistré · données Louve réelles · aucune écriture en base</p>}
    <div className="scpi-intro"><div><p className="muted">{positions.length} SCPI · {last ? `Louve Invest · import du ${date(last.capturedAt)}` : 'Données de tes relevés · premier import Louve à effectuer'}</p></div></div>
    {last?.positions.some(p => p.rate === undefined) && <p className="notice">Certains taux N−1 ne sont pas fournis par Louve : les taux manuels antérieurs sont conservés quand ils existent, sinon les revenus restent incomplets.</p>}
    <div className="scpi-metrics">
      <section className="panel metric"><span>Capital valorisé</span><strong>{euro(total)}</strong><small title="Valeur de retrait indicative · liquidité non garantie">Valeur de retrait : <b>{last && completeGain ? euro(last.positions.reduce((s, p) => s + p.withdrawalValue, 0)) : 'Non disponible'}</b></small><small>Prix de souscription · {snapshot ? date(snapshot.date) : 'sans relevé'}</small></section>
      <section className="panel metric scpi-income"><span>Revenus mensuels estimés</span><div className="scpi-income-value"><strong>{monthlyEuro.format(annual / 12)}<span className="scpi-income-unit">/mois</span></strong><span className="scpi-income-rate" aria-label="Rendement annualisé" title="Taux annuel pondéré par les montants détenus">{incompleteIncome ? 'Taux partiel' : percent(total ? annual / total * 100 : 0)}</span></div><small>{incompleteIncome ? 'Estimation partielle · taux manquants' : 'Taux annualisé · revenus théoriques'}</small></section>
      <section className="panel metric scpi-gain"><span>Plus/moins-value latente</span><div className="scpi-income-value"><strong className={completeGain && gain < 0 ? 'negative' : ''}>{completeGain ? signed(gain) : 'Non disponible'}</strong>{completeGain && invested > 0 && <span className={`scpi-income-rate${gain < 0 ? ' is-negative' : ''}`} aria-label="Plus ou moins-value en pourcentage" title="Écart entre valorisation et montant investi, rapporté au montant investi">{gain > 0 ? '+' : ''}{percent(gain / invested * 100)}</span>}</div><small>Prix de souscription − coût investi, frais inclus</small></section>
    </div>
    {!positions.length && <p className="panel empty">Aucune SCPI dans ton portefeuille. Importe ton relevé Louve Invest ci-dessous.</p>}
    <div className="scpi-main-grid">
      <section className="panel">
        <h2>Évolution du capital</h2>
        <p className="muted">Depuis les premières opérations disponibles.</p>
        {history.length > 1 ? <ResponsiveContainer width="100%" height={290}>
          <AreaChart data={history} margin={{ left: 4, right: 16, top: 20 }}>
            <CartesianGrid vertical={false} stroke="#2a322d" />
            <XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={historyTicks} interval="preserveStartEnd" tickFormatter={chartDate} tick={{ fill: '#8d9a92', fontSize: 11 }} minTickGap={30} />
            <YAxis tickFormatter={v => euro(Number(v))} width={85} domain={capitalDomain} tick={{ fill: '#8d9a92', fontSize: 11 }} />
            <Tooltip content={({ active, payload }) => active && payload?.[0]?.value !== undefined ? <div className="scpi-capital-tooltip"><div>{date(payload[0].payload.date)}</div><div className="lime">{euro(Number(payload[0].value))}</div></div> : null} />
            <Area name="Capital" type="stepAfter" dataKey="value" stroke="#a3e635" fill="#a3e635" fillOpacity={0.12} connectNulls={false} />
          </AreaChart>
        </ResponsiveContainer> : <div className="scpi-history-empty">
          {history.length === 1 ? <><strong>{euro(history[0].value ?? 0)}</strong><span>{date(history[0].date)} · premier relevé</span></> : <span>Aucun relevé SCPI détaillé disponible.</span>}
          <small>La courbe apparaîtra dès que deux relevés seront disponibles.</small>
        </div>}
        {incompletePayments && <p className="muted">Historique des versements non affiché : certaines opérations ont un statut non reconnu.</p>}
      </section>
      <section className="panel"><h2>Répartition par SCPI</h2><Distribution data={positions.map(p => ({ name: p.name, value: p.amount }))} /></section>
    </div>
    <div className="scpi-main-grid">{(['sectors', 'countries'] as const).map(field => <section className="panel" key={field}><h2>Répartition {field === 'sectors' ? 'sectorielle' : 'géographique'}</h2><Distribution data={groupSmallSlices(scpiAllocation(data, field).map(d => ({ ...d, name: (field === 'sectors' ? sectors : countries)[d.name] ?? d.name })), field === 'sectors' ? 'Autres' : 'Autres pays')} /></section>)}</div>
    <section className="panel"><h2>Détails SCPI</h2><div className="table-scroll"><table className="stock-table scpi-table"><thead><tr>{scpiColumns.map(([key, label]) => {
      const direction = sort?.key === key ? sort.direction : 'none';
      const Icon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown;
      return <th key={key} scope="col" aria-sort={direction}><button type="button" className="stock-sort-button" aria-label={`Trier par ${label}`} title={`Trier par ${label} · ordre ${nextScpiSort(sort, key).direction === 'ascending' ? 'croissant' : 'décroissant'}`} onClick={() => setSort(current => nextScpiSort(current, key))}>{label}<Icon size={13} aria-hidden="true" /></button></th>;
    })}</tr></thead><tbody>{sortedPositions.map(p => {
      const line = last?.positions.find(l => l.id === p.scpiId);
      const scpiUrl = last?.facts.find(f => f.id === p.scpiId)?.sourceUrl;
      const knownGain = line && p.amountSource !== 'manual';
      const delta = line ? p.amount - line.invested : 0;
      return <tr key={p.id}><td><strong>{scpiUrl ? <a className="scpi-name-link" href={scpiUrl} target="_blank" rel="noopener noreferrer" title={`Voir la fiche ${p.name} sur Louve Invest (nouvel onglet)`}>{p.name}</a> : p.name}</strong><small className="muted">{!p.scpiId ? 'Relevé manuel' : p.amountSource === 'manual' || p.rateSource === 'manual' ? 'Dérogation manuelle' : 'Louve Invest'}</small></td><td>{line ? `${line.shares.toLocaleString('fr-FR')} · ${line.ownership.join(', ')}` : 'Non renseigné'}</td><td>{line ? euro(line.invested) : '—'}</td><td>{euro(p.amount)}</td><td>{percent(total ? p.amount / total * 100 : 0)}</td><td>{p.scpiRateUnavailable ? 'Non disponible' : percent(p.rate)}<small className="muted">{p.rateSource === 'louve' && line?.rateReference === 'general' ? 'Fiche générale · année non précisée' : p.rateAsOf?.slice(0, 4) ?? 'Année non renseignée'}</small></td><td>{p.scpiRateUnavailable ? 'Non disponible' : monthlyEuro.format(p.amount * p.rate / 1200)}</td><td className={knownGain ? delta < 0 ? 'negative' : 'positive' : 'muted'}>{knownGain ? <>{signed(delta)}{delta !== 0 && <small>{line.invested ? percent(delta / line.invested * 100) : '—'}</small>}</> : 'Non disponible'}</td></tr>;
    })}</tbody></table></div></section>
    {!!data.scpi?.imports.length && <details className="panel"><summary>Historique des imports</summary><ul>{[...data.scpi.imports].reverse().map(i => <li key={i.capturedAt}>{date(i.capturedAt)} · Louve Invest · {i.positions.length} SCPI · {i.transactions.length} transactions · {i.transactions.filter(t => t.inProgress).length} en cours</li>)}</ul></details>}
    {!previewOnly && <>
      <input hidden aria-label="Import technique SCPI" type="file" accept=".json,application/json" disabled={busy} onChange={e => { void preview(e.target.files?.[0]); e.target.value = ''; }} />
      {error && <p className="alert" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      {pending && <div className="panel scpi-preview"><h3>Vérifier avant enregistrement</h3><p>Relevé du {date(pending.capturedAt)} · {pending.positions.length} SCPI · {pending.transactions.length} transactions, dont {pending.transactions.filter(t => t.inProgress).length} en cours · capital Louve {euro(pending.positions.reduce((s, p) => s + p.buyingValue, 0))}.</p><p>Les montants et taux explicitement manuels resteront inchangés. Les autres actifs et relevés passés sont conservés.</p>
        {previewError && <p role="alert" className="alert">{previewError}</p>}
        {previewData && <p>Capital SCPI après import : <strong>{euro(scpiPositions(previewData).reduce((s, p) => s + p.amount, 0))}</strong> (actuellement {euro(total)}). {previewData === data && 'Cet import est déjà enregistré : aucune modification.'}</p>}
        <div className="table-scroll"><table className="stock-table"><thead><tr><th>SCPI / rapprochement</th><th>Capital actuel → après import</th><th>Taux actuel → après import</th></tr></thead><tbody>{pending.positions.map(p => {
          const previous = positions.find(old => matchScpi(old, p));
          const after = previewData && scpiPositions(previewData).find(l => l.scpiId === p.id);
          return <tr key={p.id}><td>{p.name}<select aria-label={`Rapprocher ${p.name}`} disabled={busy} value={p.positionId ?? previous?.id ?? ''} onChange={e => setPending({ ...pending, positions: pending.positions.map(l => l.id === p.id ? { ...l, positionId: e.target.value || undefined } : l) })}><option value="">Nouvelle ligne / automatique</option>{positions.filter(old => !old.scpiId || old.scpiId === p.id).map(old => <option key={old.id} value={old.id}>{old.name}</option>)}</select></td><td>{previous ? euro(previous.amount) : 'Nouvelle'} → {euro(after?.amount ?? (previous?.amountSource === 'manual' ? previous.amount : p.buyingValue))}{previous?.amountSource === 'manual' && ' · manuel conservé'}</td><td>{previous ? percent(previous.rate) : '—'} → {after ? after.scpiRateUnavailable ? 'Non disponible' : `${percent(after.rate)} · ${after.rateSource === 'louve' ? 'Louve Invest' : 'manuel conservé'}` : 'Rapprochement requis'}</td></tr>;
        })}</tbody></table></div><div className="actions"><button className="button" disabled={busy || !!previewError || previewData === data} onClick={() => void confirm()}>{busy ? 'Enregistrement…' : 'Confirmer l’import SCPI'}</button><button className="button secondary" disabled={busy} onClick={() => setPending(null)}>Annuler</button></div>
        {previewData && previewData !== data && <details className="scpi-import-dashboard" open={showPreview} onToggle={e => setShowPreview(e.currentTarget.open)}><summary>Voir le tableau de bord après import (sans enregistrer)</summary>{showPreview && <ScpiPortfolio data={previewData} onSave={onSave} previewOnly />}</details>}
        </div>}
    </>}
  </section>;
}
