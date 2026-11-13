import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSyncImpact, impactPresentation, applicableImpact, impactContextChanged, hasDailyReference, parisDay, dailyImpactLabel, type SyncImpact } from '../src/lib/sync-impact';
import { finishPushSync, isAllowedPushEndpoint, notificationBody, type PushContext, type PushRpc } from '../scripts/lib/push';
import type { MarketData, MarketReturn } from '../src/lib/market';
import type { Reading } from '../src/lib/portfolio';
import webPush from 'web-push';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SyncImpactNote from '../src/components/SyncImpactNote';

const now = new Date('2026-11-13T09:30:00Z');
const reading: Reading = {
  id: 'r', date: '2026-11-01', projected: false, total: 10000,
  positions: [
    { id: '1', name: 'ETF', envelope: 'PEA', category: 'Actions', code: 'EPA:WPEA', amount: 6000, rate: 5, rateSource: 'market' },
    { id: '2', name: 'SCPI', envelope: '', category: 'SCPI', code: '', amount: 4000, rate: 4, rateSource: 'manual' },
  ], categoryRates: { Actions: 99, SCPI: 6 },
};
const performance: MarketReturn = { symbol: 'WPEA.PA', currency: 'EUR', rate: 10, as_of: '2026-11-12', start_date: '2025-11-12', start_price: 100, end_price: 110, method: 'adjusted_close_365d', fetched_at: now.toISOString() };
const beforeMarket: MarketData = { returns: [performance], statuses: [] };
const afterMarket: MarketData = { returns: [{ ...performance, rate: 12 }], statuses: [] };
const version = '2026-11-12T12:00:00Z';
const impact: SyncImpact = { before_rate: 8.4, after_rate: 9.6, portfolio_updated_at: version, synced_at: now.toISOString(), partial: false, reference_at: '2026-11-12T20:00:00Z' };

test('impact global pondéré, taux manuels/synthèse inclus et portefeuille inchangé', () => {
  const original = JSON.stringify(reading);
  const result = calculateSyncImpact(reading, beforeMarket, afterMarket, now);
  assert.equal(result.before_rate, 8.4);
  assert.equal(result.after_rate, 9.6);
  assert.equal(JSON.stringify(reading), original);
  const normalized = { ...reading, positions: reading.positions.map(p => ({ ...p, amount: p.amount / reading.total })), total: 1 };
  assert.ok(Math.abs(calculateSyncImpact(normalized, beforeMarket, afterMarket, now).after_rate - result.after_rate) < 1e-10);
});
test('première synchro : taux du relevé en repli ; échec : dernière valeur conservée', () => {
  assert.equal(calculateSyncImpact(reading, { returns: [], statuses: [] }, afterMarket, now).before_rate, 5.4);
  const failed = { ...beforeMarket, statuses: [{ symbol: 'WPEA.PA', last_attempt_at: now.toISOString(), error: 'failed' }] };
  assert.equal(calculateSyncImpact(reading, beforeMarket, failed, now).before_rate, 8.4);
  assert.equal(calculateSyncImpact(reading, beforeMarket, failed, now).after_rate, 8.4);
});
test('présentation : hausse, baisse, zéro et arrondis du taux affiché', () => {
  assert.deepEqual(impactPresentation(9.52, 9.68), { direction: 'up', points: '+0,16 point', transition: '9,52 % → 9,68 %' });
  assert.equal(impactPresentation(9.52, 9.41).points, '−0,11 point');
  assert.equal(impactPresentation(9.52, 9.41).direction, 'down');
  assert.equal(impactPresentation(9.521, 9.524).direction, 'flat');
  assert.equal(impactPresentation(9.524, 9.526).points, '+0,01 point');
  assert.equal(impactPresentation(9, 11).points, '+2 points');
  assert.equal(impactPresentation(-9.525, -9.524).points, '+0,01 point');
});
test('carte : conserve la dernière variation et signale un contexte modifié', () => {
  assert.equal(applicableImpact(impact), impact);
  assert.equal(impactContextChanged(impact, 9.6), false);
  assert.equal(impactContextChanged(impact, 8.4), true);
  assert.equal(impactContextChanged(impact, NaN), true);
  // A goals-only save changes the timestamp, but must not trigger a warning.
  assert.equal(impactContextChanged({ ...impact, portfolio_updated_at: '2026-11-13T12:00:00Z' }, 9.6), false);
  assert.equal(applicableImpact(undefined), null);
  assert.equal(applicableImpact(null), null);
  assert.equal(applicableImpact({ ...impact, after_rate: NaN }), null);
  assert.equal(applicableImpact({ ...impact, before_rate: Infinity }), null);
  const changed = renderToStaticMarkup(createElement(SyncImpactNote, { impact, contextChanged: true }));
  assert.match(changed, /8,4 % → 9,6 %/);
  assert.match(changed, /comparatif est conservé à titre indicatif/);
  assert.equal(impactContextChanged({ ...impact, reference_changed: true }, 9.6), true);
});

