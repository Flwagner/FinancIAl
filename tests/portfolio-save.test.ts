import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portfolioSaveValues } from '../src/lib/portfolio-save';
import { demo } from './fixtures/portfolio';

const now = '2026-11-14T12:00:00.000Z';

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

test('modifier un relevé met à jour la date', () => {
  const next = structuredClone(demo);
  next.readings[0].projected = !next.readings[0].projected;
  assert.equal(portfolioSaveValues(next, demo, now).updated_at, now);
});

test('la première sauvegarde initialise la date et une sauvegarde inchangée la conserve', () => {
  assert.equal(portfolioSaveValues(demo, undefined, now).updated_at, now);
  assert.equal(Object.hasOwn(portfolioSaveValues(structuredClone(demo), demo, now), 'updated_at'), false);
});
