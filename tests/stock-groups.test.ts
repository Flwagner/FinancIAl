import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupStockLines, stockLineDescription, stockLineIdentifiers, stockLineTickers } from '../src/lib/stock-groups';
import { sortStockLines, type StockLine } from '../src/lib/stock-sort';
import { annualStockSimulation, type History } from '../src/lib/stock-simulation';

const line = (id: string, code: string, amount: number, rate: number | null, envelope = 'PEA'): StockLine => ({
  position: { id, code, amount, rate: rate ?? 0, name: id, envelope, category: 'Actions' },
  rate, reason: '', simulated: false, prices: [], symbol: undefined,
});
const wpea = line('World iShares', 'IE0002XZSHO1', 750, 17);
const dcam = line('World Amundi', 'EPA:DCAM', 250, 21.2);
const europe = line('Europe', 'EPA:PCEU', 500, 6);

test('WPEA et DCAM : une ligne ETF Monde, montant additionné et performance pondérée', () => {
  const groups = groupStockLines([wpea, europe, dcam]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].position.name, 'ETF Monde');
  assert.equal(groups[0].position.amount, 1000);
  assert.ok(Math.abs(groups[0].rate! - 18.05) < 1e-9);
  assert.deepEqual(groups[0].members, [wpea, dcam]);
  assert.equal(stockLineDescription(groups[0]), 'WPEA · IE0002XZSHO1 / DCAM · FR001400U5Q4');
  assert.equal(stockLineTickers(groups[0]), 'WPEA · DCAM');
  assert.equal(groups[1].position.name, 'Europe');
  assert.equal(groups.reduce((sum, l) => sum + l.position.amount, 0), 1500);
});
test('Tous et filtres : les montants des enveloppes restent identifiables et sans doublon', () => {
  const cto = { ...dcam, position: { ...dcam.position, envelope: 'CTO' } };
  const all = groupStockLines([wpea, cto]);
  assert.equal(all[0].position.envelope, 'PEA · CTO');
  const pea = groupStockLines([wpea]);
  assert.equal(pea[0].position.name, 'ETF Monde');
  assert.equal(pea[0].position.amount, 750);
  assert.equal(pea[0].rate, 17);
});
test('historique manquant : aucune performance complète inventée pour le groupe', () => {
  const missing = { ...dcam, rate: null, reason: 'Historique insuffisant' };
  const group = groupStockLines([wpea, missing])[0];
  assert.equal(group.rate, null);
  assert.match(group.reason, /World Amundi : Historique insuffisant/);
  assert.equal(group.position.amount, 1000);
});
test('le détail du groupe utilise ses deux historiques et reproduit son taux pondéré', () => {
  const history: History = Object.fromEntries([['WPEA.PA', 17], ['DCAM.PA', 21.2]].map(([symbol, rate]) => [symbol, [
    { date: '2025-11-12', close: 100, adjusted_close: 100 },
    { date: '2026-05-12', close: 110, adjusted_close: 110 },
    { date: '2026-11-12', close: 100 + Number(rate), adjusted_close: 100 + Number(rate) },
  ]]));
  const group = groupStockLines([wpea, dcam])[0];
  const detail = annualStockSimulation(group.members.map(l => l.position), history, new Date('2026-11-13T12:00:00Z'));
  assert.equal(detail.rate, group.rate);
  assert.ok(Math.abs(detail.points.at(-1)!.rate - group.rate!) < 1e-9);
});
test('le tri fonctionne sur le groupe fusionné et conserve ses membres pour le clic', () => {
  const sorted = sortStockLines(groupStockLines([wpea, europe, dcam]), { key: 'amount', direction: 'ascending' });
  assert.equal(sorted[0].position.name, 'Europe');
  assert.equal(sorted[1].position.name, 'ETF Monde');
  assert.equal(sorted[1].members.length, 2);
});
test('aucune modification des positions ou de leur ordre source', () => {
  const lines = [wpea, europe, dcam];
  const before = structuredClone(lines);
  groupStockLines(lines);
  assert.deepEqual(lines, before);
});

test('ticker et ISIN sont affichés quel que soit le code saisi', () => {
  for (const code of ['EPA:PCEU', 'PCEU.PA', 'FR0013412038']) {
    const group = groupStockLines([line('Europe', code, 100, 6)])[0];
    assert.equal(stockLineIdentifiers(group), 'PCEU · FR0013412038');
    assert.equal(stockLineDescription(group), 'PCEU · FR0013412038');
    assert.equal(stockLineTickers(group), 'PCEU');
  }
});
test('identifiants absents : aucun ISIN ni ticker inventé', () => {
  assert.equal(stockLineIdentifiers(groupStockLines([line('CGI', '', 100, 30)])[0]), 'Sans cotation');
  assert.equal(stockLineIdentifiers(groupStockLines([line('Inconnu', 'FR0000000001', 100, 6)])[0]), 'Ticker indisponible · FR0000000001');
  assert.equal(stockLineTickers(groupStockLines([line('Inconnu', 'FR0000000001', 100, 6)])[0]), 'Ticker indisponible');
});
