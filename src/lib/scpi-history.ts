import type { Portfolio } from './portfolio';
import { latestScpi } from './scpi';

export type ScpiHistoryPoint = { date: string; timestamp: number; capital: number | null; netPayments: number | null; value: number | null };
// Les transactions donnent des flux réels, pas des valorisations historiques.
// Une vente soustrait son montant encaissé, pas un prix de revient supposé.
export function scpiCapitalHistory(data: Portfolio): { points: ScpiHistoryPoint[]; hasPayments: boolean; incompletePayments: boolean } {
  const valuations = new Map<string, number>();
  for (const r of data.readings) {
    const positions = r.positions.filter(p => p.category === 'SCPI');
    if (!r.projected && positions.length) valuations.set(r.date, positions.reduce((s, p) => s + p.amount, 0));
  }
  for (const i of data.scpi?.imports ?? []) valuations.set(i.capturedAt, i.positions.reduce((s, p) => s + p.buyingValue, 0));
  const transactions = latestScpi(data)?.transactions ?? [];
  const completed = transactions.filter(t => !t.inProgress && ['Confirmée par la société de gestion', 'Déclarée hors Louve'].includes(t.status));
  const ignored = transactions.filter(t => !t.inProgress && !completed.includes(t));
  const incompletePayments = ignored.some(t => !/annul|refus|rejet/i.test(t.status));
  const flows = new Map<string, number>();
  if (!incompletePayments) {
    for (const t of completed) flows.set(t.date, (flows.get(t.date) ?? 0) + (t.direction === 'buy' ? t.amount : -t.amount));
  }
  const dates = [...new Set([...valuations.keys(), ...flows.keys()])].sort();
  const firstFlow = [...flows.keys()].sort()[0];
  let cumulative = 0;
  const points = dates.map(date => {
    cumulative += flows.get(date) ?? 0;
    const capital = valuations.get(date) ?? null;
    const netPayments = firstFlow && date >= firstFlow ? cumulative : null;
    return {
      date, timestamp: Date.parse(`${date}T12:00:00Z`),
      capital, netPayments,
      // Série unique : relevé réel en priorité, flux historiques sinon.
      // Garder la provenance pour l'infobulle, sans inventer de valorisation.
      value: capital ?? netPayments,
    };
  });
  return { points, hasPayments: flows.size > 0, incompletePayments };
}
