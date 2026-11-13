import type { simulate } from './stock-simulation';

export type StockLine = ReturnType<typeof simulate>['lines'][number];
export type StockSortKey = 'name' | 'envelope' | 'amount' | 'weight' | 'rate' | 'coverage';
export type StockSort = { key: StockSortKey; direction: 'ascending' | 'descending' };
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

export function stockCoverageLabel(line: StockLine) {
  return line.reason || (line.rate === null ? 'Pas de dates communes' : line.simulated ? 'Simulation · 30 % / an — aucun historique CGI' : 'Incluse');
}

export function nextStockSort(current: StockSort | null, key: StockSortKey): StockSort {
  return { key, direction: current?.key === key ? current.direction === 'ascending' ? 'descending' : 'ascending' : 'ascending' };
}

export function sortStockLines<T extends StockLine>(lines: T[], sort: StockSort | null): T[] {
  if (!sort) return [...lines];
  const direction = sort.direction === 'ascending' ? 1 : -1;
  return [...lines].sort((a, b) => {
    if (sort.key === 'rate') {
      // Les performances absentes restent à la fin dans les deux sens.
      const av = a.rate !== null && Number.isFinite(a.rate) ? a.rate : null;
      const bv = b.rate !== null && Number.isFinite(b.rate) ? b.rate : null;
      if (av === null) return bv === null ? 0 : 1;
      if (bv === null) return -1;
      return (av - bv) * direction;
    }
    // Le poids partage le même dénominateur pour toutes les lignes.
    if (sort.key === 'amount' || sort.key === 'weight') return (a.position.amount - b.position.amount) * direction;
    const av = sort.key === 'coverage' ? stockCoverageLabel(a) : a.position[sort.key];
    const bv = sort.key === 'coverage' ? stockCoverageLabel(b) : b.position[sort.key];
    return collator.compare(av, bv) * direction;
  });
}
