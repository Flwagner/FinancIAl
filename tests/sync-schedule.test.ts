import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('Supabase Cron remplace le workflow et conserve 09:30 à Paris été/hiver', () => {
  assert.equal(existsSync(new URL('../.github/workflows/sync-market.yml', import.meta.url)), false);
  const sql = readFileSync(new URL('../supabase/migrations/20261117150121_scheduled_market_sync.sql', import.meta.url), 'utf8');
  assert.match(sql, /cron\.schedule\('daily-market-sync', '30 7,8 \* \* \*'/);
  assert.match(sql, /at time zone 'Europe\/Paris'\)::time >= time '09:30'/);
  assert.match(sql, /at time zone 'Europe\/Paris'\)::time < time '09:31'/);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  for (const day of ['2026-01-01', '2026-03-28', '2026-03-29', '2026-07-01', '2026-10-24', '2026-10-25']) {
    const triggers = [7, 8].filter(hour =>
      formatter.format(new Date(`${day}T0${hour}:30:00Z`)) === '09:30');
    assert.equal(triggers.length, 1, day);
  }
  const edge = readFileSync(new URL('../supabase/functions/daily-market-sync/index.ts', import.meta.url), 'utf8');
  assert.match(edge, /PUSH_NOTIFICATIONS_ENABLED: 'true'/);
});

test('deux passages à 09:30 et 14:00 Paris, sans doublon été/hiver', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261127101439_twice_daily_market_sync.sql', import.meta.url), 'utf8');
  assert.match(sql, /schedule := '0,30 7,8,12,13 \* \* \*'/);
  assert.match(sql, /time '09:30'/);
  assert.match(sql, /time '09:31'/);
  assert.match(sql, /time '14:00'/);
  assert.match(sql, /time '14:01'/);
  assert.match(sql, /status = 'succeeded' and started_at >= slot_start/);
  assert.match(sql, /pg_advisory_xact_lock\(74921035\)/);
  assert.doesNotMatch(sql, /active\s*:=/);
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  for (const day of ['2026-01-01', '2026-03-28', '2026-03-29', '2026-07-01', '2026-10-24', '2026-10-25']) {
    const triggers = [7, 8, 12, 13].flatMap(hour => [0, 30].map(minute =>
      formatter.format(new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`))))
      .filter(time => time === '09:30' || time === '14:00');
    assert.deepEqual(triggers.sort(), ['09:30', '14:00'], day);
  }
});
