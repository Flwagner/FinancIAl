'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, FlaskConical, Plus, Save, Trash2 } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { euro, percent, type Portfolio } from '@/lib/portfolio';
import type { MarketData } from '@/lib/market';
import { normalizeSimulationInputs, parseScenarios, scenarioErrors, type Scenario, type SimulationLine } from '@/lib/projection';
import { refreshSimulationRates, simulationDefaults } from '@/lib/simulation-defaults';
import { ageOnDate, calendarDateLabel, localCalendarDate, projectionAge, projectionDate } from '@/lib/simulation-age';
import { groupedScenarioErrors, projectGroupedScenario, simulationGroups, updateSimulationGroup, type SimulationGroup } from '@/lib/simulation-groups';
import { projectionAxis, projectionAxisLabel } from '@/lib/projection-axis';
import { parseSimulationDraft, resolveSimulationDraft, simulationFingerprint, type SimulationWorkspace } from '@/lib/simulation-storage';
import { errorMessage } from '@/lib/errors';
import { Distribution } from './Charts';
import './simulation.css';

const palette = ['#b4ee70', '#818cf8', '#22d3ee'];
const uid = () => crypto.randomUUID();
function freshScenario(data: Portfolio, market: MarketData, source: 'current' | 'target' | 'blank'): Scenario {
  const defaults = simulationDefaults(data, market);
  const positions = defaults.positions;
  const total = positions.reduce((s, p) => s + p.amount, 0);
  let lines: SimulationLine[];
  if (source === 'target' && data.allocationTarget) {
    lines = defaults.categories.filter(p => Object.hasOwn(data.allocationTarget!, p.name)).map(p => ({
      ...p, id: uid(), allocation: data.allocationTarget![p.name], investmentWeight: data.allocationTarget![p.name],
    }));
  } else {
    lines = source === 'blank' || !total ? [{
      id: uid(), name: 'Nouvelle poche', allocation: 100, investmentWeight: 100, growth: 0, income: 0, reinvest: true,
    }] : positions.map(p => ({
      ...p, id: uid(), allocation: p.amount / total * 100, investmentWeight: p.amount / total * 100,
    }));
  }
  return normalizeSimulationInputs({ id: uid(), name: source === 'target' ? 'Allocation cible' : source === 'blank' ? 'Mon scénario' : 'Portefeuille',
    capital: source === 'blank' ? 0 : total, monthly: 0, redirect: 0, lines });
}
function Numeric({ label, value, onChange, max = 1e12, min = 0, decimals = 2 }: {
  label: string; value: number; onChange: (n: number) => void; max?: number; min?: number; decimals?: 0 | 2;
}) {
  return <input aria-label={label} type="number" min={min} max={max} step={decimals === 0 ? '1' : '0.01'} value={Number.isFinite(value) ? Number(value.toFixed(decimals)) : ''}
    onChange={e => onChange(e.target.value === '' ? NaN : Number(Number(e.target.value).toFixed(decimals)))} />;
}
export default function Simulation({ data, market, owner, onSave, actions }: { data: Portfolio; market: MarketData; owner: string; onSave: (next: Portfolio) => Promise<void>; actions: HTMLDivElement | null }) {
  const [strategyOpen, setStrategyOpen] = useState(true);
  const [scenarios, setScenarios] = useState<Scenario[]>(() => [freshScenario(data, market, 'current')]);
  const [active, setActive] = useState('');
  const [years, setYears] = useState(data.simulationHorizon ?? 20);
  const [startDate] = useState(() => localCalendarDate());
  const [ready, setReady] = useState(false);
  const [storageMessage, setStorageMessage] = useState('');
  const [ratesMessage, setRatesMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [recovery, setRecovery] = useState<SimulationWorkspace | null>(null);
  const [base, setBase] = useState(() => simulationFingerprint(data.simulations, data.simulationHorizon));
  const saveLock = useRef(false);
  const defaults = useMemo(() => simulationDefaults(data, market), [data, market]);
  const key = `financial:simulations:v2:${owner}`;
  const strategyKey = `financial:simulation-strategy-open:v1:${owner}`;
  useEffect(() => {
    try { setStrategyOpen(localStorage.getItem(strategyKey) !== 'false'); }
    catch { setStrategyOpen(true); }
  }, [strategyKey]);
  function toggleStrategy() {
    const next = !strategyOpen;
    setStrategyOpen(next);
    try { localStorage.setItem(strategyKey, String(next)); }
    catch { /* Le repli reste utilisable si le stockage local est bloqué. */ }
  }
  useEffect(() => {
    const cloud = data.simulations ? parseScenarios(JSON.stringify(data.simulations)) : null;
    let loaded: SimulationWorkspace | null = cloud ? { scenarios: cloud, horizon: data.simulationHorizon ?? 20 } : null;
    try {
      const raw = localStorage.getItem(key);
      const legacyRaw = localStorage.getItem(`financial:simulations:v1:${owner}`);
      const resolved = resolveSimulationDraft(cloud, parseSimulationDraft(raw), legacyRaw ? parseScenarios(legacyRaw) : null, data.simulationHorizon);
      loaded = resolved.workspace;
      setRecovery(resolved.recovery);
      if (raw && !parseSimulationDraft(raw)) setStorageMessage('Brouillon local illisible. La version en base reste disponible.');
    } catch { setStorageMessage('Stockage navigateur indisponible. Utilise Enregistrer pour conserver tes simulations en base.'); }
    if (loaded) {
      setScenarios(loaded.scenarios.map(s => normalizeSimulationInputs(s.name === 'Portefeuille actuel' ? { ...s, name: 'Portefeuille' } : s)));
      setYears(loaded.horizon);
      setActive(loaded.scenarios[0].id);
    }
    setBase(simulationFingerprint(cloud, data.simulationHorizon));
    setReady(true);
    // Chargement à l’ouverture uniquement : une sauvegarde ne doit pas écraser le brouillon.
  }, [key]);
  // Brouillon local uniquement ; l’écriture en base est toujours explicite.
  function commit(next: Scenario[], horizon = years) {
    if (saveLock.current) return;
    next = next.map(normalizeSimulationInputs);
    setScenarios(next);
    setYears(horizon);
    setSaveMessage(''); setSaveError('');
    if (next.some(s => scenarioErrors(s).length)) {
      setStorageMessage('Modifications non enregistrées : corrige les champs et les répartitions.');
      return;
    }
    try { localStorage.setItem(key, JSON.stringify({ scenarios: next, horizon, base })); setStorageMessage(''); }
    catch { setStorageMessage('Brouillon local indisponible : clique sur Enregistrer pour conserver tes modifications.'); }
  }
  async function saveSimulations() {
    if (saveLock.current || scenarios.some(s => groupedScenarioErrors(s, defaults).length)) return;
    saveLock.current = true;
    setSaving(true); setSaveError(''); setSaveMessage('');
    const snapshot = structuredClone(scenarios.map(normalizeSimulationInputs));
    const horizon = years;
    try {
      // Ne pas passer par le gel des rendements : aucun relevé n’est modifié.
      await onSave({ ...data, simulations: snapshot, simulationHorizon: horizon });
      const savedBase = simulationFingerprint(snapshot, horizon);
      setBase(savedBase); setRecovery(null);
      setSaveMessage('Simulations enregistrées · disponibles sur tes autres appareils.');
      try { localStorage.setItem(key, JSON.stringify({ scenarios: snapshot, horizon, base: savedBase })); setStorageMessage(''); }
      catch { setStorageMessage('La sauvegarde en base a réussi, mais le brouillon local est indisponible.'); }
    } catch (error) { setSaveError(errorMessage(error)); }
    finally { saveLock.current = false; setSaving(false); }
  }
  const selected = scenarios.find(s => s.id === active) ?? scenarios[0];
  const update = (patch: Partial<Scenario>) => commit(scenarios.map(s => s.id === selected.id ? { ...s, ...patch } : s));
  const groups = useMemo(() => simulationGroups(selected.lines, defaults), [selected.lines, defaults]);
  const updateGroup = (group: SimulationGroup, patch: Partial<SimulationLine>) => update({ lines: updateSimulationGroup(selected.lines, group, patch) });
  const groupBalance = (group: SimulationGroup) => end?.balances[groups.indexOf(group)] ?? 0;
  const projections = useMemo(() => scenarios.map(s => groupedScenarioErrors(s, defaults).length ? null : projectGroupedScenario(s, years, defaults)), [scenarios, years, defaults]);
  const index = scenarios.indexOf(selected);
  const points = projections[index];
  const yAxis = projectionAxis([
    ...projections.flatMap(p => p?.map(point => point.total) ?? []),
  ], true);
  const end = points?.at(-1);
  const errors = groupedScenarioErrors(selected, defaults);
  const invalid = scenarios.some(s => groupedScenarioErrors(s, defaults).length);
  const dirty = simulationFingerprint(scenarios, years) !== simulationFingerprint(data.simulations, data.simulationHorizon);
  const chart = Array.from({ length: years + 1 }, (_, year) => Object.fromEntries([
    ['year', year],
    ...scenarios.map((s, i) => [s.id, projections[i]?.[year].total]),
  ]));
  const reached = points?.find(p => p.total >= data.goals.capital);
  const currentAge = ageOnDate(data.birthDate, startDate);
  const ageAt = (year: number) => projectionAge(data.birthDate, startDate, year);
  const ageSuffix = (year: number) => {
    const age = ageAt(year);
    return age === null ? '' : ` · ${age} ans`;
  };
  const horizonLabel = (year: number) => `${year === 0 ? 'Aujourd’hui' : `Dans ${year} ${year === 1 ? 'an' : 'ans'}`}${ageSuffix(year)}`;
  function add(source: 'current' | 'target' | 'blank') {
    if (scenarios.length >= 3) return;
    const next = freshScenario(data, market, source);
    commit([...scenarios, next]); setActive(next.id);
  }
  function normalize(field: 'allocation' | 'investmentWeight') {
    const sum = selected.lines.reduce((s, l) => s + (Number.isFinite(l[field]) ? Math.max(0, l[field]) : 0), 0);
    update({ lines: selected.lines.map(l => ({ ...l, [field]: sum ? Math.max(0, Number.isFinite(l[field]) ? l[field] : 0) / sum * 100 : 100 / selected.lines.length })) });
  }
  if (!ready) return <section className="panel empty">Chargement des simulations…</section>;
  return <div className="simulation">
    {actions && createPortal(<div className="sim-save-toolbar"><span>{saving ? 'Enregistrement…' : invalid ? 'Corrige les scénarios invalides' : dirty ? 'Modifications non enregistrées en base' : 'Enregistré en base'}</span><button className="button" disabled={saving || invalid || !dirty} onClick={() => void saveSimulations()}><Save size={16} />{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>, actions)}
    {saveError && <p className="alert" role="alert">{saveError}</p>}
    {saveMessage && <p className="sim-storage" role="status">{saveMessage}</p>}
    <fieldset disabled={saving} className="sim-editable">
    {recovery && <div className="notice sim-recovery"><span>Un autre brouillon local est conservé. La version en base a été chargée pour éviter de la remplacer par une ancienne version.</span><button className="sync-market-button" onClick={() => { const draft = recovery; setRecovery(null); commit(draft.scenarios, draft.horizon); }}>Restaurer le brouillon local</button></div>}
    <div className="sim-intro"><span className="tag"><FlaskConical size={14} /> LABORATOIRE PATRIMONIAL</span>{currentAge !== null && <p className="sim-age-info">Naissance : {calendarDateLabel(data.birthDate!)} · <b>{currentAge} ans</b> au {calendarDateLabel(startDate)}. Les âges projetés correspondent à chaque échéance à partir d’aujourd’hui.</p>}</div>
    <div className="sim-scenarios" aria-label="Scénarios">
      {scenarios.map((s, i) => <button key={s.id} aria-pressed={s.id === selected.id} onClick={() => setActive(s.id)}><i style={{ background: palette[i] }} />{s.name || 'Sans nom'}</button>)}
      <button disabled={scenarios.length >= 3} onClick={() => { const copy = { ...structuredClone(selected), id: uid(), name: `${selected.name} (copie)` }; commit([...scenarios, copy]); setActive(copy.id); }}><Copy size={14} />Dupliquer</button>
    </div>
    <div className="sim-create"><span>Nouveau scénario :</span><button disabled={scenarios.length >= 3} onClick={() => add('current')}>Mon portefeuille</button><button disabled={scenarios.length >= 3 || !data.allocationTarget} onClick={() => add('target')}>Mon allocation cible</button><button disabled={scenarios.length >= 3} onClick={() => add('blank')}>Page blanche</button><small>3 scénarios maximum</small></div>
    <section className="panel sim-settings">
      <div className="panel-heading"><div><h2>Les règles du jeu</h2></div>{scenarios.length > 1 && <button className="icon-button" aria-label="Supprimer ce scénario" onClick={() => { const next = scenarios.filter(s => s.id !== selected.id); commit(next); setActive(next[0].id); }}><Trash2 size={16} /></button>}</div>
      <div className="sim-fields">
        <label>Nom du scénario<input value={selected.name} maxLength={80} onChange={e => update({ name: e.target.value })} /></label>
        <label>Capital initial (€)<Numeric label="Capital initial" decimals={0} value={selected.capital} onChange={capital => update({ capital })} /></label>
        <label>Épargne personnelle / mois (€)<Numeric label="Épargne personnelle mensuelle" decimals={0} value={selected.monthly} max={1e9} onChange={monthly => update({ monthly })} /></label>
        <label>Revenus encaissés redirigés (%)<Numeric label="Part des revenus redirigés" value={selected.redirect} max={100} onChange={redirect => update({ redirect })} /></label>
      </div>
      <p className="sim-help">L’investissement libre = ton épargne personnelle + la part choisie des revenus non réinvestis sur leur poche. Le reste est consommé et ne compte pas dans le patrimoine projeté. Rediriger tes dividendes n’est pas un nouvel apport personnel.</p>
    </section>
    <section className="panel sim-lines">
      <button type="button" className="sim-strategy-toggle" aria-expanded={strategyOpen} aria-controls="sim-strategy-content" onClick={toggleStrategy}><span>À chaque poche, sa stratégie</span></button>
      <div id="sim-strategy-content" hidden={!strategyOpen}>
      <div className="panel-heading"><div className="sim-line-actions"><button className="sync-market-button" disabled={market.loading} title="Remplace uniquement les taux des lignes reconnues, sans changer les allocations ni les choix de réinvestissement" onClick={() => { const result = refreshSimulationRates(selected.lines, defaults); update({ lines: result.lines }); setRatesMessage(`${result.updated} placement(s) actualisé(s). Les placements non reconnus sont conservés.`); }}>Reprendre les taux du portefeuille</button><button className="sync-market-button" disabled={selected.lines.length >= 100} onClick={() => update({ lines: [...selected.lines, { id: uid(), name: 'Nouvelle poche', allocation: 0, investmentWeight: 0, growth: 0, income: 0, reinvest: true }] })}><Plus size={14} />Ajouter une ligne</button></div></div>
      {ratesMessage && <p className="sim-help" role="status">{ratesMessage}</p>}
      {defaults.warnings.length > 0 && <p className="sim-help estimate-note">{defaults.warnings.join(' ')}</p>}
      <div className="table-scroll"><table className="sim-table"><thead><tr><th>Poche / placement</th><th>Allocation<br />initiale (%)</th><th>Évolution du<br />capital (%/an)</th><th>Revenus<br />distribués (%/an)</th><th>Revenus<br />réinvestis</th><th>Investissement<br />libre (%)</th><th><span className="muted">Retirer</span></th></tr></thead><tbody>
        {groups.map(l => <tr key={l.id}>
          <td>{l.grouped ? <strong>{l.name}</strong> : <input aria-label={`Nom de ${l.name}`} value={l.name} maxLength={120} onChange={e => updateGroup(l, { name: e.target.value })} />}<small>{euro(selected.capital * l.allocation / 100)}{l.grouped && ` · ${l.members.length} placement${l.members.length > 1 ? 's' : ''}`}</small></td>
          <td><Numeric label={`Allocation de ${l.name}`} value={l.allocation} max={100} onChange={allocation => updateGroup(l, { allocation })} /></td>
          <td><Numeric label={`Évolution du capital de ${l.name}`} value={l.growth} min={-100} max={100} onChange={growth => updateGroup(l, { growth })} /></td>
          <td><Numeric label={`Revenus distribués de ${l.name}`} value={l.income} max={100} onChange={income => updateGroup(l, { income })} /></td>
          <td><label className="sim-check"><input aria-label={`Revenus réinvestis de ${l.name}`} aria-checked={l.mixedReinvestment ? 'mixed' : l.reinvest} ref={el => { if (el) el.indeterminate = l.mixedReinvestment; }} type="checkbox" checked={l.reinvest} onChange={e => updateGroup(l, { reinvest: e.target.checked })} />{l.mixedReinvestment ? 'Mixte' : l.reinvest ? 'Oui' : 'Non'}</label></td>
          <td><Numeric label={`Investissement libre vers ${l.name}`} value={l.investmentWeight} max={100} onChange={investmentWeight => updateGroup(l, { investmentWeight })} /></td>
          <td><button className="icon-button" aria-label={`Retirer ${l.name}`} disabled={selected.lines.length === l.members.length} onClick={() => { const ids = new Set(l.members.map(m => m.id)); update({ lines: selected.lines.filter(row => !ids.has(row.id)) }); }}><Trash2 size={14} /></button></td>
        </tr>)}
      </tbody></table></div>
      <div className="sim-totals"><span>Allocation : <b>{percent(groups.reduce((s, l) => s + l.allocation, 0))}</b> <button onClick={() => normalize('allocation')}>Ramener à 100 %</button></span><span>Investissement libre : <b>{percent(groups.reduce((s, l) => s + l.investmentWeight, 0))}</b> <button onClick={() => normalize('investmentWeight')}>Ramener à 100 %</button></span></div>
      <p className="sim-help"><b>ETF capitalisant :</b> sa performance globale va dans « Évolution du capital », revenus distribués à 0 % (dividendes déjà inclus).<br /><b>SCPI :</b> sépare la variation du prix des parts et les revenus distribués. « Réinvestis » réinjecte les revenus dans la même ligne ; sinon ils peuvent alimenter l’investissement libre.</p>
      </div>
    </section>
    {errors.length > 0 && <div className="alert" role="alert"><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
    <div className="sim-result-heading"><h2>Le temps fait son œuvre</h2><div className="stock-tabs">{[5, 10, 15, 20, 30].map(n => <button key={n} aria-label={horizonLabel(n)} aria-pressed={years === n} onClick={() => commit(scenarios, n)}>{n} ans{currentAge !== null && <small>À {ageAt(n)} ans</small>}</button>)}</div></div>
    {end && <div className="sim-summary"><div className="metrics sim-metrics">
      <section className="metric featured"><div className="metric-label">Patrimoine dans {years} ans{ageSuffix(years)}</div><strong>{euro(end.total)}</strong><div className="metric-note">Apports personnels : {euro(end.contributions)}</div><div className="metric-note">Placements uniquement · revenus consommés exclus</div></section>
      <section className="metric"><div className="metric-label">Gains cumulés</div><strong className={end.gains >= 0 ? 'lime' : 'negative'}>{euro(end.gains)}</strong><div className="metric-note">Hors apports personnels : {euro(end.contributions - Math.round(selected.capital))} d’épargne sur {years} ans</div></section>
    </div><section className="panel sim-final-allocation"><h2>Répartition des placements dans {years} ans{ageSuffix(years)}</h2><p className="sim-help">Sans rééquilibrage automatique, les poids évoluent. Revenus consommés exclus.</p><Distribution data={groups.map(l => ({ name: l.name, value: groupBalance(l) })).filter(l => l.value > 0)} centerLabel="PLACEMENTS" percentageDecimals={2} /></section></div>}
    <section className="panel sim-chart"><div className="panel-heading"><div><h2>Des trajectoires à comparer</h2><p>Patrimoine total · euros bruts · les scénarios invalides sont masqués</p>{currentAge !== null && <p>Ton âge en haut · durée de projection en bas</p>}</div><span className="tag">{years} ANS{ageSuffix(years)}</span></div>
      <div className="sim-chart-canvas"><ResponsiveContainer width="100%" height="100%"><LineChart data={chart} margin={{ top: 15, right: 20, left: 10, bottom: 5 }}>
        <CartesianGrid stroke="#2b322c" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="year" tickFormatter={v => `${v} ${v === 1 ? 'an' : 'ans'}`} minTickGap={25} stroke="#8b968d" fontSize={11} /><YAxis width={80} domain={yAxis.domain} ticks={yAxis.ticks} interval={0} tickFormatter={projectionAxisLabel} stroke="#8b968d" fontSize={11} />
        {currentAge !== null && <XAxis xAxisId="age" dataKey="year" orientation="top" tickFormatter={v => `${ageAt(Number(v))} ans`} minTickGap={25} stroke="#b4ee70" fontSize={11} />}
        <Tooltip formatter={v => euro(Number(v))} labelFormatter={v => `${horizonLabel(Number(v))} · ${projectionDate(startDate, Number(v))?.slice(0, 4) ?? ''}`} contentStyle={{ background: '#191e1a', border: '1px solid #3c493b', borderRadius: 10 }} /><Legend />
        {scenarios.map((s, i) => projections[i] && <Line key={s.id} type="monotone" dataKey={s.id} name={s.name} stroke={palette[i]} strokeWidth={3} dot={false} isAnimationActive={false} />)}
      </LineChart></ResponsiveContainer></div>
      {points && <p className="sim-goal">Objectif de capital : <b>{euro(data.goals.capital)}</b> — {reached ? reached.year === 0 ? `déjà atteint au départ${ageSuffix(0)}.` : `atteint vers l’année ${reached.year}${ageSuffix(reached.year)}.` : `non atteint sur ${years} ans.`}</p>}
      {end && <p className="sim-help">Revenus encaissés cumulés : <b>{euro(end.distributions)}</b>, dont <b>{euro(end.redirected)}</b> redirigés vers l’investissement libre et <b>{euro(end.consumed)}</b> consommés, hors patrimoine. Les revenus réinvestis sur leur propre ligne sont déjà inclus dans les placements.</p>}
    </section>
    {storageMessage && <p className="sim-storage" role="status">{storageMessage}</p>}
    <p className="stock-disclaimer">Projections théoriques à taux constants, non garanties. Calcul mensuel par poche, avec les taux affichés : évolution du capital à taux annuel effectif, revenus annuels divisés par 12 sur le capital de début de mois, réinvestissements et versements en fin de mois. Achats fractionnés supposés possibles, sans frais, délais de jouissance, fiscalité ni inflation. Tous les revenus non réinvestis sont consommés et exclus du patrimoine.</p>
    </fieldset>
  </div>;
}
