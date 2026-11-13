import { marketInstruments } from '../src/lib/market';
import { fetchYahooReturn } from './lib/yahoo';
import { finishPushSync, pushRpc, type PushContext } from './lib/push';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const token = process.env.MARKET_SYNC_TOKEN;
  if (!dryRun && (!url || !key || !token)) throw new Error('Configurer SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY et MARKET_SYNC_TOKEN.');
  if (url && new URL(url).protocol !== 'https:') throw new Error('SUPABASE_URL doit utiliser HTTPS.');
  const rpc = !dryRun && process.env.PUSH_SYNC_TOKEN ? pushRpc(url!, key!, process.env.PUSH_SYNC_TOKEN) : null;
  let before: PushContext | null = null;
  let pushFailed = false;
  if (rpc) {
    try { before = await rpc<PushContext>('context'); }
    catch { pushFailed = true; console.error('Comparatif indisponible : vérifier la migration notifications et PUSH_SYNC_TOKEN. La synchronisation continue.'); }
  }
  async function publish(payload: object) {
    const response = await fetch(`${url}/rest/v1/rpc/sync_market_instrument`, {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { apikey: key!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync_token: token, payload }),
    });
    // Ne pas afficher le corps de la requête ou les secrets dans les logs.
    if (!response.ok) throw new Error(`Écriture Supabase refusée (HTTP ${response.status}). Vérifier la migration et le jeton de synchronisation.`);
  }
  let failures = 0;
  for (const instrument of marketInstruments) {
    if ('referenceSymbol' in instrument) {
      console.log(`${instrument.symbol} · approximation via ${instrument.referenceSymbol} · ${instrument.referenceNote}`);
      continue;
    }
    try {
      const result = await fetchYahooReturn(instrument.symbol, instrument.currency);
      if (!dryRun) await publish({ symbol: instrument.symbol, ...result });
      console.log(`${instrument.symbol} · ${result.performance.start_date} → ${result.performance.as_of} · ${result.performance.rate.toFixed(2)} % · ${instrument.currency}${dryRun ? ' · simulation sans écriture' : ''}`);
    } catch (error) {
      failures++;
      const message = error instanceof Error ? error.message : 'Erreur de synchronisation.';
      console.error(`${instrument.symbol} : ${message}`);
      if (!dryRun) {
        try { await publish({ symbol: instrument.symbol, error: message }); }
        catch { console.error(`${instrument.symbol} : impossible de consigner l’échec dans Supabase.`); }
      }
    }
  }
  if (rpc && before) {
    try { await finishPushSync(rpc, before, failures > 0); }
    catch { pushFailed = true; console.error('Échec du comparatif ou des notifications. Les cours synchronisés sont conservés ; vérifier la configuration Push.'); }
  }
  if (failures) throw new Error(`${failures} instrument(s) en échec. Les dernières valeurs valides sont conservées.`);
  if (pushFailed) throw new Error('Cours synchronisés, mais comparatif/notifications en échec.');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Échec de la synchronisation.'); process.exitCode = 1; });
