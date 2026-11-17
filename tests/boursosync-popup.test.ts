import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { mergeCaptures, replaceAccountCaptures } from '../extension/shared/core.mjs';
import { createApi, validateProject } from '../extension/shared/api.mjs';
import { matchSources, selectedBatch } from '../extension/shared/matching.mjs';

const html = readFileSync(new URL('../extension/popup/popup.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../extension/popup/controller.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/load\(\)\.catch\([\s\S]*$/, 'globalThis.ready = load();');
const project = { version: 1, supabaseUrl: 'https://unit-test.supabase.co', publishableKey: 'sb_publishable_test', aliases: {} };
const token = 'a'.repeat(64);
const catalog = { positions: [{ id: 'test', name: 'Destination de test', code: 'IE0002XZSHO1', envelope: 'PEA' }], mappings: [] };
const capture = () => ({ account: 'b'.repeat(64), asset: 'IE0002XZSHO1', envelope: 'PEA', label: 'Source de test', cents: 12345, capturedAt: new Date().toISOString() });
async function popup(session: Record<string, unknown>, send: (body: any) => Promise<any>, allowed = true, pageResult?: unknown, firstConnection = false, tabUrl?: string) {
  const { document } = parseHTML(html);
  const events: Record<string, (event?: any) => Promise<void>> = {};
  for (const id of ['login', 'sync', 'disconnect']) {
    document.getElementById(id)!.addEventListener = ((_type: string, fn: () => Promise<void>) => { events[id] = fn; }) as never;
  }
  const local: Record<string, unknown> = firstConnection ? {} : { connection: { token } };
  const storage = (data: Record<string, unknown>) => ({
    get: async (key: string | string[]) => Object.fromEntries((Array.isArray(key) ? key : [key]).map(k => [k, data[k]])),
    set: async (values: Record<string, unknown>) => { Object.assign(data, values); },
    remove: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
    clear: async () => { for (const key of Object.keys(data)) delete data[key]; },
    setAccessLevel: async () => {},
  });
  let reads = 0;
  const context = createContext({ document, mergeCaptures, replaceAccountCaptures, matchSources, selectedBatch, createApi, validateProject,
    crypto: webcrypto, URL, AbortSignal, TextEncoder, TypeError,
    fetch: async (url: string, options: RequestInit) => {
      if (url === 'extension://project.json') return { ok: true, json: async () => project };
      const body = JSON.parse(String(options.body));
      if (body.operation === 'context') return { ok: true, json: async () => catalog };
      return send(body);
    },
    readBoursoPage: () => { throw new Error('Pas de lecture bancaire dans ce test'); },
    chrome: { storage: { local: storage(local), session: storage(session) },
      tabs: { query: async () => [{ id: 1, url: tabUrl || (pageResult === undefined ? 'https://example.invalid/' : 'https://clients.boursobank.com/compte/pea/account-test/positions') }] },
      scripting: { executeScript: async (options: { args: unknown[] }) => {
        reads++;
        assert.equal(options.args[0], true);
        return [{ result: pageResult }];
      } },
      permissions: { contains: async () => allowed, request: async () => assert.fail('Aucune demande de permission depuis le popup') },
      runtime: { getURL: (path: string) => `extension://${path}` } },
  });
  // Le vrai client utilise le fetch injecté, jamais celui du processus de test.
  context.createApi = (config: unknown) => createApi(config, context.fetch, webcrypto as unknown as Crypto);
  runInContext(source, context);
  await context.ready;
  return { document, events, local, reads: () => reads };
}
test('popup : reconnaissance persistée, aucun envoi avant confirmation', async () => {
  let calls = 0;
  const session: Record<string, any> = { captures: [capture()] };
  const ui = await popup(session, async body => {
    calls++;
    assert.equal(body.operation, 'sync');
    assert.equal(body.payload.updates[0].positionId, 'test');
    assert.equal(body.payload.updates[0].cents, 12345);
    return { ok: true, json: async () => ({ ok: true, count: 1, batchId: body.payload.batchId }) };
  });
  assert.equal(calls, 0);
  assert.equal(session.choices[`${'b'.repeat(64)}:IE0002XZSHO1`], 'test');
  await ui.events.sync();
  assert.equal(calls, 1);
  assert.match(ui.document.getElementById('status')!.textContent!, /Synchronisé/);
  assert.deepEqual(session, {});
});
test('popup : réponse perdue puis réouverture conserve le même lot', async () => {
  const session: Record<string, any> = { captures: [capture()] };
  let id: string;
  const first = await popup(session, async body => { id = body.payload.batchId; throw new TypeError('Network'); });
  await first.events.sync();
  assert.ok(session.pending);
  assert.ok(!JSON.stringify(session).includes(token));
  const second = await popup(session, async body => {
    assert.equal(body.payload.batchId, id);
    return { ok: true, json: async () => ({ ok: true, count: 1, batchId: id, duplicate: true }) };
  });
  await second.events.sync();
  assert.match(second.document.getElementById('status')!.textContent!, /déjà reçu/);
});
test('popup : source sans ISIN non devinée, aucun bouton de lecture ni d’effacement', async () => {
  const ui = await popup({ captures: [{ ...capture(), asset: 'balance' }] }, async () => assert.fail('Pas de réseau'));
  assert.equal(ui.document.getElementById('sync')!.hasAttribute('disabled'), true);
  await ui.events.sync();
  assert.match(ui.document.getElementById('status')!.textContent!, /destination/);
  assert.equal(ui.document.getElementById('clear'), null);
  assert.equal(ui.document.getElementById('capture'), null);
  assert.equal(ui.document.getElementById('options'), null);
  assert.ok(html.indexOf('id="sync"') < html.indexOf('<table>'));
});
test('popup : refus réseau ne supprime pas la capacité locale', async () => {
  const ui = await popup({}, async () => assert.fail('Pas de réseau'), false);
  assert.deepEqual(ui.local.connection, { token });
  assert.match(ui.document.getElementById('status')!.textContent!, /Autorise/);
  assert.equal(ui.document.getElementById('login')!.hidden, true);
  assert.equal(ui.document.getElementById('connect')!.hasAttribute('disabled'), true);
});
test('popup : révocation confirmée avant oubli local', async () => {
  const ui = await popup({}, async body => {
    assert.equal(body.operation, 'revoke');
    return { ok: true, json: async () => ({ ok: true }) };
  });
  await ui.events.disconnect();
  assert.equal(ui.local.connection, undefined);
});
test('popup : connexion stocke seulement la capacité et efface le mot de passe du formulaire', async () => {
  const ui = await popup({}, async body => {
    if (body.email) return { ok: true, json: async () => ({ access_token: 'private-jwt-test', refresh_token: 'private-refresh-test' }) };
    if (body.token_hash) return { ok: true, json: async () => ({ ok: true }) };
    return { ok: true, status: 204 };
  }, true, undefined, true);
  assert.equal(ui.document.getElementById('login')!.hidden, false);
  (ui.document.getElementById('email') as HTMLInputElement).value = 'test@example.invalid';
  (ui.document.getElementById('password') as HTMLInputElement).value = 'private-password-test';
  await ui.events.login({ preventDefault() {} });
  assert.equal((ui.document.getElementById('password') as HTMLInputElement).value, '');
  assert.deepEqual(Object.keys(ui.local.connection as object), ['token']);
  for (const secret of ['private-jwt-test', 'private-refresh-test', 'private-password-test']) {
    assert.equal(JSON.stringify(ui.local).includes(secret), false);
  }
});
test('popup : échec de révocation conserve la capacité pour réessayer', async () => {
  const ui = await popup({}, async () => { throw new TypeError('Network'); });
  await ui.events.disconnect();
  assert.ok(ui.local.connection);
  assert.match(ui.document.getElementById('status')!.textContent!, /Déconnexion non confirmée/);
});
test('popup : affiche le diagnostic de capture sans perdre la cause ni envoyer de montant', async () => {
  const ui = await popup({}, async () => assert.fail('Aucun envoi'), true, { error: 'Colonne Montant non identifiée.' });
  assert.equal(ui.reads(), 1);
  assert.match(ui.document.getElementById('status')!.textContent!, /Colonne Montant non identifiée/);
  assert.equal(ui.document.getElementById('rows')!.children.length, 0);
});
const bankPage = () => ({
  accountKey: 'account-test', capturedAccounts: ['account-test'], envelope: 'PEA', capturedAt: new Date().toISOString(), warnings: [],
  rows: [{ asset: 'IE0002XZSHO1', label: 'Source de test', cents: 12345 }],
});
test('popup : ouverture = lecture automatique unique, jamais de synchronisation automatique', async () => {
  let sends = 0;
  const session: Record<string, any> = {};
  const ui = await popup(session, async body => {
    sends++;
    assert.equal(body.operation, 'sync');
    return { ok: true, json: async () => ({ ok: true, count: 1, batchId: body.payload.batchId }) };
  }, true, bankPage());
  assert.equal(ui.reads(), 1);
  assert.equal(sends, 0);
  assert.equal(session.captures.length, 1);
  assert.equal(session.captures[0].cents, 12345);
  assert.match(ui.document.getElementById('status')!.textContent!, /1 montant\(s\) lu/);
  assert.equal(ui.document.getElementById('sync')!.hasAttribute('disabled'), false);
  await ui.events.sync();
  assert.equal(sends, 1);
  assert.equal(ui.reads(), 1, 'Pas de nouvelle capture automatique après le succès');
});
test('popup : première connexion déclenche la lecture, mais jamais avant authentification', async () => {
  const ui = await popup({}, async body => {
    if (body.email) return { ok: true, json: async () => ({ access_token: 'temporary-test-session' }) };
    if (body.token_hash) return { ok: true, json: async () => ({ ok: true }) };
    assert.deepEqual(body, {});
    return { ok: true, status: 204 };
  }, true, bankPage(), true);
  assert.equal(ui.reads(), 0);
  (ui.document.getElementById('email') as HTMLInputElement).value = 'test@example.invalid';
  (ui.document.getElementById('password') as HTMLInputElement).value = 'test-password';
  await ui.events.login({ preventDefault() {} });
  assert.equal(ui.reads(), 1);
  assert.match(ui.document.getElementById('status')!.textContent!, /montant\(s\) lu/);
});
test('popup : lot en attente préservé à la réouverture, même si la page bancaire a changé', async () => {
  const session: Record<string, any> = {};
  const first = await popup(session, async () => { throw new TypeError('Network'); }, true, bankPage());
  await first.events.sync();
  const pending = JSON.stringify(session.pending);
  const originalCaptures = JSON.stringify(session.captures);
  const second = await popup(session, async body => {
    return { ok: true, json: async () => ({ ok: true, count: 1, batchId: body.payload.batchId, duplicate: true }) };
  }, true, { ...bankPage(), rows: [{ asset: 'IE0002XZSHO1', label: 'Source modifiée', cents: 99999 }] });
  assert.equal(second.reads(), 0);
  assert.equal(JSON.stringify(session.pending), pending);
  assert.equal(JSON.stringify(session.captures), originalCaptures);
  assert.match(second.document.getElementById('status')!.textContent!, /envoi précédent/);
  await second.events.sync();
  assert.match(second.document.getElementById('status')!.textContent!, /déjà reçu/);
});
test('popup : onglet non bancaire = aucune injection, aucune écriture', async () => {
  const ui = await popup({}, async () => assert.fail('Aucun envoi'));
  assert.equal(ui.reads(), 0);
  assert.match(ui.document.getElementById('status')!.textContent!, /Ouvre un compte/);
});
test('popup : recalcule les anciens choix vides après mise à jour, sans écraser un choix explicite', async () => {
  const sourceKey = `${'b'.repeat(64)}:IE0002XZSHO1`;
  for (const choice of ['', 'ignore', 'test']) {
    const session = { captures: [capture()], choices: { [sourceKey]: choice } };
    await popup(session, async () => assert.fail('Aucun envoi avant confirmation'));
    assert.equal(session.choices[sourceKey], choice === '' ? 'test' : choice);
  }
});
test('popup : chaque compte de la sidebar a sa propre empreinte, aucune référence brute persistée', async () => {
  const session: Record<string, any> = {};
  await popup(session, async () => assert.fail('Aucun envoi avant confirmation'), true, {
    ...bankPage(), capturedAccounts: ['account-test', 'saving-private-test', 'insurance-private-test'], rows: [
      ...bankPage().rows,
      { accountKey: 'saving-private-test', asset: 'balance', balanceType: 'livret-a', label: 'Livret A personnel', envelope: 'Direct', cents: 234567 },
      { accountKey: 'insurance-private-test', asset: 'balance', balanceType: 'assurance-vie', label: 'Assurance vie personnelle', envelope: 'Assurance vie', cents: 765432 },
    ],
  });
  assert.equal(session.captures.length, 3);
  assert.equal(new Set(session.captures.map((r: any) => r.account)).size, 3);
  assert.deepEqual(session.captures.map((r: any) => r.envelope), ['PEA', 'Direct', 'Assurance vie']);
  for (const row of session.captures) {
    assert.match(row.account, /^[a-f0-9]{64}$/);
    assert.equal(row.accountKey, undefined);
  }
  for (const raw of ['account-test', 'saving-private-test', 'insurance-private-test', 'accountKey']) {
    assert.equal(JSON.stringify(session).includes(raw), false);
  }
  assert.equal(JSON.stringify(session).includes('capturedAccounts'), false);
});
test('popup : un titre disparu après relecture est retiré du prochain lot, les autres comptes restent', async () => {
  const session: Record<string, any> = {};
  const initial = bankPage();
  await popup(session, async () => assert.fail('Aucun envoi à l’ouverture'), true, {
    ...initial, rows: [...initial.rows, { asset: 'FR001400U5Q4', label: 'Titre supprimé de la banque', cents: 777 }],
  });
  const bankAccount = session.captures[0].account;
  const removedKey = `${bankAccount}:FR001400U5Q4`;
  assert.ok(Object.hasOwn(session.choices, removedKey));
  const other = { ...capture(), account: 'c'.repeat(64), asset: 'balance' };
  session.captures.push(other);
  session.choices[`${other.account}:${other.asset}`] = 'ignore';
  let updates: any[] = [];
  const ui = await popup(session, async body => {
    updates = body.payload.updates;
    return { ok: true, json: async () => ({ ok: true, count: 1, batchId: body.payload.batchId }) };
  }, true, { ...bankPage(), rows: [{ ...initial.rows[0], cents: 54321 }] });
  assert.equal(session.captures.length, 2);
  assert.ok(session.captures.some((r: any) => r.account === other.account));
  assert.equal(session.captures.some((r: any) => r.asset === 'FR001400U5Q4'), false);
  assert.equal(Object.hasOwn(session.choices, removedKey), false);
  await ui.events.sync();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].asset, 'IE0002XZSHO1');
  assert.equal(updates[0].cents, 54321);
});
test('popup : compte relu vide retire les captures et désactive l’envoi, sans écriture', async () => {
  const session: Record<string, any> = {};
  await popup(session, async () => assert.fail('Pas d’envoi'), true, bankPage());
  assert.equal(session.captures.length, 1);
  const ui = await popup(session, async () => assert.fail('Pas d’envoi de zéros'), true, { ...bankPage(), rows: [] });
  assert.equal(session.captures.length, 0);
  assert.equal(Object.keys(session.choices).length, 0);
  assert.equal(ui.document.getElementById('sync')!.hasAttribute('disabled'), true);
});
