import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handleMarketSync } from '../supabase/functions/sync-market/handler';
import { isLegacyManualSyncError, isYahooRateLimit, marketSyncMessage, YahooRateLimitError } from '../src/lib/manual-market-sync';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import SyncFeedback from '../src/components/SyncFeedback';

function setup({ authenticated = true, owner = true, lease = true, failSymbol = '', publicationError = false, rateLimited = [] as string[] } = {}) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const fetched: string[] = [];
  const pauses: number[] = [];
  let serverClients = 0;
  const deps = {
    url: 'https://test.invalid', key: 'publishable-test', serviceKey: 'server-test',
    createClient: (_url: string, key: string) => {
      if (key === 'server-test') serverClients++;
      return {
        auth: { getUser: async () => ({ data: { user: authenticated ? { id: 'owner' } : null }, error: null }) },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: owner ? { user_id: 'owner' } : null, error: null }) }) }) }),
        rpc: async (name: string, args?: Record<string, unknown>) => {
          calls.push({ name, args });
          return { data: name === 'try_start_manual_market_sync' ? lease : null, error: name === 'publish_manual_market_instrument' && publicationError ? new Error('failure') : null };
        },
      };
    },
    // Pauses neutralisées : le rythme réel est vérifié par les valeurs demandées.
    wait: async (ms: number) => { pauses.push(ms); },
    instruments: [{ symbol: 'A', currency: 'EUR' }, { symbol: 'B', currency: 'EUR' }],
    fetchReturn: async (symbol: string) => {
      fetched.push(symbol);
      if (rateLimited.includes(symbol)) throw new YahooRateLimitError();
      if (symbol === failSymbol) throw new Error('Provider unavailable');
      return { prices: [], performance: { symbol } };
    },
  };
  const request = (method = 'POST', token = true) => new Request('https://test.invalid/functions/v1/sync-market', { method, headers: token ? { Authorization: 'Bearer test-user' } : {} });
  return { deps, request, calls, fetched, pauses, serverClients: () => serverClients };
}
test('manuel : OPTIONS et méthodes interdites ne touchent ni base ni source', async () => {
  const s = setup();
  assert.equal((await handleMarketSync(s.request('OPTIONS', false), s.deps)).status, 204);
  assert.equal((await handleMarketSync(s.request('GET'), s.deps)).status, 405);
  assert.deepEqual(s.calls, []);
});
test('manuel : absence de session, session invalide ou non-propriétaire refusés avant tout privilège', async () => {
  for (const options of [{ authenticated: false }, { owner: false }, {}]) {
    const s = setup(options);
    const response = await handleMarketSync(s.request('POST', Object.keys(options).length > 0), s.deps);
    assert.equal(response.status, options.owner === false ? 403 : 401);
    assert.equal(s.serverClients(), 0);
    assert.deepEqual(s.fetched, []);
    assert.deepEqual(s.calls, []);
  }
});
test('manuel : le verrou serveur refuse les lancements rapprochés sans contacter Yahoo', async () => {
  const s = setup({ lease: false });
  assert.equal((await handleMarketSync(s.request(), s.deps)).status, 429);
  assert.deepEqual(s.fetched, []);
});
test('manuel : succès, publication et bilan complet sans écriture du portefeuille', async () => {
  const s = setup();
  const response = await handleMarketSync(s.request(), s.deps);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { succeeded: 2, failed: 0, total: 2 });
  assert.deepEqual(s.calls.map(c => c.name), ['try_start_manual_market_sync', 'publish_manual_market_instrument', 'publish_manual_market_instrument']);
});
test('manuel : échec partiel conserve les derniers cours sans persister le statut d’échec', async () => {
  const s = setup({ failSymbol: 'B' });
  const response = await handleMarketSync(s.request(), s.deps);
  assert.deepEqual(await response.json(), { succeeded: 1, failed: 1, total: 2, reason: 'source_unavailable' });
  assert.equal(s.calls.filter(c => c.name === 'publish_manual_market_instrument').length, 1);
  assert.equal(s.calls.some(c => (c.args?.payload as { error?: string })?.error), false);
});
test('manuel : une publication refusée ne doit jamais être comptée comme un succès', async () => {
  const s = setup({ publicationError: true });
  assert.deepEqual(await (await handleMarketSync(s.request(), s.deps)).json(), { succeeded: 0, failed: 2, total: 2, reason: 'publication_failed' });
});
test('manuel : lot séquentiel espacé, jamais en parallèle depuis l’Edge Function', async () => {
  const s = setup();
  assert.equal((await handleMarketSync(s.request(), s.deps)).status, 200);
  assert.deepEqual(s.fetched, ['A', 'B']);
  assert.deepEqual(s.pauses, [400]);
  assert.deepEqual(s.calls.map(c => c.name), ['try_start_manual_market_sync', 'publish_manual_market_instrument', 'publish_manual_market_instrument']);
});
test('manuel : un refus Yahoo 429 est réessayé une fois, puis interrompt le lot sans faux statut des instruments ignorés', async () => {
  const s = setup({ rateLimited: ['A', 'B'] });
  const result = await (await handleMarketSync(s.request(), s.deps)).json();
  assert.deepEqual(result, { succeeded: 0, failed: 2, total: 2, reason: 'rate_limited' as const });
  // Sonde + unique réessai, puis plus aucune requête : pas d'acharnement.
  assert.deepEqual(s.fetched, ['A', 'A']);
  assert.deepEqual(s.pauses, [1200]);
  assert.equal(s.calls.filter(c => c.name === 'publish_manual_market_instrument').length, 0);
  assert.match(marketSyncMessage(result), /Yahoo Finance limite les requêtes \(HTTP 429\)/);
  assert.match(marketSyncMessage(result), /interrompue/);
});
test('manuel : un 429 isolé ne fait pas échouer les instruments déjà synchronisés', async () => {
  const s = setup({ rateLimited: ['B'] });
  const result = await (await handleMarketSync(s.request(), s.deps)).json();
  assert.deepEqual(result, { succeeded: 1, failed: 1, total: 2, reason: 'rate_limited' });
  assert.deepEqual(s.fetched, ['A', 'B', 'B']);
  assert.equal(s.calls.filter(c => c.name === 'publish_manual_market_instrument').length, 1);
});
test('adaptateur Yahoo : le refus de débit reste reconnaissable sans relire un message libre', () => {
  assert.equal(isYahooRateLimit(new YahooRateLimitError()), true);
  assert.equal(isYahooRateLimit(new Error('Yahoo Finance : HTTP 429.')), true);
  assert.equal(isYahooRateLimit(new Error('Yahoo Finance : HTTP 500.')), false);
  assert.equal(isYahooRateLimit(new Error('Provider unavailable')), false);
  assert.equal(isYahooRateLimit(null), false);
});
test('manuel : erreur source et refus d’écriture ont des explications distinctes', () => {
  assert.match(marketSyncMessage({ succeeded: 0, failed: 2, total: 2, reason: 'publication_failed' }), /enregistrement/);
  assert.match(marketSyncMessage({ succeeded: 1, failed: 1, total: 2, reason: 'source_unavailable' }), /indisponibles ou invalides/);
  assert.equal(marketSyncMessage({ succeeded: 2, failed: 0, total: 2 }), '2/2 rendements synchronisés.');
});
test('l’en-tête des montants et le bouton sont communs à tous les onglets', () => {
  const panel = readFileSync('src/components/MarketPanel.tsx', 'utf8');
  assert.ok(panel.indexOf('<PortfolioStatus ') < panel.indexOf("{tab === 'editor' &&"));
  const component = readFileSync('src/components/PortfolioStatus.tsx', 'utf8');
  assert.ok(component.includes('Montants au '));
  assert.ok(component.includes('Synchroniser les rendements'));
  assert.ok(component.includes('className="lime sync-market-icon" aria-hidden="true">↻</span>'));
  assert.ok(component.includes('disabled={syncing}'));
  assert.ok(!readFileSync('src/components/Dashboard.tsx', 'utf8').includes('Mis à jour le'));
});
test('bilan : encadré d’alerte avec une puce, et rien en l’absence de message', () => {
  const html = renderToStaticMarkup(createElement(SyncFeedback, { message: 'Échec temporaire', error: true }));
  assert.match(html, /class="alert sync-market-feedback"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /<ul><li>Échec temporaire<\/li><\/ul>/);
  assert.equal(renderToStaticMarkup(createElement(SyncFeedback, { message: '', error: false })), '');
});
test('les anciens échecs manuels sont ignorés sans masquer les erreurs du cron', () => {
  assert.equal(isLegacyManualSyncError('Échec de la synchronisation manuelle. Dernières valeurs valides conservées.'), true);
  assert.equal(isLegacyManualSyncError('Yahoo Finance limite les requêtes (HTTP 429). Réessaie plus tard. Dernières valeurs valides conservées.'), true);
  assert.equal(isLegacyManualSyncError('Yahoo Finance : HTTP 429.'), false);
  assert.equal(isLegacyManualSyncError(null), false);
});
test('le symbole tourne uniquement pendant la synchronisation et respecte la réduction des animations', () => {
  const css = readFileSync('src/components/portfolio-status.css', 'utf8');
  assert.ok(css.includes('[aria-busy="true"] .sync-market-icon{animation:market-sync-spin'));
  assert.ok(css.includes('@keyframes market-sync-spin'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
});
