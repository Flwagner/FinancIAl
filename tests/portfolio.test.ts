import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, currentReadings, currentSnapshot, defaultGoals, monthlyReadings, normalizeGoals, summarize, validatePortfolio } from '../src/lib/portfolio';
import { demo } from './fixtures/portfolio';
test('progression : comparaison au dernier point mensuel réel validé de la courbe', () => {
  const readings = [
    { id: 'oct', date: '2026-10-01', projected: false, total: 240000, positions: [] },
    { id: 'daily', date: '2026-10-25', projected: false, total: 245000, positions: [] },
    { id: 'nov', date: '2026-11-01', projected: false, total: 247598, positions: [] },
    { id: 'dec', date: '2026-12-01', projected: true, total: 250000, positions: [] },
  ];
  const baseline = currentReadings(monthlyReadings(readings)).actual!;
  assert.equal(baseline.id, 'nov');
  assert.equal(248614 - baseline.total, 1016);
  assert.equal(246598 - baseline.total, -1000);
  assert.equal(currentReadings(monthlyReadings([readings[3]])).actual, undefined);
  assert.equal(currentReadings(monthlyReadings([])).actual, undefined);
  assert.equal(currentReadings(monthlyReadings([...readings].reverse())).actual?.id, 'nov');
});
test('la cible mensuelle est toujours calculée depuis la cible annuelle', () => {
  const original = { capital: 250000, annual: 48000, monthly: 3000 };
  assert.equal(normalizeGoals(original).monthly, 4000);
  assert.equal(original.monthly, 3000);
  assert.equal(normalizeGoals({ ...original, annual: 12000 }).monthly, 1000);
  assert.equal(normalizeGoals({ ...original, annual: 100 }).monthly, 100 / 12);
  assert.equal(defaultGoals.monthly, defaultGoals.annual / 12);
});
test('gains pondérés, négatifs et division mensuelle', () => {
  const positions = demo.readings.find(r => r.positions.length)!.positions;
  const stats = summarize(positions);
  assert.equal(stats.monthly, stats.annual / 12);
  assert.equal(summarize([]).rate, 0);
  assert.equal(summarize([{ ...positions[0], amount: 1000, rate: -5 }]).annual, -50);
  assert.equal(summarize([{ ...positions[0], amount: 1000, rate: -5 }], { SCPI: 10 }).annual, 100);
  assert.equal(aggregate(positions, 'category').reduce((s, p) => s + p.value, 0), stats.total);
});
test('la projection ne remplace pas le dernier relevé réel', () => {
  const state = currentReadings(demo.readings);
  assert.equal(state.actual?.date, '2026-11-01');
  assert.equal(state.projection?.date, '2026-12-01');
  assert.equal(state.change, 1200);
});
test('le dashboard affiche le dernier détail disponible, même associé à un point projeté', () => {
  const positions = [{ ...demo.readings.find(r => r.positions.length)!.positions[0], amount: 1234 }];
  const detail = { id: 'detail', date: '2026-12-01', projected: true, total: 1234, positions };
  const data = { ...demo, readings: [detail] };
  validatePortfolio(data);
  assert.equal(currentSnapshot(data), detail);
  assert.equal(currentSnapshot(data)?.total, 1234);
  assert.equal(currentSnapshot({ ...demo, readings: [] }), undefined);
});
test('le détail peut être ancien ou mis à jour entre deux points mensuels', () => {
  const old = demo.readings.find(r => r.positions.length)!;
  const updated = { ...structuredClone(old), id: 'updated', date: '2026-11-12', total: old.total + 50 };
  updated.positions[0].amount += 50;
  const monthlyTotal = { id: 'monthly', date: '2026-12-01', projected: true, total: 999999, positions: [] };
  assert.equal(currentSnapshot({ ...demo, readings: [old] }), old);
  const data = { ...demo, readings: [monthlyTotal, updated, old] };
  validatePortfolio(data);
  assert.equal(currentSnapshot(data), updated);
  assert.equal(currentSnapshot(data)?.total, updated.total);
  assert.equal(monthlyReadings(data.readings).some(r => r.id === updated.id), false);
});
test('la courbe ne conserve que les points de début de mois, sans les montants courants', () => {
  const daily = { id: 'daily', date: '2026-11-12', projected: false, total: 1234, positions: [] };
  const readings = [...demo.readings, daily];
  const history = monthlyReadings(readings);
  assert.deepEqual(history, demo.readings);
  assert.equal(readings.length, demo.readings.length + 1);
});
test('validation des doublons, dates, objectifs et montants', () => {
  validatePortfolio(demo);
  assert.throws(() => validatePortfolio({ ...demo, readings: [...demo.readings, demo.readings[0]] }), /date/);
  assert.throws(() => validatePortfolio({ ...demo, readings: [{ ...demo.readings[0], date: '2026-02-30' }] }), /Date/);
  assert.throws(() => validatePortfolio({ ...demo, goals: { ...demo.goals, annual: 0 } }), /objectifs/);
  assert.throws(() => validatePortfolio({ ...demo, readings: [{ ...demo.readings[0], total: NaN }] }), /Total/);
});
test('historique sans projection : variation des deux derniers relevés réels', () => {
  const state = currentReadings(demo.readings.filter(r => !r.projected));
  assert.equal(state.projection, undefined);
  assert.equal(state.change, state.actual!.total - state.previous!.total);
  assert.equal(currentReadings([]).change, null);
});
test('objectifs configurables avant le premier relevé', () => {
  validatePortfolio({ readings: [], goals: demo.goals });
});
