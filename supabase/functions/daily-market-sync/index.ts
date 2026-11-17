import { createClient } from 'npm:@supabase/supabase-js@2.80.0';
import { handleDailyMarketSync } from './handler.ts';
import { fetchYahooReturn } from '../../../scripts/lib/yahoo.ts';
import { finishPushSync } from '../../../scripts/lib/push.ts';
import { marketInstruments } from '../../../src/lib/market.ts';

Deno.serve((request: Request) => {
  const env = {
    VAPID_PUBLIC_KEY: Deno.env.get('VAPID_PUBLIC_KEY'),
    VAPID_PRIVATE_KEY: Deno.env.get('VAPID_PRIVATE_KEY'),
    VAPID_SUBJECT: Deno.env.get('VAPID_SUBJECT'),
    PUSH_NOTIFICATIONS_ENABLED: 'true',
  };
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) },
  });
  return handleDailyMarketSync(request, {
    rpc: (name, args) => client.rpc(name, args),
    configured: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT),
    instruments: marketInstruments.filter(instrument => !('referenceSymbol' in instrument)),
    fetchReturn: (symbol, currency, deadline) => fetchYahooReturn(symbol, currency, new Date(), (input, init) =>
      fetch(input, { ...init, signal: AbortSignal.any([deadline, init?.signal ?? AbortSignal.timeout(10_000)]) })),
    finishPush: (rpc, before, partial, runId) => finishPushSync(rpc, before, partial, { env: { ...env, MARKET_SYNC_RUN_ID: runId } }),
  });
});
