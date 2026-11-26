import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portfolioSaveValues, readingsFingerprint } from '../src/lib/portfolio-save';
import { demo } from './fixtures/portfolio';
import type { Scenario } from '../src/lib/projection';

const now = '2026-11-14T12:00:00.000Z';
const simulations: Scenario[] = [{
  id: 's', name: 'Portefeuille', capital: 10000, monthly: 100, redirect: 0,
  lines: [{ id: 'line', name: 'Actions', allocation: 100, investmentWeight: 100, growth: 7, income: 0, reinvest: true }],
}];

test('enregistrer les simulations préserve relevés, objectifs, profil et date des montants', () => {
  const previous = { ...structuredClone(demo), birthDate: '1990-05-10', updatedAt: '2026-11-13T12:00:00.000Z' };
  const next = { ...structuredClone(previous), simulations, simulationHorizon: 30 };
  const values = portfolioSaveValues(next, previous, now);
  assert.deepEqual(values.data.simulations, simulations);
  assert.equal(values.data.simulationHorizon, 30);
  assert.equal(Object.hasOwn(values, 'updated_at'), false);
  assert.deepEqual(values.data.readings, previous.readings);
  assert.deepEqual(values.data.goals, previous.goals);
  assert.deepEqual(values.data.scpi, previous.scpi);
  assert.deepEqual(values.data.monthlySnapshots, previous.monthlySnapshots);
  assert.equal(values.data.birthDate, previous.birthDate);
  assert.deepEqual(portfolioSaveValues({ ...next, goals: { ...next.goals, annual: 12000 } }, next, now).data.simulations, simulations);
});
test('les scénarios invalides et horizons impossibles sont refusés avant toute sauvegarde', () => {
  assert.throws(() => portfolioSaveValues({ ...structuredClone(demo), simulations: [] }), /scénarios valides/);
  const invalid = structuredClone(simulations); invalid[0].lines[0].allocation = 90;
  assert.throws(() => portfolioSaveValues({ ...structuredClone(demo), simulations: invalid }), /scénarios valides/);
  assert.throws(() => portfolioSaveValues({ ...structuredClone(demo), simulations, simulationHorizon: 31 }), /horizon/);
});

test('modifier uniquement les objectifs conserve la date en base', () => {
  const previous = { ...structuredClone(demo), updatedAt: '2026-11-13T12:00:00.000Z' };
  const next = { ...structuredClone(previous), goals: { ...previous.goals, annual: 12000 } };
  const values = portfolioSaveValues(next, previous, now);
  assert.equal(Object.hasOwn(values, 'updated_at'), false);
  assert.equal(Object.hasOwn(values.data, 'updatedAt'), false);
  assert.equal(values.data.goals.annual, 12000);
  assert.equal(values.data.goals.monthly, 1000);
  assert.deepEqual(values.data.readings, previous.readings);
});
test('la date de naissance est conservée sans changer la date des montants', () => {
  const previous = { ...structuredClone(demo), updatedAt: '2026-11-13T12:00:00.000Z' };
  const next = { ...structuredClone(previous), birthDate: '1990-05-10' };
  const values = portfolioSaveValues(next, previous, now);
  assert.equal(values.data.birthDate, '1990-05-10');
  assert.equal(Object.hasOwn(values, 'updated_at'), false);
  assert.deepEqual(values.data.readings, previous.readings);
  assert.equal(portfolioSaveValues({ ...next, goals: { ...next.goals, annual: 12000 } }, next, now).data.birthDate, next.birthDate);
  assert.throws(() => portfolioSaveValues({ ...next, birthDate: '1990-02-30' }), /date de naissance/);
  assert.throws(() => portfolioSaveValues({ ...next, birthDate: '2990-05-10' }), /date de naissance/);
});

test('modifier un relevé met à jour la date', () => {
  const next = structuredClone(demo);
  next.readings[0].projected = !next.readings[0].projected;
  assert.equal(portfolioSaveValues(next, demo, now).updated_at, now);
});

test('la première sauvegarde initialise la date et une sauvegarde inchangée la conserve', () => {
  assert.equal(portfolioSaveValues(demo, undefined, now).updated_at, now);
  assert.equal(Object.hasOwn(portfolioSaveValues(structuredClone(demo), demo, now), 'updated_at'), false);
});

test('empreinte du brouillon : indépendante de l’ordre des clés JSONB, sensible aux montants et taux', () => {
  const original = structuredClone(demo.readings);
  const reordered = JSON.parse(JSON.stringify(original, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).reverse()) : value));
  assert.equal(readingsFingerprint(original), readingsFingerprint(reordered));
  reordered[0].total += 1;
  assert.notEqual(readingsFingerprint(original), readingsFingerprint(reordered));
  const detailed = structuredClone(demo.readings);
  const position = detailed.find(r => r.positions.length)!.positions[0];
  position.rate += 1;
  assert.notEqual(readingsFingerprint(original), readingsFingerprint(detailed));
  assert.deepEqual(demo.readings, original);
});
