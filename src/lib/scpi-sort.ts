import type { Position } from './portfolio';
import type { ScpiImport } from './scpi';

export const scpiColumns = [
  ['name', 'SCPI'], ['shares', 'Parts / détention'], ['invested', 'Investi'],
  ['amount', 'Valorisation'], ['weight', 'Poids'], ['rate', 'Taux annuel'],
  ['monthly', 'Revenus mensuels théoriques'], ['gain', 'Plus/moins-value'],
] as const;
export type ScpiSortKey = typeof scpiColumns[number][0];
export type ScpiSort = { key: ScpiSortKey; direction: 'ascending' | 'descending' };
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

export function nextScpiSort(current: ScpiSort | null, key: ScpiSortKey): ScpiSort {
  return { key, direction: current?.key === key && current.direction === 'ascending' ? 'descending' : 'ascending' };
}

export function sortScpiPositions(positions: Position[], imported: ScpiImport | undefined, sort: ScpiSort | null): Position[] {
  if (!sort) return [...positions];
  const key = sort.key;
  const direction = sort.direction === 'ascending' ? 1 : -1;
  const lines = new Map(imported?.positions.map(p => [p.id, p]) ?? []);
  function numeric(p: Position): number | null {
    const line = p.scpiId ? lines.get(p.scpiId) : undefined;
    let value: number | undefined;
    switch (key) {
      case 'shares': value = line?.shares; break;
      case 'invested': value = line?.invested; break;
      case 'amount':
      case 'weight': value = p.amount; break; // même dénominateur pour tous les poids
      case 'rate': value = p.scpiRateUnavailable ? undefined : p.rate; break;
      case 'monthly': value = p.scpiRateUnavailable ? undefined : p.amount * p.rate / 1200; break;
      case 'gain': value = line && p.amountSource !== 'manual' ? p.amount - line.invested : undefined; break;
    }
    return value !== undefined && Number.isFinite(value) ? value : null;
  }
  return [...positions].sort((a, b) => {
    if (sort.key === 'name') return collator.compare(a.name, b.name) * direction;
    const av = numeric(a), bv = numeric(b);
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    if (av === bv && sort.key === 'shares') {
      return collator.compare(lines.get(a.scpiId ?? '')?.ownership.join(', ') ?? '', lines.get(b.scpiId ?? '')?.ownership.join(', ') ?? '') * direction;
    }
    return (av - bv) * direction;
  });
}
