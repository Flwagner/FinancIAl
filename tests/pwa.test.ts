import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import manifest from '../src/app/manifest';

function worker(scope = 'https://example.org/FinancIAl/') {
  const listeners: Record<string, (event: any) => void> = {};
  const cached: string[] = [];
  const deleted: string[] = [];
  const offline = new Response('offline');
  let online = true;
  let claimed = false;
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL, Request, Response,
    self: {
      registration: { scope },
      clients: { claim: async () => { claimed = true; } },
      addEventListener: (name: string, listener: (event: any) => void) => { listeners[name] = listener; },
    },
    caches: {
      open: async () => ({
        add: async (request: Request) => { cached.push(request.url); },
        match: async (url: string) => url === `${scope}offline.html` ? offline : undefined,
      }),
      keys: async () => ['financial-offline-v0', 'financial-offline-v1', 'other-app'],
      delete: async (name: string) => { deleted.push(name); },
    },
    fetch: async () => { if (!online) throw new TypeError('offline'); return new Response('network'); },
  });
  return { listeners, cached, deleted, offline, disconnect: () => { online = false; }, claimed: () => claimed };
}

test('manifeste installable à la racine et sur un sous-chemin GitHub Pages', () => {
  const previous = process.env.NEXT_PUBLIC_BASE_PATH;
  try {
    for (const base of ['', '/FinancIAl']) {
      process.env.NEXT_PUBLIC_BASE_PATH = base;
      const result = manifest();
      assert.equal(result.start_url, `${base}/`);
      assert.equal(result.scope, `${base}/`);
      assert.equal(result.id, `${base}/`);
      assert.equal(result.display, 'standalone');
      assert.deepEqual(result.icons?.map(icon => icon.sizes), ['192x192', '512x512', '512x512']);
      assert.ok(result.icons?.every(icon => icon.src.startsWith(`${base}/icons/`)));
    }
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
    else process.env.NEXT_PUBLIC_BASE_PATH = previous;
  }
});

test('installation : seule la page publique hors connexion est mise en cache', async () => {
  for (const scope of ['https://example.org/', 'https://example.org/FinancIAl/']) {
    const state = worker(scope);
    let pending: Promise<unknown> | undefined;
    state.listeners.install({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    assert.deepEqual(state.cached, [`${scope}offline.html`]);
  }
});

test('navigation réseau prioritaire, puis page publique hors connexion sans cache du portefeuille', async () => {
  const state = worker();
  let response: Promise<Response> | undefined;
  const event = {
    request: { method: 'GET', mode: 'navigate', url: 'https://example.org/FinancIAl/?private=value' },
    respondWith: (promise: Promise<Response>) => { response = promise; },
  };
  state.listeners.fetch(event);
  assert.equal(await (await response)!.text(), 'network');
  state.disconnect();
  state.listeners.fetch(event);
  assert.equal(await response, state.offline);
  assert.deepEqual(state.cached, []);
});

test('les API, requêtes externes, assets et écritures ne sont pas interceptés', () => {
  const state = worker();
  for (const request of [
    { method: 'GET', mode: 'cors', url: 'https://project.supabase.co/rest/v1/portfolio' },
    { method: 'GET', mode: 'navigate', url: 'https://example.org/another-app/' },
    { method: 'GET', mode: 'no-cors', url: 'https://example.org/FinancIAl/asset.js' },
    { method: 'POST', mode: 'navigate', url: 'https://example.org/FinancIAl/' },
  ]) {
    state.listeners.fetch({ request, respondWith: () => assert.fail('Ne doit pas intercepter cette requête') });
  }
});

test('activation : conserve les caches étrangers et prend le contrôle des pages', async () => {
  const state = worker();
  let pending: Promise<unknown> | undefined;
  state.listeners.activate({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.deepEqual(state.deleted, ['financial-offline-v0']);
  assert.equal(state.claimed(), true);
});
