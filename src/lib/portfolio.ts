import { isKnownMarketCode } from './market';
export type Position = { id: string; name: string; category: string; envelope: string; code: string; amount: number; rate: number; rateSource?: 'manual' | 'market'; group?: string; rateAsOf?: string };
export type Reading = { id: string; date: string; projected: boolean; total: number; positions: Position[]; categoryRates?: Record<string, number> };
export type Goals = { capital: number; annual: number; monthly: number };
export type Portfolio = { readings: Reading[]; goals: Goals; updatedAt?: string };
export function normalizeGoals(goals: Goals): Goals {
  return { ...goals, monthly: goals.annual / 12 };
}
export const defaultGoals: Goals = normalizeGoals({ capital: 250000, annual: 48000, monthly: 0 });
export const categories = ['SCPI', 'Actions', 'Bricks', 'Livret A', 'Assurance vie (fonds €)', 'Obligations', 'Or', 'Crypto', 'Bitcoin'];
export const colors = ['#a3e635', '#818cf8', '#22d3ee', '#fbbf24', '#fb923c', '#f472b6', '#e2c56e', '#2dd4bf', '#c084fc'];
export const euro = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
export const percent = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value) + ' %';
// Taux tel qu'affiché (deux décimales). Le gain annuel en est dérivé pour que
// « rendement × capital » corresponde à la tuile « Gain annuel estimé ».
export const displayedRate = (value: number) => Number(new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, useGrouping: false }).format(value));
export function summarize(positions: Position[], categoryRates: Record<string, number> = {}) {
  const total = positions.reduce((sum, p) => sum + p.amount, 0);
  const annual = positions.reduce((sum, p) => sum + p.amount * (categoryRates[p.category] ?? p.rate) / 100, 0);
  return { total, annual, monthly: annual / 12, rate: total ? annual / total * 100 : 0 };
}
export function aggregate(positions: Position[], field: 'category' | 'envelope') {
  const groups = new Map<string, number>();
  positions.forEach(p => groups.set(p[field] || 'Non renseignée', (groups.get(p[field] || 'Non renseignée') || 0) + p.amount));
  return [...groups].map(([name, value]) => ({ name, value }));
}
export function currentReadings(readings: Reading[]) {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  const actual = sorted.filter(r => !r.projected).at(-1);
  const projection = sorted.find(r => r.projected && (!actual || r.date > actual.date));
  const previous = sorted.filter(r => !r.projected && r.id !== actual?.id).at(-1);
  return { actual, projection, previous, change: projection && actual ? projection.total - actual.total : actual && previous ? actual.total - previous.total : null };
}
// Le dernier détail réel prime sur les projections. Les anciens imports
// associés uniquement à une projection restent disponibles en repli.
export function currentSnapshot(data: Portfolio) {
  const detailed = [...data.readings].filter(r => r.positions.length).sort((a, b) => a.date.localeCompare(b.date));
  return detailed.filter(r => !r.projected).at(-1) ?? detailed.at(-1);
}
export function monthlyReadings(readings: Reading[]) {
  return readings.filter(r => r.date.endsWith('-01'));
}
export function evolutionReadings(readings: Reading[], currentTotal: number) {
  const history = monthlyReadings(readings);
  const { projection } = currentReadings(history);
  // La projection courante reflète le même portefeuille que la carte patrimoine.
  return history.map(reading => reading === projection ? { ...reading, total: currentTotal } : reading);
}
export function validatePortfolio(data: Portfolio) {
  const dates = new Set<string>();
  for (const r of data.readings) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !Number.isFinite(Date.parse(r.date)) || new Date(r.date).toISOString().slice(0, 10) !== r.date) throw new Error('Date de relevé invalide.');
    if (dates.has(r.date)) throw new Error('Une seule entrée par date est autorisée.');
    dates.add(r.date);
    if (!Number.isFinite(r.total) || r.total < 0) throw new Error('Total invalide.');
    if (Object.values(r.categoryRates || {}).some(v => !Number.isFinite(v))) throw new Error('Taux de catégorie invalide.');
    for (const p of r.positions) {
      if (!p.name.trim() || !p.category.trim() || !Number.isFinite(p.amount) || p.amount < 0 || !Number.isFinite(p.rate)) throw new Error('Placement incomplet ou montant/taux invalide.');
      if (p.rateSource && !['manual', 'market'].includes(p.rateSource)) throw new Error('Source du rendement invalide.');
      if (p.rateSource === 'market' && !isKnownMarketCode(p.code)) throw new Error(`Cotation automatique non reconnue : ${p.code}.`);
    }
    if (r.positions.length && Math.abs(summarize(r.positions).total - r.total) > 0.02) throw new Error('Le détail ne correspond pas au total.');
  }
  if (Object.values(data.goals).some(v => !Number.isFinite(v) || v <= 0)) throw new Error('Les objectifs doivent être positifs.');
}
