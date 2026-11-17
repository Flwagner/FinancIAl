// Dépendances injectées : les tests n'accèdent jamais à la base de production.
import { isYahooRateLimit, type MarketSyncReason } from '../../../src/lib/manual-market-sync.ts';
export type MarketSyncClient = {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from(table: string): { select(columns: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> } } };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};
type Dependencies = {
  url: string;
  key: string;
  serviceKey: string;
  createClient: (url: string, key: string, options?: { global?: { headers?: { Authorization: string }; fetch?: typeof fetch }; auth: { persistSession: boolean; autoRefreshToken: boolean } }) => MarketSyncClient;
  instruments: readonly { symbol: string; currency: string }[];
  fetchReturn: (symbol: string, currency: string) => Promise<unknown>;
  // Remplaçable pour garder les tests instantanés.
  wait?: (ms: number) => Promise<void>;
};
// Séquentiel et espacé : un burst depuis l'IP d'egress partagée des Edge
// Functions se fait refuser par Yahoo là où le cron Node passe.
const intervalMs = 400;
const retryDelayMs = 1_200;
// Le client Supabase coupe la fonction à 75 s : garder de la marge pour la
// publication des derniers instruments.
const attemptBudgetMs = 55_000;
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
export async function handleMarketSync(request: Request, deps: Dependencies): Promise<Response> {
  const reply = (status: number, body: object) => Response.json(body, { status, headers: cors });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply(405, { error: 'Méthode non autorisée.' });
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401, { error: 'Connexion requise.' });
  try {
    if (!deps.url || !deps.key || !deps.serviceKey) throw new Error('Configuration manquante');
    const auth = { persistSession: false, autoRefreshToken: false };
    const deadline = AbortSignal.timeout(75_000);
    const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: deadline });
    const caller = deps.createClient(deps.url, deps.key, { global: { headers: { Authorization: authorization }, fetch: boundedFetch }, auth });
    const { data: { user }, error: authError } = await caller.auth.getUser();
    if (authError || !user) return reply(401, { error: 'Connexion requise.' });
    // La lecture RLS vérifie à la fois le propriétaire autorisé et son identité.
    const owner = await caller.from('portfolios').select('user_id').eq('user_id', user.id).maybeSingle();
    if (owner.error || !owner.data) return reply(403, { error: 'Accès refusé.' });
    const server = deps.createClient(deps.url, deps.serviceKey, { global: { fetch: boundedFetch }, auth });
    const lease = await server.rpc('try_start_manual_market_sync');
    if (lease.error) throw new Error('Verrou indisponible');
    if (lease.data !== true) return reply(429, { error: 'Patiente deux minutes avant de réessayer.' });

    async function synchronize(instrument: { symbol: string; currency: string }): Promise<MarketSyncReason | null> {
      let stage: 'source' | 'publication' = 'source';
      try {
        const result = await deps.fetchReturn(instrument.symbol, instrument.currency);
        stage = 'publication';
        const published = await server.rpc('publish_manual_market_instrument', { payload: { symbol: instrument.symbol, ...result as object } });
        if (published.error) throw new Error('Publication refusée');
        return null;
      } catch (error) {
        const reason = stage === 'publication' ? 'publication_failed'
          : isYahooRateLimit(error) ? 'rate_limited' : 'source_unavailable';
        // Uniquement des codes maîtrisés : ni jeton, ni réponse HTTP brute.
        console.warn(JSON.stringify({ event: 'manual_market_sync_failed', symbol: instrument.symbol, reason }));
        // Une erreur manuelle est transitoire : bilan de la réponse uniquement,
        // jamais de statut d'échec persistant dans les données de marché.
        return reason;
      }
    }
    if (!deps.instruments.length) throw new Error('Registre vide');
    const wait = deps.wait ?? pause;
    const startedAt = Date.now();
    const results: (MarketSyncReason | null)[] = [];
    let blocked = false;
    let exhausted = false;
    for (const [index, instrument] of deps.instruments.entries()) {
      // Après un refus persistant, insister ne ferait qu'aggraver le blocage :
      // le reste du lot est compté sans nouvelle requête.
      if (blocked) { results.push('rate_limited'); continue; }
      if (exhausted) { results.push('source_unavailable'); continue; }
      if (index > 0 && Date.now() - startedAt > attemptBudgetMs) { exhausted = true; results.push('source_unavailable'); continue; }
      if (index > 0) await wait(intervalMs);
      let reason = await synchronize(instrument);
      if (reason === 'rate_limited') {
        // Un seul réessai, réservé au débit : un refus persistant interrompt le lot.
        console.warn(JSON.stringify({ event: 'manual_market_sync_retry', symbol: instrument.symbol }));
        await wait(retryDelayMs);
        reason = await synchronize(instrument);
      }
      if (reason === 'rate_limited') blocked = true;
      results.push(reason);
    }
    const succeeded = results.filter(result => result === null).length;
    const reason = results.includes('rate_limited') ? 'rate_limited'
      : results.includes('publication_failed') ? 'publication_failed'
      : results.includes('source_unavailable') ? 'source_unavailable' : undefined;
    return reply(200, { succeeded, failed: results.length - succeeded, total: results.length, ...(reason ? { reason } : {}) });
  } catch {
    return reply(503, { error: 'Synchronisation indisponible. Dernières valeurs valides conservées.' });
  }
}
