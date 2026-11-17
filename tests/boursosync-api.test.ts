import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createApi, validateProject } from '../extension/shared/api.mjs';
import { selectedBatch } from '../extension/shared/matching.mjs';
const project = { version: 1, supabaseUrl: 'https://unit-test.supabase.co', publishableKey: 'sb_publishable_test' };
test('connexion : session temporaire, hash seul vers la RPC, logout local et capacité seule retournée', async () => {
  const paths: string[] = [];
  const api = createApi(project, (async (url: string, init: RequestInit) => {
    paths.push(url);
    assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
    const body = JSON.parse(String(init.body));
    if (url.includes('/token?')) return { ok: true, json: async () => ({ access_token: 'temporary-jwt', refresh_token: 'never-persist' }) };
    if (url.includes('/boursosync_connect')) {
      assert.match(body.token_hash, /^[a-f0-9]{64}$/);
      assert.equal((init.headers as any).Authorization, 'Bearer temporary-jwt');
      return { ok: true, json: async () => ({ ok: true }) };
    }
    assert.ok(url.endsWith('/logout?scope=local'));
    return { ok: true, status: 204 };
  }) as unknown as typeof fetch, webcrypto as unknown as Crypto);
  const result = await api.connect('test@example.invalid', 'test-only-password');
  assert.deepEqual(Object.keys(result), ['token']);
  assert.match(result.token, /^[a-f0-9]{64}$/);
  assert.equal(paths.length, 3);
});
test('connexion refusée par la RPC : logout quand même et aucun secret dans l’erreur', async () => {
  let loggedOut = false;
  const api = createApi(project, (async (url: string) => {
    if (url.includes('/token?')) return { ok: true, json: async () => ({ access_token: 'private-test-jwt' }) };
    if (url.includes('/logout?')) { loggedOut = true; return { ok: true, status: 204 }; }
    return { ok: false, status: 403, json: () => assert.fail('Ne pas lire le corps privé') };
  }) as unknown as typeof fetch, webcrypto as unknown as Crypto);
  await assert.rejects(api.connect('x', 'y'), /expiré ou révoqué/);
  assert.equal(loggedOut, true);
});
test('projet : refus URL non Supabase et clés privilégiées', () => {
  for (const invalid of [{ ...project, supabaseUrl: 'https://evil.example' }, { ...project, publishableKey: 'sb_secret_private' }]) {
    assert.throws(() => validateProject(invalid));
  }
});
test('lot sélectionné : choix obligatoires, destination unique, fraîcheur et exclusion explicite', () => {
  const row = { account: 'b'.repeat(64), asset: 'IE0002XZSHO1', cents: 0, capturedAt: new Date().toISOString() };
  const key = `${row.account}:${row.asset}`;
  const positions = [{ id: 'test', code: row.asset, envelope: 'PEA' }];
  assert.equal(selectedBatch([row], { [key]: 'test' }, positions, 'batch').updates[0].cents, 0);
  assert.throws(() => selectedBatch([row], {}, positions, 'batch'));
  assert.throws(() => selectedBatch([row, row], { [key]: 'test' }, positions, 'batch'));
  assert.throws(() => selectedBatch([row], { [key]: 'ignore' }, positions, 'batch'));
  assert.throws(() => selectedBatch([{ ...row, capturedAt: '2000-01-01' }], { [key]: 'test' }, positions, 'batch'));
});
