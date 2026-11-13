import webPush from 'web-push';
import { randomUUID } from 'node:crypto';
import { hasDailyReference, impactPresentation, type SyncImpact } from '../../src/lib/sync-impact';
import { livePositions, type MarketData } from '../../src/lib/market';
import { summarize, type Reading } from '../../src/lib/portfolio';

type WeightedPortfolio = { user_id: string; updated_at: string; reading: Reading };
export type PushContext = { captured_at: string; portfolios: WeightedPortfolio[]; market: MarketData };
type Subscription = webPush.PushSubscription & { id: string };
export type PushRpc = <T>(operation: string, payload?: object) => Promise<T>;

export function pushRpc(url: string, key: string, token: string): PushRpc {
  return async <T>(operation: string, payload: object = {}): Promise<T> => {
    const response = await fetch(`${url}/rest/v1/rpc/push_sync`, {
      method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync_token: token, operation, payload }),
    });
    // Never log token, holdings, subscriptions or response bodies.
    if (!response.ok) throw new Error(`RPC notifications refusée (HTTP ${response.status}). Vérifier la migration et PUSH_SYNC_TOKEN.`);
    return response.json() as Promise<T>;
  };
}

// Subscriptions are user input. Do not allow CI to POST to arbitrary/internal hosts.
export function isAllowedPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return false;
    return url.hostname === 'fcm.googleapis.com'
      || url.hostname === 'updates.push.services.mozilla.com'
      || url.hostname === 'web.push.apple.com'
      || url.hostname.endsWith('.notify.windows.com');
  } catch { return false; }
}

export function notificationBody(before: number, after: number, partial: boolean, referenceChanged = false) {
  const view = impactPresentation(before, after);
  const symbol = view.direction === 'up' ? '🟢' : view.direction === 'down' ? '🔴' : '⚪';
  const arrow = view.direction === 'up' ? '↗' : view.direction === 'down' ? '↘' : '→';
  return `${symbol} ${view.transition} ${arrow}\n${view.points} aujourd’hui · Estimation annuelle${partial ? ' · Synchronisation partielle' : ''}${referenceChanged ? '\nPlacements modifiés depuis la référence quotidienne.' : ''}`;
}

export async function finishPushSync(
  rpc: PushRpc, before: PushContext, partial: boolean,
  options: { send?: typeof webPush.sendNotification; env?: Partial<NodeJS.ProcessEnv> } = {},
) {
  const after = await rpc<PushContext>('context');
  const env = options.env || process.env;
  const runId = env.GITHUB_RUN_ID || randomUUID();
  const configured = !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  // The workflow opts in only for its 10:07 Paris trigger, not the runner's clock.
  // Hourly jobs and manual/local runs still record the daily comparison silently.
  const notifyEnabled = configured && env.PUSH_NOTIFICATIONS_ENABLED === 'true';
  if (notifyEnabled) webPush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  const send = options.send || webPush.sendNotification;
  let failures = 0;
  for (const portfolio of before.portfolios) {
    const current = after.portfolios.find(p => p.user_id === portfolio.user_id);
    if (!current || current.updated_at !== portfolio.updated_at) continue;
    const live = livePositions(current.reading, after.market, new Date(after.captured_at));
    const rate = summarize(live.positions, live.categoryRates).rate;
    const result = await rpc<{ accepted: boolean; should_notify?: boolean; impact?: SyncImpact; subscriptions: Subscription[] }>('record', {
      user_id: portfolio.user_id, portfolio_updated_at: portfolio.updated_at,
      synced_at: after.captured_at, run_id: runId, partial, notify_enabled: notifyEnabled, after_rate: rate,
    });
    if (!result.accepted) continue;
    if (!result.impact) throw new Error('Migration de la référence quotidienne requise.');
    if (!notifyEnabled || !result.should_notify || !hasDailyReference(result.impact)) continue;
    const daily = result.impact;
    for (const subscription of result.subscriptions) {
      if (!isAllowedPushEndpoint(subscription.endpoint)) { failures++; continue; }
      try {
        await send(subscription, JSON.stringify({ body: notificationBody(daily.before_rate, daily.after_rate, daily.partial, daily.reference_changed) }), {
          TTL: 3600, timeout: 15_000, urgency: 'normal',
        });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await rpc('expire', { id: subscription.id });
        else failures++;
      }
    }
  }
  if (failures) throw new Error(`${failures} notification(s) non envoyée(s). Aucun détail privé journalisé.`);
}
