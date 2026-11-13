import { calculateReturn, livePositions, marketInstruments, symbolForCode, type MarketData, type MarketPrice } from './market';
import { summarize, type Position, type Reading } from './portfolio';

export type History = Record<string, MarketPrice[]>;
export type Period = '5J' | '1M' | '6M' | 'Année' | '1 an' | 'Max';
export const periods: Period[] = ['5J', '1M', '6M', '1 an'];
export const envelopes = ['PEA', 'CTO', 'PEE'] as const;
export function stockPositions(positions: Position[], envelope = 'Tous') {
  return positions.filter(p => p.category === 'Actions' && (envelope === 'Tous' || p.envelope.trim().toUpperCase() === envelope));
}
// Même source, repli manuel et taux de catégorie que la barre Actions du dashboard.
export function annualStockPerformance(reading: Reading | undefined, market: MarketData, envelope = 'Tous', now = new Date()) {
  const live = livePositions(reading, market, now);
  const positions = stockPositions(live.positions, envelope).map(p => ({ ...p, rate: live.categoryRates[p.category] ?? p.rate }));
  return { ...summarize(positions), positions, warnings: live.warnings };
}
export function instrumentFor(p: Position) {
  return marketInstruments.find(i => i.symbol === symbolForCode(p.code));
}
export function referenceFor(p: Position) {
  const i = instrumentFor(p);
  return i && 'referenceSymbol' in i ? i.referenceSymbol : i?.symbol;
}
const day = 86400000;
export const cgiSimulationRate = 30;
export const cgiSimulationLabel = 'CGI · Simulation à 30 % par an — aucun historique disponible';
export function usesCgiSimulation(position: Position, history: History) {
  const symbol = referenceFor(position);
  return position.category === 'Actions' && position.envelope.trim().toUpperCase() === 'PEE'
    && /\bCGI\b/i.test(position.name) && (!symbol || !(history[symbol]?.length));
}
// Indice théorique en mémoire uniquement. 1,30^(jours/365) donne un taux
// quotidien constant et exactement +30 % sur 365 jours, pas 30 % / 12.
function cgiSimulationPrices(history: History, now: Date): MarketPrice[] {
  const today = now.toISOString().slice(0, 10);
  const yesterday = Date.parse(today) - day;
  const recent = Object.values(history).flat().filter(p => p.date < today && yesterday - Date.parse(p.date) <= 7 * day && p.adjusted_close > 0 && Number.isFinite(p.adjusted_close));
  const end = recent.length ? Math.max(...recent.map(p => Date.parse(p.date))) : yesterday;
  return Array.from({ length: 366 }, (_, index) => {
    const date = new Date(end - (365 - index) * day).toISOString().slice(0, 10);
    const value = 100 * Math.pow(1 + cgiSimulationRate / 100, index / 365);
    return { date, close: value, adjusted_close: value };
  });
}
export function simulate(positions: Position[], history: History, period: Period, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const target = new Date(today + 'T00:00:00Z');
  if (period === '5J') target.setUTCDate(target.getUTCDate() - 5);
  if (period === '1M' || period === '6M') {
    const date = target.getUTCDate();
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() - (period === '1M' ? 1 : 6));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(date, lastDay));
  }
  if (period === 'Année') target.setUTCMonth(0, 1);
  // Sur un an, calculateReturn détermine la référence depuis la dernière
  // clôture de CHAQUE titre, exactement comme le synchroniseur du dashboard.
  const start = period === 'Max' ? '' : target.toISOString().slice(0, 10);
  const lines = positions.map(position => {
    const simulated = usesCgiSimulation(position, history);
    const symbol = simulated ? 'SIMULATION:CGI' : referenceFor(position);
    const source = simulated ? cgiSimulationPrices(history, now) : history[symbol || ''] || [];
    const prices = source.filter(p => p.date < today && p.adjusted_close > 0 && Number.isFinite(p.adjusted_close)).sort((a, b) => a.date.localeCompare(b.date));
    let selected = prices.filter(p => p.date >= start);
    let annualError = '';
    if (period === '1 an' && symbol) {
      try {
        const annual = calculateReturn(symbol, simulated ? 'EUR' : instrumentFor(position)!.currency, prices, now);
        selected = prices.filter(p => p.date >= annual.start_date && p.date <= annual.as_of);
      } catch { annualError = 'Historique insuffisant pour les 365 derniers jours'; }
    }
    let reason = !symbol ? 'Cotation non disponible' : position.amount <= 0 ? 'Montant nul' : selected.length < 2 ? 'Historique insuffisant' : '';
    if (!reason && Date.parse(today) - Date.parse(selected.at(-1)!.date) > 7 * day) reason = 'Dernière clôture trop ancienne';
    if (!reason && annualError) reason = annualError;
    if (!reason && period !== '1 an' && start && Date.parse(selected[0].date) - Date.parse(start) > 7 * day) reason = 'Historique incomplet sur cette période';
    if (!reason && period !== '1 an' && selected.some((p, index) => index > 0 && Date.parse(p.date) - Date.parse(selected[index - 1].date) > 7 * day)) reason = 'Interruption dans les cours';
    return { position, symbol, prices: selected, reason, rate: null as number | null, simulated };
  });
  const covered = lines.filter(l => !l.reason);
  // Références initiales individuelles en mode annuel ; pas de décalage
  // silencieux de leur fenêtre 365 jours vers la première date commune.
  const dateSets = covered.map(l => new Set(l.prices.map(p => p.date)));
  let dates = covered.length ? covered[0].prices.map(p => p.date).filter(d => dateSets.every(s => s.has(d))) : [];
  if (period === '1 an' && covered.length) {
    const end = covered.map(l => l.prices.at(-1)!.date).sort().at(-1)!;
    // À la date finale, les autres places conservent leur dernière clôture
    // connue (déjà contrôlée à moins de 7 jours), sans interpolation.
    dates = [...new Set([...dates, end])].sort();
  }
  const total = positions.reduce((s, p) => s + p.amount, 0);
  const coveredAmount = covered.reduce((s, l) => s + l.position.amount, 0);
  const maps = covered.map(l => new Map(l.prices.map(p => [p.date, p.adjusted_close])));
  const initialPrices = covered.map((l, i) => period === '1 an' ? l.prices[0].adjusted_close : maps[i].get(dates[0])!);
  const priceAt = (i: number, date: string) => maps[i].get(date) ?? covered[i].prices.at(-1)!.adjusted_close;
  const points = dates.map(date => {
    const rate = covered.reduce((sum, l, i) => sum + l.position.amount / coveredAmount * (priceAt(i, date) / initialPrices[i] - 1) * 100, 0);
    return { date, rate };
  });
  if (dates.length >= 2) covered.forEach((l, i) => { l.rate = (priceAt(i, dates.at(-1)!) / initialPrices[i] - 1) * 100; });
  const simulatedAmount = dates.length >= 2 ? covered.filter(l => l.simulated).reduce((sum, l) => sum + l.position.amount, 0) : 0;
  return { lines, points: dates.length >= 2 ? points : [], rate: dates.length >= 2 ? points.at(-1)!.rate : null, curveWarning: '', total, simulatedAmount, coveredAmount: dates.length >= 2 ? coveredAmount : 0, coverage: total && dates.length >= 2 ? coveredAmount / total * 100 : 0 };
}

