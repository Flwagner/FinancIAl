import type { PushContext, PushRpc } from '../../../scripts/lib/push.ts';
import { isYahooRateLimit } from '../../../src/lib/manual-market-sync.ts';

type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
type Dependencies = {
  rpc: Rpc;
  configured: boolean;
  instruments: readonly { symbol: string; currency: string }[];
  fetchReturn: (symbol: string, currency: string, signal: AbortSignal) => Promise<object>;
  finishPush: (rpc: PushRpc, before: PushContext, partial: boolean, runId: string) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
  now?: () => number;
};

export async function handleDailyMarketSync(request: Request, deps: Dependencies): Promise<Response> {
  const reply = (status: number, body: object) => Response.json(body, { status });
  if (request.method !== 'POST') return reply(405, { error: 'Méthode non autorisée.' });
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) return reply(401, { error: 'Accès refusé.' });
  const runId = crypto.randomUUID();
  let acquired = false;
  let succeeded = 0;
  let failed = 0;
  let pushFailed = false;
  const rpc = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T> => {
    const result = await deps.rpc(name, args);
    if (result.error) throw new Error('RPC refusée');
    return result.data as T;
  };
  try {
    // No market writes or comparisons without the existing VAPID key.
    // Authentication is nevertheless checked first.
    const state = await rpc<string>('start_daily_market_sync', { sync_token: token, run_id: runId });
    if (state === 'unauthorized') return reply(401, { error: 'Accès refusé.' });
    if (state === 'busy') return reply(409, { status: 'busy' });
    if (state === 'completed') return reply(200, { status: 'already_completed' });
    if (state !== 'started') throw new Error('État inattendu');
    acquired = true;
    if (!deps.configured || !deps.instruments.length) throw new Error('Configuration manquante');
    const pushRpc: PushRpc = (operation, payload = {}) => rpc('daily_market_push', { operation, payload });
    const before = await pushRpc<PushContext>('context');
    const now = deps.now ?? Date.now;
    const started = now();
    const deadline = AbortSignal.timeout(65_000);
    const wait = deps.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    let blocked = false;
    for (const [index, instrument] of deps.instruments.entries()) {
      let reason: string | null = null;
      if (blocked) reason = 'rate_limited';
      else if (deadline.aborted || now() - started >= 60_000) reason = 'time_budget_exceeded';
      else {
        if (index) await wait(400);
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const result = await deps.fetchReturn(instrument.symbol, instrument.currency, deadline);
            await rpc('publish_manual_market_instrument', { payload: { symbol: instrument.symbol, ...result } });
            reason = null;
            break;
          } catch (error) {
            reason = isYahooRateLimit(error) ? 'rate_limited' : 'synchronization_failed';
            if (reason !== 'rate_limited' || attempt || deadline.aborted) break;
            await wait(1_200);
          }
        }
      }
      if (reason) {
        failed++;
        if (reason === 'rate_limited') blocked = true;
        // Unlike the manual button, daily failures persist in market status.
        await rpc('publish_manual_market_instrument', { payload: { symbol: instrument.symbol, error: reason } });
      } else succeeded++;
    }
    try { await deps.finishPush(pushRpc, before, failed > 0, runId); }
    catch { pushFailed = true; }
    await rpc('finish_daily_market_sync', { run_id: runId, successes: succeeded, failures: failed, push_error: pushFailed });
    acquired = false;
    const status = !succeeded ? 'failed' : failed || pushFailed ? 'partial' : 'succeeded';
    console.log(JSON.stringify({ event: 'daily_market_sync', run_id: runId, status, succeeded, failed, push_failed: pushFailed }));
    return reply(status === 'succeeded' ? 200 : 503, { status, succeeded, failed, push_failed: pushFailed });
  } catch {
    if (acquired) {
      try {
        await rpc('finish_daily_market_sync', {
          run_id: runId, successes: succeeded, failures: Math.max(failed, deps.instruments.length - succeeded), push_error: true,
        });
      } catch { /* An expired running lease can be recovered by the next run. */ }
    }
    console.error(JSON.stringify({ event: 'daily_market_sync_failed', run_id: runId }));
    return reply(503, { error: 'Synchronisation quotidienne indisponible.' });
  }
}
