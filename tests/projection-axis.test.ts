import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectionAxis, projectionAxisLabel } from '../src/lib/projection-axis';

test('paliers significatifs de 500 000 € pour une projection à environ 2,1 millions', () => {
  const axis = projectionAxis([245777.08, 2124807]);
  assert.deepEqual(axis.domain, [0, 2500000]);
  assert.deepEqual(axis.ticks, [0, 500000, 1000000, 1500000, 2000000, 2500000]);
});
test('paliers adaptés aux petits et grands portefeuilles, sans couper le maximum', () => {
  assert.deepEqual(projectionAxis([80000]).ticks, [0, 20000, 40000, 60000, 80000]);
  for (const value of [1, 123.45, 12345, 245777.08, 500000.01, 1250000, 10000000, 1e20]) {
    const axis = projectionAxis([value]);
    assert.ok(axis.domain[1] >= value);
    assert.ok(axis.ticks.length >= 3 && axis.ticks.length <= 7);
    assert.ok(axis.ticks.every(Number.isFinite));
    assert.equal(axis.ticks[0], 0);
  }
});
test('l’axe tient compte de toutes les courbes, y compris un pic intermédiaire ou les apports', () => {
  const axis = projectionAxis([10000, 4000000, 2000000, 3000000]);
  assert.equal(axis.domain[1], 4000000);
  assert.deepEqual(axis.ticks, [0, 1000000, 2000000, 3000000, 4000000]);
});
test('graphe vide, taux nuls et données non finies : bornes sûres', () => {
  assert.deepEqual(projectionAxis([]).domain, [0, 1000]);
  assert.deepEqual(projectionAxis([0, NaN, Infinity, -10]).domain, [0, 1000]);
  assert.deepEqual(projectionAxis([245777.08, 245777.08]).domain, [0, 250000]);
});
test('libellés français : les paliers de 250 000 € restent exacts en millions', () => {
  assert.equal(projectionAxisLabel(500000), '500\u00a0k €');
  assert.equal(projectionAxisLabel(1000000), '1\u00a0M €');
  assert.equal(projectionAxisLabel(1500000), '1,5\u00a0M €');
  assert.equal(projectionAxisLabel(1250000), '1,25\u00a0M €');
});
test('la simulation démarre au capital initial et conserve des paliers ronds', () => {
  const axis = projectionAxis([245810, 350000, 590000], true);
  assert.equal(axis.domain[0], 245810);
  assert.equal(axis.ticks[0], 245810);
  assert.ok(axis.domain[1] >= 590000);
  assert.ok(axis.ticks.slice(1).every(tick => tick % 10000 === 0));
});
test('une baisse reste visible et un capital constant conserve un axe non nul', () => {
  assert.equal(projectionAxis([245810, 200000, 180000], true).domain[0], 180000);
  const flat = projectionAxis([245810, 245810], true);
  assert.equal(flat.domain[0], 245810);
  assert.ok(flat.domain[1] > flat.domain[0]);
  assert.deepEqual(projectionAxis([], true).domain, [0, 1000]);
});
