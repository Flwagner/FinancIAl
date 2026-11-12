import { marketInstruments } from '../src/lib/market';
import { fetchYahooReturn } from './lib/yahoo';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const token = process.env.MARKET_SYNC_TOKEN;
  if (!dryRun && (!url || !key || !token)) throw new Error('Configurer SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY et MARKET_SYNC_TOKEN.');
  if (url && new URL(url).protocol !== 'https:') throw new Error('SUPABASE_URL doit utiliser HTTPS.');
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
  if (failures) throw new Error(`${failures} instrument(s) en échec. Les dernières valeurs valides sont conservées.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Échec de la synchronisation.'); process.exitCode = 1; });
