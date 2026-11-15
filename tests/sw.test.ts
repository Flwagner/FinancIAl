import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const scope = 'https://example.github.io/FinancIAl/';

function worker(now: string, store = new Map<string, string>()) {
  const listeners: Record<string, (event: any) => void> = {};
  const shown: { title: string; options: { body: string; icon: string; tag?: string; silent?: boolean; renotify?: boolean; data: { url: string } } }[] = [];
  const opened: string[] = [];
  const FakeDate = class extends Date {
    constructor(value?: string | number) { super(value === undefined ? now : value); }
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    URL, Response, Date: FakeDate,
    self: {
      addEventListener: (name: string, callback: (event: unknown) => void) => { listeners[name] = callback; },
      registration: { scope, showNotification: async (title: string, options: typeof shown[number]['options']) => { shown.push({ title, options }); } },
      clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } },
    },
    caches: {
      open: async () => ({
        match: async (url: string) => store.has(url) ? new Response(store.get(url)) : undefined,
        put: async (url: string, response: Response) => { store.set(url, await response.text()); },
      }),
    },
  });
  return { listeners, shown, opened, store };
}

test('service worker : une seule alerte par jour, clic limité au sous-chemin de la PWA', async () => {
  const store = new Map<string, string>();
  const first = worker('2026-11-15T09:30:00+01:00', store);
  let pending: Promise<unknown> | undefined;

  first.listeners.push({ data: { json: () => ({ body: '🟢 9,52 % → 9,68 %', url: 'https://evil.test' }) }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.equal(first.shown[0].options.body, '🟢 9,52 % → 9,68 %');
  assert.equal(first.shown[0].options.icon, `${scope}icons/icon-192.png`);
  assert.equal(first.shown[0].options.data.url, scope);
  assert.equal(first.shown[0].options.silent, false);
  assert.equal(first.shown[0].options.renotify, true);

  // Même journée : le second Push rafraîchit sans alerter.
  first.listeners.push({ data: { json: () => ({ body: '🟢 9,52 % → 9,74 %' }) }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.equal(first.shown[1].options.body, '🟢 9,52 % → 9,74 %');
  assert.equal(first.shown[1].options.silent, true);
  assert.equal(first.shown[1].options.renotify, false);

  first.listeners.notificationclick({ notification: { close: () => {} }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.deepEqual(first.opened, [scope]);

  // Le lendemain, la même mémoire locale autorise une nouvelle alerte.
  const nextDay = worker('2026-11-16T09:30:00+01:00', store);
  nextDay.listeners.push({ data: { json: () => ({ body: '🔴 9,74 % → 9,58 %' }) }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.equal(nextDay.shown[0].options.silent, false);
  assert.equal(nextDay.shown[0].options.renotify, true);

  nextDay.listeners.push({ data: { json: () => { throw new Error('bad JSON'); } }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.match(nextDay.shown[1].options.body, /actualisé/);
});
