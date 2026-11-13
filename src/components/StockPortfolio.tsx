'use client';
import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, TrendingUp } from 'lucide-react';
import { currentSnapshot, euro, percent, type Portfolio } from '@/lib/portfolio';
import { annualStockPerformance, annualStockSimulation, cgiSimulationLabel, envelopes, instrumentFor, periods, referenceFor, simulate, stockPositions, type History, type Period } from '@/lib/stock-simulation';
import type { MarketData } from '@/lib/market';
import { loadPriceHistory } from '@/lib/supabase';
import { nextStockSort, sortStockLines, stockCoverageLabel, type StockSort } from '@/lib/stock-sort';
import { groupStockLines, stockLineDescription } from '@/lib/stock-groups';
import StockHeatmap from './StockHeatmap';

const signed = (n: number | null) => n === null ? 'Non disponible' : `${n > 0 ? '+' : ''}${percent(n)}`;
const dateLabel = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
export default function StockPortfolio({ data, market }: { data: Portfolio; market: MarketData }) {
  const [envelope, setEnvelope] = useState('Tous');
  const [period, setPeriod] = useState<Period>('1 an');
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<StockSort | null>(null);
  const [history, setHistory] = useState<History>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision(r => r + 1);
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const chartRef = useRef<HTMLElement>(null);
  function openDetail(id: string) {
    setSelected(id);
    chartRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  const snapshot = currentSnapshot(data);
  const all = stockPositions(snapshot?.positions || []);
  const symbols = [...new Set(all.map(referenceFor).filter(s => s !== undefined))].sort().join(',');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setHistory({});
    loadPriceHistory(symbols ? symbols.split(',') : [], controller.signal).then(result => {
      if (!controller.signal.aborted) setHistory(result);
    }).catch(() => { if (!controller.signal.aborted) setError('Impossible de lire les historiques de marché. Réessaie dans un instant.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [symbols, revision]);
  const annual = annualStockPerformance(snapshot, market, envelope);
  const sourcePositions = annual.positions;
  const result = period === '1 an' ? annualStockSimulation(sourcePositions, history) : simulate(sourcePositions, history, period);
  const groupedLines = groupStockLines(result.lines);
  const positions = groupedLines.map(l => l.position);
  const activeLine = groupedLines.find(l => l.position.id === selected);
  const active = activeLine?.position;
  const members = activeLine?.members.map(l => l.position);
  const detail = members ? period === '1 an' ? annualStockSimulation(members, history) : simulate(members, history, period) : null;
  const chart = detail || result;
  const hasSimulation = chart.lines.some(l => l.simulated);
  const rate = chart.rate;
  const busy = loading || !!market.loading;
  const envelopeFilters = [...new Set([...envelopes, ...all.map(p => p.envelope.trim().toUpperCase()).filter(Boolean)])];
  const sortedLines = sortStockLines(groupedLines, sort);
  const columns = [['name', 'Placement'], ['envelope', 'Enveloppe'], ['amount', 'Montant'], ['weight', 'Poids'], ['rate', `Performance · ${period}`], ['coverage', 'Couverture']] as const;
  return <section className="stocks">
    <div className="page-heading"><h1>Portefeuille boursier<span>.</span></h1></div>
    <div className="stock-tabs" aria-label="Enveloppe">{['Tous', ...envelopeFilters].map(e => <button key={e} aria-pressed={envelope === e} onClick={() => { setEnvelope(e); setSelected(null); }}>{e}</button>)}</div>
    <div className="stock-summary">
      <div className="panel"><span className="muted">Montant détenu · {envelope}</span><strong>{euro(result.total)}</strong><small className="muted">Dernier détail : {snapshot ? dateLabel(snapshot.date) : 'aucun relevé'}</small></div>
      <div className="panel"><span className="muted">Placements</span><strong>{positions.length}</strong></div>
    </div>
    {error && <p className="alert" role="alert">{error}</p>}
    {annual.warnings.length > 0 && <div className="alert" role="status"><ul>{annual.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
    {!positions.length && <p className="panel empty">Aucun placement de catégorie Actions dans cette sélection.</p>}
    <section ref={chartRef} className="panel stock-chart" aria-busy={loading}>
      <div className="panel-heading"><div>{active && <button className="stock-back" onClick={() => setSelected(null)}><ArrowLeft size={14} />Revenir au portefeuille</button>}<h2>{active ? active.name : 'Performance de la poche Actions'}</h2>{activeLine && <p className="muted">{`${activeLine.position.envelope || 'Sans enveloppe'} · ${stockLineDescription(activeLine)}`}</p>}</div><TrendingUp size={22} className="lime" /></div>
      {hasSimulation && <p className="stock-simulation-notice" role="note">{cgiSimulationLabel}.</p>}
      <div className={`stock-return ${rate !== null && rate < 0 ? 'negative' : 'positive'}`}>{busy ? 'Chargement…' : signed(rate)}</div>
      <p className="muted stock-range">{chart.points.length ? `${dateLabel(chart.points[0].date)} → ${dateLabel(chart.points.at(-1)!.date)} · ${hasSimulation ? 'simulation CGI et clôtures disponibles' : 'clôtures disponibles'}` : period === '1 an' ? 'Taux de toute la sélection · références annuelles du dashboard' : 'Pas assez de clôtures communes pour cette période.'}</p>
      {chart.points.length > 1 && !busy ? <ResponsiveContainer width="100%" height={290}><AreaChart data={chart.points} margin={{ top: 10, right: 12, left: 0, bottom: 10 }}><defs><linearGradient id="stockFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a3e635" stopOpacity={0.23} /><stop offset="100%" stopColor="#a3e635" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#2b322c" vertical={false} /><XAxis dataKey="date" tickFormatter={s => dateLabel(s)} minTickGap={55} tick={{ fill: '#8b968d', fontSize: 10 }} /><YAxis tickFormatter={n => `${Number(n).toFixed(1)} %`} width={65} domain={['auto', 'auto']} tick={{ fill: '#8b968d', fontSize: 10 }} /><Tooltip labelFormatter={s => dateLabel(String(s))} formatter={v => [signed(Number(v)), 'Performance']} contentStyle={{ background: '#191e1a', border: '1px solid #39423d', borderRadius: 10 }} /><ReferenceLine y={0} stroke="#59605a" strokeDasharray="3 3" /><Area dataKey="rate" type="linear" stroke="#a3e635" strokeWidth={2.5} fill="url(#stockFill)" isAnimationActive={false} /></AreaChart></ResponsiveContainer> : <div className="stock-chart-empty muted">{busy ? 'Lecture des historiques de marché…' : chart.curveWarning || (active ? detail?.lines[0]?.reason || 'Historique insuffisant' : 'Les lignes non couvertes restent visibles ci-dessous.')}</div>}
      <div className="stock-tabs stock-periods" aria-label="Période">{periods.map(p => <button key={p} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p}</button>)}</div>
      <p className="stock-disclaimer">Moyenne des performances cumulées pondérée par les montants actuels, sans rééquilibrage. Ne représente pas vos gains réels. {period === '1 an' && 'Chaque titre coté utilise sa référence à 365 jours depuis sa dernière clôture.'}</p>
    </section>
    <StockHeatmap lines={groupedLines} total={result.total} period={period} onSelect={openDetail} />
    <section className="panel"><h2>Tes lignes · {envelope}</h2><div className="table-scroll"><table className="stock-table"><thead><tr>{columns.map(([key, label]) => {
      const direction = sort?.key === key ? sort.direction : 'none';
      const Icon = direction === 'ascending' ? ArrowUp : direction === 'descending' ? ArrowDown : ArrowUpDown;
      return <th key={key} scope="col" aria-sort={direction}><button type="button" className="stock-sort-button" aria-label={`Trier par ${label}`} title={`Trier par ${label} · ordre ${nextStockSort(sort, key).direction === 'ascending' ? 'croissant' : 'décroissant'}`} onClick={() => setSort(current => nextStockSort(current, key))}>{label}<Icon size={13} aria-hidden="true" /></button></th>;
    })}</tr></thead><tbody>{sortedLines.map(l => { const i = instrumentFor(l.position); return <tr key={l.position.id}><td><button className="stock-line" onClick={() => openDetail(l.position.id)}>{l.position.name}</button><small className="muted">{stockLineDescription(l)}</small></td><td>{l.position.envelope}</td><td>{euro(l.position.amount)}</td><td>{percent(result.total ? l.position.amount / result.total * 100 : 0)}</td><td className={l.rate === null ? 'muted' : l.rate < 0 ? 'negative' : 'positive'}>{signed(l.rate)}</td><td><small>{loading ? 'Chargement…' : stockCoverageLabel(l)}{i && 'referenceNote' in i && <span className="estimate-note"> · Approximation : {i.referenceSymbol}</span>}</small></td></tr>; })}</tbody></table></div></section>
    <div className="stock-disclaimer"><p>Les performances de marché sont calculées à partir des cours ajustés Yahoo, sans ajout de dividendes.</p></div>
  </section>;
}
