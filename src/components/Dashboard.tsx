'use client';
import { ArrowUpRight, TrendingUp, Wallet, ArrowDownRight, CircleDollarSign } from 'lucide-react';
import { aggregate, currentReadings, currentSnapshot, monthlyReadings, euro, percent, summarize, type Portfolio } from '@/lib/portfolio';
import { Distribution, Evolution, Rates } from './Charts';
import { groupedInvestments, livePositions, type MarketData } from '@/lib/market';
import { applicableImpact, impactContextChanged } from '@/lib/sync-impact';
import SyncImpactNote from './SyncImpactNote';
export default function Dashboard({ data, market = { returns: [], statuses: [] } }: { data: Portfolio; market?: MarketData }) {
  const detailed = currentSnapshot(data);
  const history = monthlyReadings(data.readings);
  const live = livePositions(detailed, market);
  const positions = live.positions;
  const stats = summarize(positions, live.categoryRates);
  const impact = applicableImpact(market.impact);
  const total = stats.total;
  const baseline = currentReadings(history).actual;
  const change = baseline && detailed ? total - baseline.total : null;
  const groups = aggregate(positions, 'category');
  const rates = groups.map(g => ({ name: g.name, rate: summarize(positions.filter(p => p.category === g.name), live.categoryRates).rate }));
  const monthlyGains = groups.map(g => ({ name: g.name, value: summarize(positions.filter(p => p.category === g.name), live.categoryRates).monthly }));
  const monthlyLosses = monthlyGains.filter(g => g.value < 0);
  if (!data.readings.length && !detailed) return <section className="panel empty"><Wallet size={34} /><h2>Ton patrimoine commence ici.</h2><p>Ouvre l’onglet Saisie pour ajouter tes placements.</p></section>;
  return <>
    {live.warnings.length > 0 && <div className="alert" role="status"><ul>{live.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>}
    <div className="page-heading"><div><h1>Mon patrimoine<span>.</span></h1></div>{data.updatedAt && Number.isFinite(Date.parse(data.updatedAt)) && <div className="date-chip" title="Dernière mise à jour du portefeuille en BDD"><span className="status-dot" /><span>Mis à jour le <time dateTime={data.updatedAt}>{new Date(data.updatedAt).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' })}</time></span></div>}</div>
    <div className="metrics">
      <section className="metric featured"><div className="metric-label">Patrimoine actuel<Wallet size={18} /></div><strong>{euro(total)}</strong><div className="metric-note capital-change-note">{change !== null ? <><span className={`capital-change ${change >= 0 ? 'positive' : 'negative'}`}>{change >= 0 ? <ArrowUpRight size={22} /> : <ArrowDownRight size={22} />}{change > 0 ? '+' : ''}{euro(change)}</span><span>depuis le dernier relevé validé</span></> : 'Aucun relevé validé disponible'}</div></section>
      <section className="metric"><div className="metric-label">Gain annuel estimé<TrendingUp size={18} /></div><strong>{euro(stats.annual)}</strong><div className="metric-note">Objectif <b>{euro(data.goals.annual)}</b></div><progress max={data.goals.annual} value={Math.max(0, stats.annual)} /></section>
      <section className="metric"><div className="metric-label">Équivalent mensuel<CircleDollarSign size={18} /></div><strong>{euro(stats.monthly)}</strong><div className="metric-note">Objectif <b>{euro(data.goals.monthly)}</b></div><progress max={data.goals.monthly} value={Math.max(0, stats.monthly)} /></section>
      <section className="metric"><div className="metric-label">Rendement global<ArrowUpRight size={18} /></div><strong className="lime">{percent(stats.rate)}</strong>{impact ? <SyncImpactNote impact={impact} contextChanged={impactContextChanged(impact, stats.rate)} /> : <div className="metric-note">Taux pondéré par le capital</div>}<span className="tag">Estimation annuelle</span></section>
    </div>
    <div className="main-grid"><section className="panel"><div className="panel-heading"><div><h2>Évolution du patrimoine</h2><p>Montants conservés en début de mois</p></div><span className="tag">Historique mensuel</span></div><Evolution readings={history} target={data.goals.capital} /><div className="chart-foot"><span><i className="line-key" />Relevés réels</span><span><i className="line-key dashed" />Projection</span><b>Cible : {euro(data.goals.capital)}</b></div></section><section className="panel"><div className="panel-heading"><div><h2>Allocation du portefeuille</h2><p>Un peu de recul sur ta diversification</p></div><span className="mini-icon"><Wallet size={17} /></span></div><Distribution data={groups} /></section></div>
    {(['Actions', 'SCPI'] as const).map(category => { const subset = positions.filter(p => p.category === category); return <section key={category} className="focus"><div className="section-heading"><h2><span>{category === 'Actions' ? '↗' : '▦'}</span> Focus {category.toLowerCase()}</h2><span>{subset.length} placements · {euro(summarize(subset).total)}</span></div><div className="focus-grid"><section className="panel"><h3>Répartition des placements</h3><Distribution data={groupedInvestments(subset).map(p => ({ name: p.name, value: p.value }))} /></section><section className="panel"><h3>{category === 'Actions' ? 'Enveloppes d’investissement' : 'Rendement par SCPI'}</h3>{category === 'Actions' ? <Distribution data={aggregate(subset, 'envelope')} /> : <Rates data={subset.map(p => ({ name: p.name, rate: p.rate }))} />}</section></div>{category === 'Actions' && <section className="panel rate-panel"><h3>Rendement par titre — ETF Monde pondéré</h3><Rates data={groupedInvestments(subset).map(p => ({ name: p.name, rate: p.rate }))} /></section>}</section>; })}
    <div className="section-heading"><h2><span>◷</span> Focus rendements</h2><span>Montants pondérés · JEQP inclus</span></div><div className="focus-grid"><section className="panel"><h3>Gains mensuels estimés</h3>{monthlyGains.some(g => g.value > 0) ? <Distribution data={monthlyGains.filter(g => g.value > 0)} centerTotal={stats.monthly} centerLabel="TOTAL NET" /> : <p className="empty">Total mensuel net : {euro(stats.monthly)}. Aucun gain mensuel positif.</p>}{monthlyLosses.length > 0 && <><p className="muted">Les parts et pourcentages représentent les gains positifs ; le total net au centre inclut les pertes.</p><p className="estimate-note">Estimations négatives hors camembert : {monthlyLosses.map(g => `${g.name} : ${euro(g.value)}`).join(' · ')}</p></>}</section><section className="panel"><h3>Performance par classe d’actifs</h3><Rates data={rates} /></section></div>
    <p className="disclaimer">Les gains sont des estimations : capital × taux annuel, puis ÷ 12. Ils incluent les performances théoriques et ne représentent pas nécessairement des revenus encaissés.</p>
  </>;
}
