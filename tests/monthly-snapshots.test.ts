import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentSnapshot, evolutionReadings, freezeCurrentMonth, monthlyReadings, saveCurrentReading, validatePortfolio, type Portfolio, type Reading } from '../src/lib/portfolio';
import { portfolioSaveValues } from '../src/lib/portfolio-save';

const reading: Reading = { id: 'current', date: '2026-11-05', total: 248504, projected: false, positions: [
  { id: 'a', name: 'Livret A', category: 'Livret A', envelope: 'Direct', code: '', amount: 248504, rate: 1.5 },
] };
const portfolio: Portfolio = { goals: { capital: 250000, annual: 36000, monthly: 3000 }, readings: [
  { id: 'oct', date: '2026-10-01', total: 249000, projected: false, positions: [] },
  { id: 'nov', date: '2026-11-01', total: 247598, projected: false, positions: [] },
  reading,
  { id: 'dec', date: '2026-12-01', total: 250000, projected: true, positions: [] },
] };
const timestamp = '2026-11-05T09:15:00.000Z';

test('figer le 5 capture novembre et conserve la date réelle sans modifier les placements', () => {
  const original = structuredClone(portfolio);
  const next = freezeCurrentMonth(portfolio, reading.total, '2026-11-05', timestamp);
  assert.deepEqual(next.monthlySnapshots, [{ month: '2026-11', total: 248504, capturedAt: timestamp }]);
  assert.deepEqual(next.readings, portfolio.readings);
  assert.deepEqual(portfolio, original);
  assert.equal(currentSnapshot(next), reading);
  const history = evolutionReadings(next.readings, 249000, next.monthlySnapshots);
  assert.deepEqual(history.map(r => [r.date, r.total, r.projected]), [
    ['2026-10-01', 249000, false], ['2026-11-01', 248504, false], ['2026-12-01', 249000, true],
  ]);
});

test('un remplacement ne crée pas de doublon et conserve les autres mois', () => {
  const october = freezeCurrentMonth(portfolio, 249000, '2026-10-05', '2026-10-05T09:15:00Z');
  const november = freezeCurrentMonth(october, 248504, '2026-11-05', timestamp);
  const next = freezeCurrentMonth(november, 248600, '2026-11-06', '2026-11-06T09:15:00Z');
  assert.equal(next.monthlySnapshots?.length, 2);
  assert.equal(next.monthlySnapshots?.find(s => s.month === '2026-11')?.total, 248600);
  assert.equal(next.monthlySnapshots?.find(s => s.month === '2026-10')?.total, 249000);
  assert.equal(monthlyReadings(next.readings, next.monthlySnapshots).filter(r => r.date === '2026-11-01').length, 1);
});

test('enregistrer ensuite le portefeuille laisse le total figé intact', () => {
  const frozen = freezeCurrentMonth(portfolio, reading.total, reading.date, timestamp);
  const draft = { ...reading, total: 249500, positions: [{ ...reading.positions[0], amount: 249500 }] };
  const saved = saveCurrentReading(frozen, draft, '2026-11-06', 'new');
  validatePortfolio(saved);
  assert.equal(currentSnapshot(saved)?.total, 249500);
  assert.equal(monthlyReadings(saved.readings, saved.monthlySnapshots).find(r => r.date === '2026-11-01')?.total, 248504);
});

test('enregistrer le 1er préserve un ancien point réel mais ne fige pas un nouveau mois', () => {
  const saved = saveCurrentReading(portfolio, reading, '2026-11-01', 'new');
  validatePortfolio(saved);
  assert.equal(monthlyReadings(saved.readings, saved.monthlySnapshots).find(r => r.date === '2026-11-01')?.total, 247598);
  assert.equal(saved.monthlySnapshots?.[0].capturedAt, '2026-11-01');
  const repeated = saveCurrentReading(saved, reading, '2026-11-01', 'new-again');
  assert.deepEqual(repeated.monthlySnapshots, saved.monthlySnapshots);
  const december = saveCurrentReading(saved, reading, '2026-12-01', 'new-dec');
  assert.equal(monthlyReadings(december.readings, december.monthlySnapshots).some(r => r.date === '2026-12-01'), false);
});

test('figer un mois ne touche ni au détail courant ni à une projection détaillée', () => {
  const projected = { ...reading, id: 'projected', date: '2026-12-01', projected: true };
  const next = freezeCurrentMonth({ ...portfolio, readings: [reading, projected] }, 248504, reading.date, timestamp);
  assert.equal(currentSnapshot(next), reading);
  assert.equal(next.readings[1], projected);
});

test('la sauvegarde conserve les captures et actualise la date de modification', () => {
  const next = freezeCurrentMonth(portfolio, reading.total, reading.date, timestamp);
  const values = portfolioSaveValues(next, portfolio, timestamp);
  assert.deepEqual(values.data.monthlySnapshots, next.monthlySnapshots);
  assert.equal(values.updated_at, timestamp);
  assert.equal(Object.hasOwn(portfolioSaveValues(next, next, timestamp), 'updated_at'), false);
});

test('validation des mois, doublons, montants et dates de capture', () => {
  const next = freezeCurrentMonth(portfolio, 0, reading.date, timestamp);
  validatePortfolio(next);
  const snapshot = next.monthlySnapshots![0];
  for (const change of [{ month: '2026-13' }, { total: NaN }, { total: -1 }, { capturedAt: 'invalide' }]) {
    assert.throws(() => validatePortfolio({ ...next, monthlySnapshots: [{ ...snapshot, ...change }] }));
  }
  assert.throws(() => validatePortfolio({ ...next, monthlySnapshots: [snapshot, snapshot] }), /mois/);
  assert.throws(() => freezeCurrentMonth(portfolio, -1, reading.date, timestamp), /Total/);
});