test('carte : rendu avant/après, flèche et couleurs de hausse/baisse/stabilité', () => {
  const up = renderToStaticMarkup(createElement(SyncImpactNote, { impact }));
  assert.match(up, /8,4 % → 9,6 %/);
  assert.match(up, /capital-change positive/);
  assert.match(up, /arrow-up-right/);
  assert.match(up, /Variation /);
  assert.match(up, /Référence :/);
  assert.match(up, /heure de Paris/);
  assert.doesNotMatch(up, /comparatif est conservé à titre indicatif/);
  const down = renderToStaticMarkup(createElement(SyncImpactNote, { impact: { ...impact, after_rate: 8, partial: true } }));
  assert.match(down, /capital-change negative/);
  assert.match(down, /arrow-down-right/);
  assert.match(down, /partielle/);
  const flat = renderToStaticMarkup(createElement(SyncImpactNote, { impact: { ...impact, after_rate: impact.before_rate } }));
  assert.match(flat, /capital-change muted/);
  assert.match(flat, /0 point/);
});
test('référence quotidienne : heure de Paris, été/hiver, initialisation et jour sans job', () => {
  assert.equal(parisDay('2026-11-12T23:00:00Z'), '2026-11-13');
  assert.equal(parisDay('2026-07-12T22:00:00Z'), '2026-07-13');
  assert.equal(parisDay('2026-10-25T00:30:00Z'), '2026-10-25');
  assert.equal(parisDay('2026-10-25T01:30:00Z'), '2026-10-25');
  assert.equal(hasDailyReference(impact), true);
  assert.equal(hasDailyReference({ ...impact, reference_at: impact.synced_at }), false);
  assert.equal(hasDailyReference({ ...impact, reference_at: null }), false);
  assert.equal(hasDailyReference({ ...impact, reference_at: 'invalid' }), false);
  assert.equal(dailyImpactLabel(impact, now), 'aujourd’hui');
  assert.equal(dailyImpactLabel(impact, new Date('2026-11-14T12:00:00Z')), 'le 13/11/2026');
  const pending = renderToStaticMarkup(createElement(SyncImpactNote, { impact: { ...impact, reference_at: null } }));
  assert.match(pending, /Référence quotidienne en cours d’initialisation/);
  assert.doesNotMatch(pending, /point|→/);
});

test('job horaire : utilise le comparatif quotidien du serveur, même au retour à zéro', async () => {
  const keys = webPush.generateVAPIDKeys();
  const env = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:test@example.com', PUSH_NOTIFICATIONS_ENABLED: 'true' };
  const bodies: string[] = [];
  let daily = { ...impact, before_rate: 9.52, after_rate: 9.43 };
  const rpc = (async (operation: string) => operation === 'context' ? { ...context, market: afterMarket } : {
    accepted: true, impact: daily, should_notify: true,
    subscriptions: [{ id: 'test', endpoint: 'https://fcm.googleapis.com/test', keys: {} }],
  }) as PushRpc;
  const send: typeof webPush.sendNotification = async (_, payload) => {
    bodies.push(JSON.parse(payload as string).body);
    return { statusCode: 201, headers: {}, body: '' };
  };
  await finishPushSync(rpc, context, false, { env, send });
  daily = { ...daily, after_rate: 9.48 };
  await finishPushSync(rpc, context, false, { env, send });
  daily = { ...daily, after_rate: 9.52 };
  await finishPushSync(rpc, context, false, { env, send });
  assert.match(bodies[0], /−0,09 point aujourd’hui/);
  assert.match(bodies[1], /9,52 % → 9,48 %/);
  assert.match(bodies[1], /−0,04 point aujourd’hui/);
  assert.match(bodies[2], /0 point aujourd’hui/);
});

test('jobs silencieux : enregistrement sans notification ni demande de livraison', async () => {
  const keys = webPush.generateVAPIDKeys();
  const base = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:test@example.com' };
  let records = 0;
  let sends = 0;
  const rpc = (async (operation: string, payload?: { notify_enabled: boolean }) => {
    if (operation === 'context') return { ...context, market: afterMarket };
    records++;
    assert.equal(payload?.notify_enabled, false);
    // Even an inconsistent server response cannot bypass the local opt-in.
    return { accepted: true, impact, should_notify: true, subscriptions: [{ endpoint: 'https://fcm.googleapis.com/test' }] };
  }) as PushRpc;
  for (const flag of [undefined, 'false', 'TRUE', '']) {
    await finishPushSync(rpc, context, false, {
      env: { ...base, PUSH_NOTIFICATIONS_ENABLED: flag },
      send: async () => { sends++; throw new Error('must not send'); },
    });
  }
  assert.equal(records, 4);
  assert.equal(sends, 0);
});

