import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableHeatmap } from '../src/lib/stock-heatmap';

const items = [32090, 5344, 5317, 4933, 3887, 2421].map((amount, i) => ({ id: String(i), amount }));
test('la carte utilise les dimensions réelles et réserve assez de place pour les quatre textes', () => {
  for (const width of [1000, 1450]) {
    const layout = readableHeatmap(items, width);
    assert.equal(layout.proportional, true);
    assert.ok(layout.tiles.every(t => t.width >= 160 && t.height >= 140));
    const total = items.reduce((sum, i) => sum + i.amount, 0);
    for (const t of layout.tiles) assert.ok(Math.abs(t.width * t.height / (width * layout.height) - t.amount / total) < 1e-10);
  }
});
test('sur mobile ou pour une très petite position, priorité à une grille sans texte masqué', () => {
  assert.equal(readableHeatmap(items, 350).proportional, false);
  assert.equal(readableHeatmap([{ id: 'a', amount: 100000 }, { id: 'b', amount: 1 }], 1000).proportional, false);
  assert.equal(readableHeatmap(items, 350).tiles.length, 6);
});
test('les positions nulles sont exclues sans modifier les données', () => {
  const source = [...items, { id: 'zero', amount: 0 }];
  const before = structuredClone(source);
  assert.equal(readableHeatmap(source, 1000).tiles.length, 6);
  assert.deepEqual(source, before);
});
