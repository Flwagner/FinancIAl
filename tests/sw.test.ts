import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('service worker : notification visible et clic limité au sous-chemin de la PWA', async () => {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: { title: string; options: { body: string; icon: string; data: { url: string } } }[] = [];
  const opened: string[] = [];
  const scope = 'https://example.github.io/FinancIAl/';
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    URL, self: {
      addEventListener: (name: string, callback: (event: unknown) => void) => { listeners[name] = callback; },
      registration: { scope, showNotification: async (title: string, options: typeof shown[number]['options']) => { shown.push({ title, options }); } },
      clients: { matchAll: async () => [], openWindow: async (url: string) => { opened.push(url); } },
    },
  });
  let pending: Promise<unknown> | undefined;
  listeners.push({ data: { json: () => ({ body: '🟢 9,52 % → 9,68 %', url: 'https://evil.test' }) }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.equal(shown[0].options.body, '🟢 9,52 % → 9,68 %');
  assert.equal(shown[0].options.icon, `${scope}icons/icon-192.png`);
  assert.equal(shown[0].options.data.url, scope);
  listeners.notificationclick({ notification: { close: () => {} }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.deepEqual(opened, [scope]);
  listeners.push({ data: { json: () => { throw new Error('bad JSON'); } }, waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
  await pending;
  assert.match(shown[1].options.body, /actualisé/);
});
