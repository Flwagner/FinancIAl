import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOnDate, calendarDateLabel, isCalendarDate, localCalendarDate, projectionAge, projectionDate } from '../src/lib/simulation-age';

test('âge exact avant, le jour et après l’anniversaire', () => {
  assert.equal(ageOnDate('1990-05-10', '2026-05-09'), 35);
  assert.equal(ageOnDate('1990-05-10', '2026-05-10'), 36);
  assert.equal(ageOnDate('1990-05-10', '2026-05-11'), 36);
  assert.equal(ageOnDate('1990-05-10', '1990-05-10'), 0);
});
test('projection annuelle ancrée à la date du départ, pas au 1er janvier', () => {
  assert.equal(projectionDate('2026-04-01', 15), '2041-04-01');
  assert.equal(projectionAge('1990-05-10', '2026-04-01', 15), 50);
  assert.equal(projectionAge('1990-05-10', '2026-06-01', 15), 51);
});
test('dates impossibles, absentes et futures : aucun faux âge', () => {
  assert.equal(ageOnDate(undefined, '2026-05-10'), null);
  assert.equal(ageOnDate('2027-05-10', '2026-05-10'), null);
  for (const value of ['2026-02-29', '1990-13-10', '1990-05-32', '10/05/1990', 'invalid', '1990-05-10T00:00:00Z']) {
    assert.equal(isCalendarDate(value), false);
    assert.equal(ageOnDate(value, '2026-05-10'), null);
  }
  assert.equal(projectionDate('invalid', 1), null);
  assert.equal(projectionDate('2026-05-10', -1), null);
  assert.equal(projectionDate('2026-05-10', 1.5), null);
  assert.equal(projectionDate('9999-05-10', 1), null);
});
test('années bissextiles et libellés français sans décalage horaire', () => {
  assert.equal(projectionDate('2024-02-29', 1), '2025-02-28');
  assert.equal(projectionDate('2024-02-29', 4), '2028-02-29');
  assert.equal(ageOnDate('2000-02-29', '2025-02-28'), 24);
  assert.equal(ageOnDate('2000-02-29', '2025-03-01'), 25);
  assert.equal(calendarDateLabel('1990-05-10'), '10 mai 1990');
  assert.equal(calendarDateLabel('invalid'), '');
  assert.equal(localCalendarDate(new Date(2026, 0, 2, 12)), '2026-01-02');
});