test('notifications : contenu sans montants, couleur symbolique, mention partielle', () => {
  assert.match(notificationBody(9.52, 9.68, false), /🟢 9,52 % → 9,68 % ↗/);
  assert.match(notificationBody(9.52, 9.41, true), /🔴.*↘\n−0,11 point.*Synchronisation partielle/);
  assert.doesNotMatch(notificationBody(9.52, 9.68, false), /€/);
});
test('Push : refuse les endpoints internes, ports, identifiants et faux domaines', () => {
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.test/x', 'https://evil.test/x', 'https://user:pass@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x']) assert.equal(isAllowedPushEndpoint(endpoint), false, endpoint);
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/test', 'https://updates.push.services.mozilla.com/wpush/v2/test', 'https://web.push.apple.com/test', 'https://wns2-bl2p.notify.windows.com/test']) assert.equal(isAllowedPushEndpoint(endpoint), true, endpoint);
});

const context: PushContext = { captured_at: now.toISOString(), market: beforeMarket, portfolios: [{ user_id: 'owner', updated_at: version, reading }] };

test('job : enregistre même sans VAPID, ignore un portefeuille édité entre-temps', async () => {
  const records: object[] = [];
  const rpc = (async (operation: string, payload?: object) => {
    if (operation === 'context') return { ...context, market: afterMarket };
    records.push(payload!); return { accepted: true, impact, should_notify: false, subscriptions: [] };
  }) as PushRpc;
  await finishPushSync(rpc, context, true, { env: {} });
  assert.equal(records.length, 1);
  assert.equal((records[0] as SyncImpact).partial, true);
  assert.equal('before_rate' in records[0], false);
  assert.equal((records[0] as SyncImpact).after_rate, 9.6);
  await finishPushSync(rpc, { ...context, portfolios: [{ ...context.portfolios[0], updated_at: 'other' }] }, false, { env: {} });
  assert.equal(records.length, 1);
});

test('job : aucun envoi si inchangé ou si la RPC refuse un doublon', async () => {
  let sends = 0;
  const rpc = (async (operation: string) => operation === 'context' ? context : { accepted: false, subscriptions: [{ endpoint: 'https://fcm.googleapis.com/test' }] }) as PushRpc;
  await finishPushSync(rpc, context, false, { env: {}, send: async () => { sends++; throw new Error('must not send'); } });
  assert.equal(sends, 0);
});

test('job : envoie un récapitulatif par appareil, nettoie les 410 sans afficher les endpoints', async () => {
  const keys = webPush.generateVAPIDKeys();
  const expired: string[] = [];
  const sent: string[] = [];
  const subscriptions = ['ok', 'gone'].map(id => ({ id, endpoint: `https://fcm.googleapis.com/${id}`, keys: { p256dh: 'test', auth: 'test' } }));
  const rpc = (async (operation: string, payload?: { id?: string }) => {
    if (operation === 'context') return { ...context, market: afterMarket };
    if (operation === 'record') return { accepted: true, impact: { ...impact, partial: true, reference_changed: true }, should_notify: true, subscriptions };
    expired.push(payload!.id!); return {};
  }) as PushRpc;
  await finishPushSync(rpc, context, true, {
    env: { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:test@example.com', PUSH_NOTIFICATIONS_ENABLED: 'true' },
    send: async (subscription, payload) => {
      sent.push(JSON.parse(payload as string).body);
      if (subscription.endpoint.endsWith('/gone')) throw { statusCode: 410 };
      return { statusCode: 201, headers: {}, body: '' };
    },
  });
  assert.equal(sent.length, 2);
  assert.match(sent[0], /Synchronisation partielle/);
  assert.match(sent[0], /aujourd’hui/);
  assert.match(sent[0], /Placements modifiés/);
  assert.deepEqual(expired, ['gone']);
});

test('job : pas de Push si le serveur constate un taux déjà notifié', async () => {
  const keys = webPush.generateVAPIDKeys();
  let sends = 0;
  const rpc = (async (operation: string) => operation === 'context' ? context : { accepted: true, impact, should_notify: false, subscriptions: [{ endpoint: 'https://fcm.googleapis.com/test' }] }) as PushRpc;
  await finishPushSync(rpc, context, false, {
    env: { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:test@example.com', PUSH_NOTIFICATIONS_ENABLED: 'true' },
    send: async () => { sends++; throw new Error('must not send'); },
  });
  assert.equal(sends, 0);
});
