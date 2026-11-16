import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('workflow : synchronisation quotidienne à 9h30, heure de Paris été/hiver', () => {
  const workflow = readFileSync(new URL('../.github/workflows/sync-market.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron: '30 9 \* \* \*'\s+timezone: Europe\/Paris/);
  // Le fuseau gère les changements d'heure, sans second déclenchement ni filtre.
  assert.ok(!workflow.includes('github.event.schedule'));
  assert.ok(!workflow.includes('steps.paris'));
  const schedules = [...workflow.matchAll(/cron: '([^']+)'/g)];
  assert.equal(schedules.length, 1);
  const [minute, hour, ...days] = schedules[0][1].split(' ');
  assert.equal(minute, '30');
  assert.deepEqual(days, ['*', '*', '*']);
  assert.equal(hour, '9');
  assert.ok(workflow.includes('workflow_dispatch:'));
  // La notification est limitée côté service worker, pas par un créneau GitHub.
  assert.ok(workflow.includes("PUSH_NOTIFICATIONS_ENABLED: 'true'"));
});
