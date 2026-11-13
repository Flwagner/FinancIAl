import { instrumentFor } from './stock-simulation';
import type { StockLine } from './stock-sort';

export type GroupedStockLine = StockLine & { members: StockLine[] };

function isWorldEtf(line: StockLine) {
  const symbol = instrumentFor(line.position)?.symbol;
  return symbol === 'WPEA.PA' || symbol === 'DCAM.PA' || ['WPEA', 'DCAM'].includes(line.position.name.trim().toUpperCase());
}

// Regroupement d'affichage après calcul individuel : les historiques et les
// poids de chaque instrument restent distincts pour reconstruire la courbe.
export function groupStockLines(lines: StockLine[]): GroupedStockLine[] {
  const members = lines.filter(isWorldEtf);
  let added = false;
  return lines.flatMap(line => {
    if (!isWorldEtf(line)) return [{ ...line, members: [line] }];
    if (added) return [];
    added = true;
    const amount = members.reduce((sum, l) => sum + l.position.amount, 0);
    const rate = amount > 0 && members.every(l => l.position.amount <= 0 || l.rate !== null)
      ? members.reduce((sum, l) => sum + l.position.amount * (l.rate ?? 0), 0) / amount : null;
    return [{
      position: {
        id: 'stock-group:etf-monde', name: 'ETF Monde', group: 'ETF Monde', category: 'Actions',
        envelope: [...new Set(members.map(l => l.position.envelope).filter(Boolean))].join(' · '),
        code: '', amount, rate: rate ?? 0,
      },
      rate, simulated: false, symbol: undefined, prices: [], members,
      reason: members.filter(l => l.position.amount > 0 && l.reason).map(l => `${l.position.name} : ${l.reason}`).join(' · '),
    }];
  });
}

export function stockLineDescription(line: GroupedStockLine) {
  return stockLineIdentifiers(line);
}

export function stockLineTickers(line: GroupedStockLine) {
  return [...new Set(line.members.map(l => {
    const code = instrumentFor(l.position)?.symbol.split('.')[0] || l.position.code.trim();
    return !code ? 'Sans cotation' : /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(code) ? 'Ticker indisponible' : code;
  }))].join(' · ');
}

export function stockLineIdentifiers(line: GroupedStockLine) {
  return [...new Set(line.members.map(l => {
    const instrument = instrumentFor(l.position);
    const code = l.position.code.trim();
    if (!instrument && !code) return 'Sans cotation';
    const isin = instrument && 'isin' in instrument ? instrument.isin : /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(code.toUpperCase()) ? code.toUpperCase() : undefined;
    const symbol = instrument?.symbol.split('.')[0];
    const ticker = symbol && symbol !== isin ? symbol : !instrument && code.toUpperCase() !== isin ? code : undefined;
    return `${ticker || 'Ticker indisponible'} · ${isin || 'ISIN indisponible'}`;
  }))].join(' / ');
}
