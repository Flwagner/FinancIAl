import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDailyMarketSync } from '../supabase/functions/daily-market-sync/handler';
import { YahooRateLimitError } from '../src/lib/manual-market-sync';

const token = 'a'.repeat(64);
const request = () => new Request('https://example.test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
function setup(options: { state?: string; configured?: boolean; rateLimited?: boolean; pushError?: boolean } = {}) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  let fetched = 0;
  let pushed = 0;
  let partial = false;
  const deps = {
    configured: options.configured ?? true,
    instruments: [{ symbol: 'A', currency: 'EUR' }, { symbol: 'B', currency: 'EUR' }],
    rpc: async (name: string, args?: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: name === 'start_daily_market_sync' ? options.state ?? 'started' : {}, error: null };
    },
    fetchReturn: async () => {
      fetched++;
      if (options.rateLimited) throw new YahooRateLimitError();
      return { prices: [] };
    },
    finishPush: async (_rpc: unknown, _before: unknown, isPartial: boolean) => {
      pushed++;
      partial = isPartial;
      if (options.pushError) throw new Error('private error not logged');
    },
    wait: async () => {},
  };
  return { deps, calls, stats: () => ({ fetched, pushed, partial }) };
}

test('daily sync rejects missing token or wrong method before accessing the database', async () => {
  const { deps, calls } = setup();
  assert.equal((await handleDailyMarketSync(new Request('https://example.test'), deps)).status, 405);
  assert.equal((await handleDailyMarketSync(new Request('https://example.test', { method: 'POST' }), deps)).status, 401);
  assert.equal(calls.length, 0);
});

for (const [state, expected] of [['unauthorized', 401], ['busy', 409], ['completed', 200]] as const) {
  test(`daily sync stops on lease state ${state}`, async () => {
    const { deps, calls, stats } = setup({ state });
    assert.equal((await handleDailyMarketSync(request(), deps)).status, expected);
    assert.equal(calls.length, 1);
    assert.equal(stats().fetched, 0);
  });
}

test('daily sync publishes all instruments, compares and records success', async () => {
  const { deps, calls, stats } = setup();
  assert.equal((await handleDailyMarketSync(request(), deps)).status, 200);
  assert.deepEqual(stats(), { fetched: 2, pushed: 1, partial: false });
  const finish = calls.at(-1)!;
  assert.equal(finish.name, 'finish_daily_market_sync');
  assert.equal(finish.args?.successes, 2);
  assert.equal(finish.args?.failures, 0);
});

test('missing VAPID configuration leaves market and comparisons untouched', async () => {
  const { deps, calls, stats } = setup({ configured: false });
  assert.equal((await handleDailyMarketSync(request(), deps)).status, 503);
  assert.equal(stats().fetched, 0);
  assert.equal(stats().pushed, 0);
  assert.deepEqual(calls.map(c => c.name), ['start_daily_market_sync', 'finish_daily_market_sync']);
});

test('persistent Yahoo refusal retries once, stops fetching and records controlled failures', async () => {
  const { deps, calls, stats } = setup({ rateLimited: true });
  const response = await handleDailyMarketSync(request(), deps);
  assert.equal(response.status, 503);
  assert.deepEqual(stats(), { fetched: 2, pushed: 1, partial: true });
  assert.equal(calls.filter(c => c.name === 'publish_manual_market_instrument' &&
    (c.args?.payload as { error: string }).error === 'rate_limited').length, 2);
});

test('Push failure preserves successful market publications and fails the run visibly', async () => {
  const { deps, calls } = setup({ pushError: true });
  assert.equal((await handleDailyMarketSync(request(), deps)).status, 503);
  assert.equal(calls.at(-1)?.args?.successes, 2);
  assert.equal(calls.at(-1)?.args?.push_error, true);
});

test('market time budget skips remaining fetches but persists failures', async () => {
  const { deps, calls, stats } = setup();
  let tick = 0;
  const response = await handleDailyMarketSync(request(), { ...deps, now: () => tick++ === 0 ? 0 : 61_000 });
  assert.equal(response.status, 503);
  assert.equal(stats().fetched, 0);
  assert.equal(calls.at(-1)?.args?.failures, 2);
});
