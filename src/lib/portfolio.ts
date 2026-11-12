import { symbolForCode } from './market';
export type Position = { id: string; name: string; category: string; envelope: string; code: string; amount: number; rate: number; rateSource?: 'manual' | 'market'; group?: string; rateAsOf?: string };
export type Reading = { id: string; date: string; projected: boolean; total: number; positions: Position[]; categoryRates?: Record<string, number> };
export type Goals = { capital: number; annual: number; monthly: number };
export type Portfolio = { readings: Reading[]; goals: Goals };
export const defaultGoals: Goals = { capital: 250000, annual: 48000, monthly: 3000 };
export const categories = ['SCPI', 'Actions', 'Bricks', 'Livret A', 'Assurance vie (fonds €)', 'Obligations', 'Or', 'Crypto', 'Bitcoin'];
export const colors = ['#a3e635', '#818cf8', '#22d3ee', '#fbbf24', '#fb923c', '#f472b6', '#e2c56e', '#2dd4bf', '#c084fc'];
export const euro = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
export const percent = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value) + ' %';
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
      if (p.rateSource === 'market' && !symbolForCode(p.code)) throw new Error(`Cotation automatique non reconnue : ${p.code}.`);
    }
    if (r.positions.length && Math.abs(summarize(r.positions).total - r.total) > 0.02) throw new Error('Le détail ne correspond pas au total.');
  }
  if (Object.values(data.goals).some(v => !Number.isFinite(v) || v <= 0)) throw new Error('Les objectifs doivent être positifs.');
}
