import { createClient } from 'npm:@supabase/supabase-js@2.80.0';
import { handleMarketSync, type MarketSyncClient } from './handler.ts';
import { fetchYahooReturn } from '../../../scripts/lib/yahoo.ts';
import { marketInstruments } from '../../../src/lib/market.ts';

Deno.serve((request: Request) => handleMarketSync(request, {
  url: Deno.env.get('SUPABASE_URL')!,
  key: Deno.env.get('SUPABASE_ANON_KEY')!,
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  createClient: (url, key, options) => createClient(url, key, options) as unknown as MarketSyncClient,
  instruments: marketInstruments.filter(instrument => !('referenceSymbol' in instrument)),
  fetchReturn: fetchYahooReturn,
}));
