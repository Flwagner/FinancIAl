import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('workflow : cron UTC couvrant 8 h à 20 h à :07, heure de Paris, été et hiver', () => {
  const workflow = readFileSync(new URL('../.github/workflows/sync-market.yml', import.meta.url), 'utf8');
  assert.ok(!workflow.includes('timezone:'));
  const schedules = [...workflow.matchAll(/cron: '([^']+)'/g)];
  assert.equal(schedules.length, 1);
  const [minute, hour, ...days] = schedules[0][1].split(' ');
  assert.equal(minute, '7');
  assert.deepEqual(days, ['*', '*', '*']);
  const [start, end] = hour.split('-').map(Number);
  // UTC+1 (hiver) et UTC+2 (été) : chaque heure locale de 8 à 20 doit être couverte.
  for (const offset of [1, 2]) {
    for (let local = 8; local <= 20; local++) {
      assert.ok(local - offset >= start && local - offset <= end, `${local} h Paris (UTC+${offset})`);
    }
  }
  // Le Push et la fenêtre horaire reposent sur l'heure planifiée, pas sur l'heure de démarrage.
  assert.ok(workflow.includes('github.event.schedule'));
  assert.ok(workflow.includes('PUSH_NOTIFICATIONS_ENABLED: ${{ steps.paris.outputs.push }}'));
});
