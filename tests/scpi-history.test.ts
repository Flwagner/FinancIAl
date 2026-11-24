import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultGoals, type Portfolio } from '../src/lib/portfolio';
import { scpiCapitalHistory } from '../src/lib/scpi-history';
import type { ScpiTransaction } from '../src/lib/scpi';

const transaction = (id: string, date: string, direction: 'buy' | 'sell', amount: number, inProgress = false): ScpiTransaction => ({
  id, scpiId: 'scpi', date, direction, amount, shares: 1, ownership: 'Pleine propriété', external: false, inProgress, status: 'Confirmée par la société de gestion',
});
function portfolio(transactions: ScpiTransaction[]): Portfolio {
  return {
    goals: defaultGoals,
    readings: [{ id: 'actual', date: '2026-11-01', projected: false, total: 150, positions: [{ id: 'p', category: 'SCPI', name: 'SCPI', code: '', envelope: 'Direct', amount: 150, rate: 5 }] }],
    scpi: { imports: [{ version: 1, source: 'louve', complete: true, capturedAt: '2026-11-24', transactions, facts: [], positions: [{ id: 'scpi', name: 'SCPI', shares: 1, invested: 130, buyingValue: 160, withdrawalValue: 150, ownership: ['Pleine propriété'] }] }] },
  };
}
test('historique SCPI : commence à la première opération, sans inventer les valorisations', () => {
  const result = scpiCapitalHistory(portfolio([transaction('a', '2022-08-03', 'buy', 100), transaction('b', '2023-01-01', 'buy', 50)]));
  assert.equal(result.points[0].date, '2022-08-03');
  assert.equal(result.points[0].timestamp, Date.parse('2022-08-03T12:00:00Z'));
  assert.equal(result.points[0].capital, null);
  assert.equal(result.points[0].netPayments, 100);
  assert.equal(result.points[0].value, 100);
  assert.equal(result.points.at(-1)?.netPayments, 150);
  assert.equal(result.points.at(-1)?.capital, 160);
  assert.equal(result.points.at(-1)?.value, 160);
});
test('les ventes exécutées soustraient leur montant, les opérations en cours restent exclues', () => {
  const result = scpiCapitalHistory(portfolio([
    transaction('a', '2022-08-03', 'buy', 100),
    transaction('b', '2025-02-01', 'sell', 20),
    transaction('pending', '2026-09-01', 'sell', 80, true),
  ]));
  assert.equal(result.points.at(-1)?.netPayments, 80);
  assert.ok(!result.points.some(p => p.date === '2026-09-01'));
});
test('plusieurs opérations le même jour sont agrégées et les opérations externes sont incluses', () => {
  const external = { ...transaction('b', '2022-08-03', 'buy', 30), external: true, status: 'Déclarée hors Louve' };
  const result = scpiCapitalHistory(portfolio([transaction('a', '2022-08-03', 'buy', 100), external]));
  assert.equal(result.points[0].netPayments, 130);
});
test('un statut inconnu ne produit pas une fausse courbe complète', () => {
  const result = scpiCapitalHistory(portfolio([{ ...transaction('a', '2022-08-03', 'buy', 100), status: 'Statut inconnu' }]));
  assert.equal(result.incompletePayments, true);
  assert.equal(result.hasPayments, false);
  assert.ok(result.points.every(p => p.netPayments === null));
});
test('les opérations annulées et les projections ne sont pas assimilées à des points réels', () => {
  const data = portfolio([{ ...transaction('a', '2022-08-03', 'buy', 100), status: 'Annulée' }]);
  data.readings.push({ ...data.readings[0], id: 'projection', date: '2027-01-01', projected: true });
  const result = scpiCapitalHistory(data);
  assert.equal(result.incompletePayments, false);
  assert.equal(result.hasPayments, false);
  assert.ok(!result.points.some(p => p.date === '2027-01-01' || p.date === '2022-08-03'));
});
