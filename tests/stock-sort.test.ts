import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStockSort, sortStockLines, type StockLine, type StockSortKey } from '../src/lib/stock-sort';

const makeLine = (id: string, name: string, envelope: string, amount: number, rate: number | null, reason = '', simulated = false): StockLine => ({
  position: { id, name, envelope, amount, rate: rate ?? 0, category: 'Actions', code: '' },
  rate, reason, simulated, prices: [], symbol: undefined,
});
const lines = [
  makeLine('a', 'Émergents', 'PEA', 1000, 2.3),
  makeLine('b', 'Asie', 'CTO', 9, -10),
  makeLine('c', 'CGI', 'PEE', 20, 30, '', true),
  makeLine('d', 'World', 'PEA', 100, null, 'Historique insuffisant'),
];
const ids = (key: StockSortKey, direction: 'ascending' | 'descending') => sortStockLines(lines, { key, direction }).map(l => l.position.id);

test('tri des montants et poids sur les nombres bruts, pas les chaînes formatées', () => {
  assert.deepEqual(ids('amount', 'ascending'), ['b', 'c', 'd', 'a']);
  assert.deepEqual(ids('amount', 'descending'), ['a', 'd', 'c', 'b']);
  assert.deepEqual(ids('weight', 'ascending'), ids('amount', 'ascending'));
});
test('performances négatives et absentes : absentes toujours en dernier', () => {
  assert.deepEqual(ids('rate', 'ascending'), ['b', 'a', 'c', 'd']);
  assert.deepEqual(ids('rate', 'descending'), ['c', 'a', 'b', 'd']);
});
test('tri français des noms, des enveloppes et du statut de couverture', () => {
  assert.deepEqual(ids('name', 'ascending'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ids('envelope', 'ascending'), ['b', 'a', 'd', 'c']);
  assert.deepEqual(ids('coverage', 'ascending'), ['d', 'a', 'b', 'c']);
});
test('clic répété inverse le sens ; nouvelle colonne démarre en croissant', () => {
  const first = nextStockSort(null, 'amount');
  assert.deepEqual(first, { key: 'amount', direction: 'ascending' });
  assert.equal(nextStockSort(first, 'amount').direction, 'descending');
  assert.equal(nextStockSort({ key: 'amount', direction: 'descending' }, 'amount').direction, 'ascending');
  assert.deepEqual(nextStockSort(first, 'name'), { key: 'name', direction: 'ascending' });
});
test('tri stable, sans mutation des lignes ni de leur ordre source', () => {
  const before = structuredClone(lines);
  const sorted = sortStockLines(lines, { key: 'envelope', direction: 'descending' });
  assert.notEqual(sorted, lines);
  assert.deepEqual(lines, before);
  assert.deepEqual(sortStockLines(lines, null), lines);
});
