import Papa from 'papaparse';
import { defaultGoals, summarize, validatePortfolio, type Portfolio, type Position, type Reading } from './portfolio';
import { symbolForCode } from './market';
export function numberFR(value: string): number {
  const text = value.replace(/[\s\u00a0\u202f€%]/g, '').replace(',', '.');
  if (!text || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) throw new Error(`Nombre invalide : « ${value} »`);
  const n = Number(text);
  if (!Number.isFinite(n)) throw new Error('Nombre non fini.');
  return n;
}
function rows(text: string, headers: string[]): string[][] {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  if (result.errors.length) throw new Error(`CSV invalide : ${result.errors[0].message}`);
  const normalize = (s: string) => s.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (headers.some((h, i) => normalize(result.data[0]?.[i] || '') !== normalize(h))) throw new Error(`Colonnes CSV attendues : ${headers.join(', ')}.`);
  return result.data.slice(1).filter(r => r[0]?.trim());
}
function dateFR(value: string) {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return value.trim();
}
export type ImportFiles = { evolution: string; portfolio: string; scpi: string; actions: string };
export function importSheets(files: ImportFiles, detailDate: string, projectionFrom: string): { data: Portfolio; warnings: string[] } {
  if (!detailDate || !projectionFrom) throw new Error('Renseigne la date du détail et le début des projections.');
  for (const date of [detailDate, projectionFrom]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Date d’import invalide.');
  }
  const warnings: string[] = [];
  const positions: Position[] = [];
  const categoryRates: Record<string, number> = {};
  const totals = new Map<string, number>();
  const add = (name: string, category: string, amount: string, rate: string, envelope = 'Direct', code = '') => {
    positions.push({ id: `import-${positions.length}`, name: name.trim(), category, envelope: envelope.trim(), code: code.trim(), amount: numberFR(amount), rate: numberFR(rate) });
  };
  for (const r of rows(files.portfolio, ['Support', 'Taux', 'Montant'])) {
    const category = r[0].trim();
    if (totals.has(category)) throw new Error(`Catégorie dupliquée : ${category}`);
    categoryRates[category] = numberFR(r[1]);
    totals.set(category, numberFR(r[2]));
    if (!['SCPI', 'Actions'].includes(category)) add(category, category, r[2], r[1], category === 'Assurance vie (fonds €)' ? 'Assurance vie' : 'Direct', r[5] || '');
  }
  for (const r of rows(files.scpi, ['Nom', 'Montant', 'Rendement'])) add(r[0], 'SCPI', r[1], r[2]);
  const actionRows = rows(files.actions, ['Nom', 'Montant', 'Code', 'Rendement', 'Support']);
  const underlying = actionRows.filter(r => r[8]?.trim() && r[9]?.trim());
  for (const r of actionRows) {
    if (r[0].trim().toLowerCase() === 'etf monde' && underlying.length) {
      const expected = numberFR(r[1]);
      const actual = underlying.reduce((sum, u) => sum + numberFR(u[9]), 0);
      if (Math.abs(actual - expected) > 0.02) throw new Error('Le détail WPEA/DCAM ne correspond pas au montant ETF Monde.');
      for (const u of underlying) {
        if (!symbolForCode(u[10] || '')) throw new Error(`Cotation non reconnue pour le sous-jacent ${u[8]}.`);
        add(u[8], 'Actions', u[9], u[11], r[4] || '', u[10]);
        positions.at(-1)!.group = 'ETF Monde';
      }
      warnings.push('ETF Monde remplacé par ses lignes WPEA/DCAM : rendement pondéré par leurs montants, aucun double comptage.');
    } else {
      add(r[0], 'Actions', r[1], r[3], r[4] || '', r[2] || '');
      if (r[0].trim().toLowerCase() === 'etf monde') warnings.push('ETF Monde reste agrégé : aucun détail WPEA/DCAM trouvé. Ajoute ses deux lignes dans un prochain relevé pour automatiser son rendement.');
    }
  }
  for (const position of positions) position.rateSource = symbolForCode(position.code) ? 'market' : 'manual';
  // Recalcul depuis toutes les lignes, JEQP compris. Les taux manuels restent individuels.
  delete categoryRates.Actions;
  delete categoryRates.SCPI;
  for (const category of ['SCPI', 'Actions']) {
    const detail = summarize(positions.filter(p => p.category === category)).total;
    const total = totals.get(category);
    if (total === undefined || Math.abs(detail - total) > 0.02) throw new Error(`Le total ${category} du portefeuille (${total}) ne correspond pas au détail (${detail}). Corrige les exports avant l’import.`);
  }
  const readings: Reading[] = rows(files.evolution, ['Période', 'Montant']).filter(r => r[1]?.trim()).map((r, i) => {
    const date = dateFR(r[0]);
    return { id: `history-${i}`, date, projected: date >= projectionFrom, total: numberFR(r[1]), positions: [] };
  });
  const total = summarize(positions).total;
  const existing = readings.find(r => r.date === detailDate);
  if (existing && Math.abs(existing.total - total) > 1) throw new Error('Le total détaillé ne correspond pas à la date choisie dans Évolution (tolérance de 1 € pour les arrondis).');
  const detail: Reading = { id: existing?.id || 'initial-detail', date: detailDate, total, projected: detailDate >= projectionFrom, positions, categoryRates };
  const data: Portfolio = { goals: { ...defaultGoals }, readings: [...readings.filter(r => r.date !== detailDate), detail].sort((a, b) => a.date.localeCompare(b.date)) };
  validatePortfolio(data);
  warnings.push('Rendements Actions et SCPI recalculés depuis les placements détaillés ; JEQP est inclus. Les ETF reconnus utilisent automatiquement les dernières performances disponibles, sinon le taux importé sert de repli.');
  return { data, warnings };
}
