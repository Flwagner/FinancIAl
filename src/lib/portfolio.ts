import { isKnownMarketCode } from './market';
import { validateScpiStore, type ScpiStore } from './scpi';
export type Position = { id: string; name: string; category: string; envelope: string; code: string; amount: number; rate: number; rateSource?: 'manual' | 'market' | 'louve'; amountSource?: 'manual' | 'louve'; scpiId?: string; scpiRateUnavailable?: boolean; group?: string; rateAsOf?: string };
export type Reading = { id: string; date: string; projected: boolean; total: number; positions: Position[]; categoryRates?: Record<string, number>; kind?: 'current' };
type MonthlySnapshot = { month: string; capturedAt: string; total: number };
type Goals = { capital: number; annual: number; monthly: number };
export type Portfolio = { readings: Reading[]; goals: Goals; updatedAt?: string; monthlySnapshots?: MonthlySnapshot[]; scpi?: ScpiStore };
export function normalizeGoals(goals: Goals): Goals {
  return { ...goals, monthly: goals.annual / 12 };
}
export const defaultGoals: Goals = normalizeGoals({ capital: 250000, annual: 48000, monthly: 0 });
export const categories = ['SCPI', 'Actions', 'Bricks', 'Livret A', 'Assurance vie (fonds €)', 'Obligations', 'Or', 'Crypto', 'Bitcoin'];
export const colors = ['#a3e635', '#818cf8', '#22d3ee', '#fbbf24', '#fb923c', '#f472b6', '#e2c56e', '#2dd4bf', '#c084fc'];
export const euro = (value: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
export const percent = (value: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value) + ' %';
// Axes et légendes : une décimale suffit et le séparateur doit rester français
// (virgule). Un taux entier s'affiche sans décimale inutile (12 % et non 12,0 %).
export const percent1 = (value: number) => {
  const decimals = Number.isInteger(Math.round(value * 10) / 10) ? 0 : 1;
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: 1 }).format(value) + ' %';
};
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
export function monthlyReadings(readings: Reading[], snapshots: MonthlySnapshot[] = []): Reading[] {
  const frozenMonths = new Set(snapshots.map(s => s.month));
  return [
    ...readings.filter(r => r.kind !== 'current' && r.date.endsWith('-01') && !frozenMonths.has(r.date.slice(0, 7))),
    ...snapshots.map(s => ({ id: `monthly-${s.month}`, date: `${s.month}-01`, projected: false, total: s.total, positions: [] })),
  ].sort((a, b) => a.date.localeCompare(b.date));
}
export function evolutionReadings(readings: Reading[], currentTotal: number, snapshots: MonthlySnapshot[] = []) {
  const history = monthlyReadings(readings, snapshots);
  const { projection } = currentReadings(history);
  // La projection courante reflète le même portefeuille que la carte patrimoine.
  return history.map(reading => reading === projection ? { ...reading, total: currentTotal } : reading);
}
export function saveCurrentReading(data: Portfolio, draft: Reading, date: string, id: string): Portfolio {
  const existing = data.readings.find(r => r.date === date);
  let monthlySnapshots = data.monthlySnapshots;
  // Une sauvegarde le 1er ne doit pas effacer un ancien point mensuel réel.
  if (existing && !existing.projected && existing.kind !== 'current' && date.endsWith('-01')
    && !monthlySnapshots?.some(s => s.month === date.slice(0, 7))) {
    monthlySnapshots = [...(monthlySnapshots ?? []), { month: date.slice(0, 7), capturedAt: date, total: existing.total }];
  }
  const reading: Reading = { ...draft, id: existing?.id ?? id, date, projected: false, kind: 'current' };
  return { ...data, ...(monthlySnapshots ? { monthlySnapshots } : {}), readings: [...data.readings.filter(r => r.date !== date), reading] };
}
export function freezeCurrentMonth(data: Portfolio, total: number, date: string, capturedAt: string): Portfolio {
  const month = date.slice(0, 7);
  const next = { ...data, monthlySnapshots: [...(data.monthlySnapshots ?? []).filter(s => s.month !== month), { month, total, capturedAt }] };
  validatePortfolio(next);
  return next;
}
export function validatePortfolio(data: Portfolio) {
  if (data.scpi) validateScpiStore(data.scpi);
  const months = new Set<string>();
  for (const snapshot of data.monthlySnapshots ?? []) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(snapshot.month) || months.has(snapshot.month)) throw new Error('Un seul montant figé par mois est autorisé, avec un mois valide.');
    months.add(snapshot.month);
    if (!Number.isFinite(snapshot.total) || snapshot.total < 0) throw new Error('Total mensuel invalide.');
    if (!Number.isFinite(Date.parse(snapshot.capturedAt))) throw new Error('Date de capture invalide.');
  }
  const dates = new Set<string>();
  for (const r of data.readings) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !Number.isFinite(Date.parse(r.date)) || new Date(r.date).toISOString().slice(0, 10) !== r.date) throw new Error('Date de relevé invalide.');
    if (dates.has(r.date)) throw new Error('Une seule entrée par date est autorisée.');
    dates.add(r.date);
    if (!Number.isFinite(r.total) || r.total < 0) throw new Error('Total invalide.');
    if (Object.values(r.categoryRates || {}).some(v => !Number.isFinite(v))) throw new Error('Taux de catégorie invalide.');
    for (const p of r.positions) {
      if (!p.name.trim() || !p.category.trim() || !Number.isFinite(p.amount) || p.amount < 0 || !Number.isFinite(p.rate)) throw new Error('Placement incomplet ou montant/taux invalide.');
      if (p.rateSource && !['manual', 'market', 'louve'].includes(p.rateSource)) throw new Error('Source du rendement invalide.');
      if (p.amountSource && !['manual', 'louve'].includes(p.amountSource)) throw new Error('Source du montant invalide.');
      if (p.scpiRateUnavailable !== undefined && typeof p.scpiRateUnavailable !== 'boolean') throw new Error('Disponibilité du taux SCPI invalide.');
      if ((p.rateSource === 'louve' || p.amountSource === 'louve') && (p.category !== 'SCPI' || !p.scpiId)) throw new Error('Source Louve réservée aux SCPI identifiées.');
      if (p.rateSource === 'market' && !isKnownMarketCode(p.code)) throw new Error(`Cotation automatique non reconnue : ${p.code}.`);
    }
    if (r.positions.length && Math.abs(summarize(r.positions).total - r.total) > 0.02) throw new Error('Le détail ne correspond pas au total.');
  }
  if (Object.values(data.goals).some(v => !Number.isFinite(v) || v <= 0)) throw new Error('Les objectifs doivent être positifs.');
}