// Le taux annuel inclut aussi les taux manuels et replis utilisés par le
// dashboard. Seule l'hypothèse CGI demandée explicitement remplace son taux
// sur cet écran ; ni le relevé ni les autres indicateurs ne sont réécrits.
export function annualStockSimulation(positions: Position[], history: History, now = new Date()) {
  const modeled = positions.map(p => usesCgiSimulation(p, history) ? { ...p, rate: cgiSimulationRate } : p);
  const simulation = simulate(modeled, history, '1 an', now);
  const lines = simulation.lines.map(l => ({
    ...l,
    reason: l.reason || (l.rate === null || Math.abs(l.rate - l.position.rate) > 1e-8 ? 'Le taux du dashboard ne peut pas être reconstruit avec cet historique' : ''),
    rate: l.position.rate,
  }));
  const coveredAmount = lines.filter(l => !l.reason).reduce((sum, l) => sum + l.position.amount, 0);
  const complete = simulation.total > 0 && lines.every(l => !l.reason);
  return {
    ...simulation, lines, coveredAmount,
    coverage: simulation.total ? coveredAmount / simulation.total * 100 : 0,
    rate: simulation.total ? summarize(modeled).rate : null,
    points: complete ? simulation.points : [],
    curveWarning: !complete && simulation.total ? 'La courbe complète est indisponible : certaines lignes ne disposent pas d’un historique permettant de reconstruire leur taux annuel. Seule CGI dans le PEE sans historique bénéficie de l’hypothèse explicite à 30 % par an.' : '',
  };
}

export type Tile = { id: string; amount: number; x: number; y: number; width: number; height: number };
export function heatmapLayout(items: { id: string; amount: number }[], x = 0, y = 0, width = 100, height = 100): Tile[] {
  const positive = items.filter(i => i.amount > 0).sort((a, b) => b.amount - a.amount);
  if (!positive.length) return [];
  if (positive.length === 1) return [{ ...positive[0], x, y, width, height }];
  const total = positive.reduce((s, i) => s + i.amount, 0);
  let sum = positive[0].amount, split = 1;
  while (split < positive.length - 1 && Math.abs(sum + positive[split].amount - total / 2) < Math.abs(sum - total / 2)) sum += positive[split++].amount;
  const ratio = sum / total;
  return width >= height
    ? [...heatmapLayout(positive.slice(0, split), x, y, width * ratio, height), ...heatmapLayout(positive.slice(split), x + width * ratio, y, width * (1 - ratio), height)]
    : [...heatmapLayout(positive.slice(0, split), x, y, width, height * ratio), ...heatmapLayout(positive.slice(split), x, y + height * ratio, width, height * (1 - ratio))];
}
