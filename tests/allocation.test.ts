import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocationCategories, allocationComparison, allocationScore, currentAllocationTarget, defaultGoals, validateAllocationTarget, validatePortfolio, type Portfolio } from '../src/lib/portfolio';
import { portfolioSaveValues } from '../src/lib/portfolio-save';

test('allocation facultative, total exact et pourcentages finis entre zéro et cent', () => {
  validatePortfolio({ readings: [], goals: defaultGoals });
  validateAllocationTarget({ Actions: 33.33, SCPI: 66.67, Or: 0 });
  const invalid: Record<string, number>[] = [{}, { Actions: 99.99 }, { Actions: 100.01 }, { Actions: 101, Or: -1 }, { Actions: NaN }, { Actions: Infinity }];
  for (const target of invalid) {
    assert.throws(() => validateAllocationTarget(target));
  }
});

test('initialisation réelle : arrondis au centième totalisant exactement cent', () => {
  const target = currentAllocationTarget([{ name: 'Actions', value: 1 }, { name: 'SCPI', value: 1 }, { name: 'Or', value: 1 }]);
  validateAllocationTarget(target);
  assert.deepEqual(Object.values(target).sort(), [33.33, 33.33, 33.34]);
  assert.deepEqual(currentAllocationTarget([{ name: 'Or', value: 0 }]), { Or: 0 });
});

test('score : identité, écart sans double comptage, répartitions disjointes et absence de capital', () => {
  const groups = [{ name: 'Actions', value: 600 }, { name: 'SCPI', value: 400 }];
  assert.equal(allocationScore(groups, { Actions: 60, SCPI: 40 }), 100);
  assert.equal(allocationScore(groups, { Actions: 50, SCPI: 50 }), 90);
  assert.equal(allocationScore(groups, { Or: 100 }), 0);
  assert.equal(allocationScore([], { Actions: 100 }), null);
  assert.equal(allocationScore([{ name: 'Actions', value: 0 }], { Actions: 100 }), null);
  assert.equal(allocationScore(groups.map(group => ({ ...group, value: group.value * 10 })), { Actions: 50, SCPI: 50 }), 90);
});

test('comparaison : écarts en points et euros à patrimoine constant sans mutation', () => {
  const groups = [{ name: 'Actions', value: 600 }, { name: 'SCPI', value: 400 }];
  const target = { Actions: 50, SCPI: 40, Or: 10 };
  const before = structuredClone({ groups, target });
  const rows = allocationComparison(groups, target);
  assert.deepEqual(rows[0], { name: 'Actions', value: 600, actual: 60, target: 50, gap: 10, euroGap: 100 });
  assert.equal(rows.find(row => row.name === 'Or')?.euroGap, -100);
  assert.equal(rows.reduce((sum, row) => sum + row.euroGap, 0), 0);
  assert.deepEqual({ groups, target }, before);
});

test('classe détenue sans cible = zéro ; classe cible sans capital reste visible', () => {
  assert.equal(allocationComparison([{ name: 'Or', value: 100 }], { Actions: 100 }).find(row => row.name === 'Or')?.target, 0);
  const rows = allocationComparison([], { Actions: 100 });
  assert.equal(rows[0].actual, 0);
  assert.equal(rows[0].euroGap, 0);
});

test('catégories : seulement celles du détail actuel et de la cible sauvegardée', () => {
  const data: Portfolio = { readings: [], goals: defaultGoals, allocationTarget: { SCPI: 100, Or: 0 } };
  assert.deepEqual(allocationCategories(data), ['SCPI', 'Or']);
  assert.deepEqual(allocationCategories({ ...data, allocationTarget: undefined }), []);
});

test('sauvegarde JSON : cible préservée sans modifier les relevés ni leur date', () => {
  const previous: Portfolio = { readings: [], goals: defaultGoals };
  const next = { ...previous, allocationTarget: { Actions: 100 } };
  const saved = portfolioSaveValues(next, previous);
  assert.deepEqual(saved.data.allocationTarget, next.allocationTarget);
  assert.deepEqual(saved.data.readings, previous.readings);
  assert.equal(Object.hasOwn(saved, 'updated_at'), false);
  const removed = { ...next };
  delete (removed as Portfolio).allocationTarget;
  assert.equal(Object.hasOwn(portfolioSaveValues(removed, next).data, 'allocationTarget'), false);
});
