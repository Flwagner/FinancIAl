import type { Position, Reading } from './portfolio';
import type { SyncImpact } from './sync-impact';

export const marketInstruments = [
  { symbol: 'WPEA.PA', code: 'EPA:WPEA', name: 'iShares MSCI World Swap PEA', currency: 'EUR' },
  { symbol: 'DCAM.PA', code: 'EPA:DCAM', name: 'Amundi PEA Monde', currency: 'EUR' },
  { symbol: 'PCEU.PA', code: 'EPA:PCEU', name: 'Amundi PEA MSCI Europe', currency: 'EUR' },
  { symbol: 'PAEEM.PA', code: 'EPA:PAEEM', name: 'Amundi PEA Émergent', currency: 'EUR' },
  { symbol: 'PAASI.PA', code: 'EPA:PAASI', name: 'Amundi PEA Asie Émergente', currency: 'EUR' },
  // JEQP.L est coté en pence sterling, pas en USD et pas l'ETF américain JEPQ.
  { symbol: 'JEQP.L', code: 'LON:JEQP', name: 'JPM Nasdaq Equity Premium Income UCITS Dist', currency: 'GBp' },
  { symbol: 'GLD', code: 'NYSEARCA:GLD', name: 'SPDR Gold Shares', currency: 'USD' },
  { symbol: 'BTC-EUR', code: 'BTCEUR', name: 'Bitcoin / euro', currency: 'EUR' },
] as const;

export type MarketPrice = { date: string; close: number; adjusted_close: number };
export type MarketReturn = {
  symbol: string;
  as_of: string;
  start_date: string;
  start_price: number;
  end_price: number;
  rate: number;
  currency: string;
  method: 'adjusted_close_365d';
  fetched_at: string;
};
export type MarketStatus = { symbol: string; last_attempt_at: string; error: string | null };
export type MarketData = { returns: MarketReturn[]; statuses: MarketStatus[]; impact?: SyncImpact | null; error?: string; loading?: boolean };

export function symbolForCode(code: string): string | undefined {
  const normalized = code.trim().toUpperCase();
  return marketInstruments.find(i => i.code.toUpperCase() === normalized || i.symbol === normalized)?.symbol;
}

const dayMs = 86_400_000;
export function calculateReturn(symbol: string, currency: string, prices: MarketPrice[], now = new Date()): MarketReturn {
  const today = now.toISOString().slice(0, 10);
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const dates = new Set<string>();
  for (const p of sorted) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || !Number.isFinite(Date.parse(p.date)) || new Date(p.date).toISOString().slice(0, 10) !== p.date) throw new Error('Date de cours invalide.');
    if (dates.has(p.date)) throw new Error('Cours dupliqué.');
    dates.add(p.date);
    if (!Number.isFinite(p.close) || p.close <= 0 || !Number.isFinite(p.adjusted_close) || p.adjusted_close <= 0) throw new Error('Cours ajusté manquant ou invalide.');
  }
  // Le cours du jour peut être une bougie intraday : uniquement les jours terminés.
  const settled = sorted.filter(p => p.date < today);
  const end = settled.at(-1);
  if (!end || Date.parse(today) - Date.parse(end.date) > 7 * dayMs) throw new Error('Aucun cours de clôture récent (moins de 7 jours).');
  const target = new Date(Date.parse(end.date) - 365 * dayMs).toISOString().slice(0, 10);
  const start = settled.find(p => p.date >= target);
  if (!start || Date.parse(start.date) - Date.parse(target) > 7 * dayMs || start.date === end.date) throw new Error('Historique insuffisant pour calculer 365 jours.');
  const rate = (end.adjusted_close / start.adjusted_close - 1) * 100;
  return { symbol, currency, as_of: end.date, start_date: start.date, start_price: start.adjusted_close, end_price: end.adjusted_close, rate, method: 'adjusted_close_365d', fetched_at: now.toISOString() };
}

export function livePositions(reading: Reading | undefined, market: MarketData, now = new Date()) {
  const updated: string[] = [];
  const warnings: string[] = [];
  const positions = (reading?.positions || []).map(p => {
    if (p.rateSource !== 'market') return p;
    const symbol = symbolForCode(p.code);
    const value = market.returns.find(r => r.symbol === symbol);
    const status = market.statuses.find(s => s.symbol === symbol);
    if (!value || !Number.isFinite(value.rate) || value.method !== 'adjusted_close_365d') {
      warnings.push(`${p.name} : rendement automatique indisponible, taux du relevé conservé.`);
      return p;
    }
    const age = Date.parse(now.toISOString().slice(0, 10)) - Date.parse(value.as_of);
    if (!Number.isFinite(age) || age > 7 * dayMs || age < 0 || status?.error) warnings.push(`${p.name} : dernière valeur connue au ${value.as_of}${status?.error ? ' (échec de la dernière synchronisation)' : ' (donnée ancienne ou date invalide)'}.`);
    updated.push(value.as_of);
    return { ...p, rate: value.rate, rateAsOf: value.as_of };
  });
  // Un ancien taux de synthèse ne doit jamais masquer un taux automatique.
  const categoryRates = { ...reading?.categoryRates };
  positions.filter(p => p.rateSource === 'market').forEach(p => delete categoryRates[p.category]);
  if (market.error && positions.some(p => p.rateSource === 'market')) warnings.push(market.error);
  // Une réponse encore en attente n'est pas une indisponibilité du marché.
  return { positions, categoryRates, warnings: market.loading ? [] : warnings, updatedAt: updated.sort()[0] };
}

export function groupedInvestments(positions: Position[]) {
  const groups = new Map<string, { name: string; value: number; gain: number }>();
  for (const p of positions) {
    const name = p.group?.trim() || p.name;
    const group = groups.get(name) || { name, value: 0, gain: 0 };
    group.value += p.amount;
    group.gain += p.amount * p.rate / 100;
    groups.set(name, group);
  }
  return [...groups.values()].map(g => ({ ...g, rate: g.value ? g.gain / g.value * 100 : 0 }));
}

export function freezeChangedReadings(previous: Reading[], next: Reading[], market: MarketData): Reading[] {
  const oldReadings = new Map(previous.map(r => [r.id, JSON.stringify(r)]));
  return next.map(r => {
    if (oldReadings.get(r.id) === JSON.stringify(r)) return r;
    const live = livePositions(r, market);
    return { ...r, positions: live.positions, categoryRates: live.categoryRates };
  });
}
