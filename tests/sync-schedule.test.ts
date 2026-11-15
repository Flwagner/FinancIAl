import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('workflow : synchronisation horaire à :30 entre 9h30 et 18h30, heure de Paris', () => {
  const workflow = readFileSync(new URL('../.github/workflows/sync-market.yml', import.meta.url), 'utf8');
  assert.ok(!workflow.includes('timezone:'));
  // Plus de calcul d'heure locale : le cron UTC est la seule source de vérité.
  assert.ok(!workflow.includes('github.event.schedule'));
  assert.ok(!workflow.includes('steps.paris'));
  const schedules = [...workflow.matchAll(/cron: '([^']+)'/g)];
  assert.equal(schedules.length, 1);
  const [minute, hour, ...days] = schedules[0][1].split(' ');
  assert.equal(minute, '30');
  assert.deepEqual(days, ['*', '*', '*']);
  const [start, end] = hour.split('-').map(Number);
  // Paris = UTC+1 (hiver) ou UTC+2 (été) : 9h30–18h30 doit être couvert dans les deux cas.
  for (const offset of [1, 2]) {
    for (let local = 9; local <= 18; local++) {
      const utc = local - offset;
      assert.ok(utc >= start && utc <= end, `${local}h30 Paris (UTC+${offset})`);
    }
  }
  // La notification est limitée côté service worker, pas par un créneau GitHub.
  assert.ok(workflow.includes("PUSH_NOTIFICATIONS_ENABLED: 'true'"));
});
