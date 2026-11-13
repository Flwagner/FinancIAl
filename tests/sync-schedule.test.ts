import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('workflow : 13 synchronisations, de 8 h à 20 h incluses, heure de Paris', () => {
  const workflow = readFileSync(new URL('../.github/workflows/sync-market.yml', import.meta.url), 'utf8');
  const schedules = [...workflow.matchAll(/cron: '([^']+)'\s+timezone: '([^']+)'/g)];
  assert.equal(schedules.length, 2);
  const hours: number[] = [];
  for (const [, cron, timezone] of schedules) {
    assert.equal(timezone, 'Europe/Paris');
    const [minute, hour, ...days] = cron.split(' ');
    assert.equal(minute, '0');
    assert.deepEqual(days, ['*', '*', '*']);
    for (const range of hour.split(',')) {
      const [start, end = start] = range.split('-').map(Number);
      for (let h = start; h <= end; h++) hours.push(h);
    }
  }
  assert.deepEqual(hours.sort((a, b) => a - b), Array.from({ length: 13 }, (_, i) => i + 8));
  // Eligibility follows the scheduled event, so a delayed 09:00 job cannot notify at 10:00.
  assert.ok(workflow.includes("PUSH_NOTIFICATIONS_ENABLED: ${{ github.event_name == 'schedule' && github.event.schedule == '0 10 * * *' }}"));
});
