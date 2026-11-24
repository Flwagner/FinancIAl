import test from 'node:test';
import assert from 'node:assert/strict';
import { nextScpiSort, scpiColumns, sortScpiPositions, type ScpiSortKey } from '../src/lib/scpi-sort';
import type { Position } from '../src/lib/portfolio';
import type { ScpiImport } from '../src/lib/scpi';

const positions: Position[] = [
  { id: 'a', scpiId: 'a', name: 'Épargne', category: 'SCPI', code: '', envelope: 'Direct', amount: 1000, rate: 2 },
  { id: 'b', scpiId: 'b', name: 'Atlas', category: 'SCPI', code: '', envelope: 'Direct', amount: 9, rate: 10 },
  { id: 'c', scpiId: 'c', name: 'Comète', category: 'SCPI', code: '', envelope: 'Direct', amount: 20, rate: 1 },
  { id: 'd', name: 'Zen', category: 'SCPI', code: '', envelope: 'Direct', amount: 100, rate: 0, scpiRateUnavailable: true },
];
const imported: ScpiImport = {
  version: 1, source: 'louve', capturedAt: '2026-11-24', complete: true, facts: [], transactions: [],
  positions: [
    { id: 'a', name: 'Épargne', shares: 10, invested: 900, buyingValue: 1000, withdrawalValue: 900, ownership: ['Pleine propriété'] },
    { id: 'b', name: 'Atlas', shares: 2, invested: 10, buyingValue: 9, withdrawalValue: 9, ownership: ['Pleine propriété'] },
    { id: 'c', name: 'Comète', shares: 3, invested: 20, buyingValue: 20, withdrawalValue: 18, ownership: ['Nue-propriété'] },
  ],
};
const ids = (key: ScpiSortKey, direction: 'ascending' | 'descending' = 'ascending') => sortScpiPositions(positions, imported, { key, direction }).map(p => p.id);
test('SCPI : chaque colonne est triable et le clic inverse le sens', () => {
  assert.equal(scpiColumns.length, 8);
  for (const [key] of scpiColumns) {
    const first = nextScpiSort(null, key);
    assert.equal(first.direction, 'ascending');
    assert.equal(nextScpiSort(first, key).direction, 'descending');
  }
  assert.deepEqual(nextScpiSort({ key: 'rate', direction: 'descending' }, 'name'), { key: 'name', direction: 'ascending' });
});
test('SCPI : montants et poids triés numériquement, noms en français', () => {
  assert.deepEqual(ids('amount'), ['b', 'c', 'd', 'a']);
  assert.deepEqual(ids('weight', 'descending'), ['a', 'd', 'c', 'b']);
  assert.deepEqual(ids('name'), ['b', 'c', 'a', 'd']);
});
test('SCPI : parts et investissement, absences toujours en dernier', () => {
  assert.deepEqual(ids('shares'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ids('shares', 'descending'), ['a', 'c', 'b', 'd']);
  assert.deepEqual(ids('invested', 'descending'), ['a', 'c', 'b', 'd']);
});
test('SCPI : taux et revenus utilisent les valeurs brutes, pas les textes arrondis', () => {
  assert.deepEqual(ids('rate'), ['c', 'a', 'b', 'd']);
  assert.deepEqual(ids('rate', 'descending'), ['b', 'a', 'c', 'd']);
  assert.deepEqual(ids('monthly'), ['c', 'b', 'a', 'd']);
  assert.deepEqual(ids('monthly', 'descending'), ['a', 'b', 'c', 'd']);
});
test('SCPI : plus/moins-values en euros, négatives et nulles incluses', () => {
  assert.deepEqual(ids('gain'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ids('gain', 'descending'), ['a', 'c', 'b', 'd']);
  const manual = positions.map(p => p.id === 'a' ? { ...p, amountSource: 'manual' as const } : p);
  assert.deepEqual(sortScpiPositions(manual, imported, { key: 'gain', direction: 'descending' }).map(p => p.id), ['c', 'b', 'a', 'd']);
});
test('SCPI : tri stable, aucun changement du portefeuille ni de son ordre source', () => {
  const before = structuredClone(positions);
  assert.notEqual(sortScpiPositions(positions, imported, null), positions);
  assert.deepEqual(sortScpiPositions(positions, undefined, { key: 'shares', direction: 'descending' }), positions);
  assert.deepEqual(positions, before);
});
