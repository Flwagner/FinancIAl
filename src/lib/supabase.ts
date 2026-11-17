import { createClient } from '@supabase/supabase-js';
import { defaultGoals, normalizeGoals, type Portfolio } from './portfolio';
import { portfolioSaveValues } from './portfolio-save';
import type { MarketData } from './market';
import type { SyncImpact } from './sync-impact';
import type { History } from './stock-simulation';
import type { MarketPrice } from './market';
import { isLegacyManualSyncError, type MarketSyncResult } from './manual-market-sync';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
// Conserver la forme JSON réellement lue pour le CAS : normalizeGoals peut
// corriger en mémoire un ancien monthly sans que la base ait été modifiée.
const loadedDocuments = new WeakMap<Portfolio, unknown>();
export async function loadPortfolio(): Promise<Portfolio | null> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { data, error } = await supabase.from('portfolios').select('data, updated_at').maybeSingle();
  if (error) throw error;
  if (!data?.data) return null;
  const portfolio = data.data as Portfolio;
  const result = { ...portfolio, goals: normalizeGoals(portfolio.goals), updatedAt: data.updated_at };
  loadedDocuments.set(result, data.data);
  return result;
}
export async function savePortfolio(data: Portfolio, previous?: Portfolio) {
  if (!supabase) throw new Error('Supabase non configuré.');
  const values = portfolioSaveValues(data, previous);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Connexion requise.');
  // Jamais de repli vers un upsert aveugle : le document a pu être synchronisé
  // depuis une autre fenêtre ou l'extension pendant une saisie.
  const expected = previous?.updatedAt ? loadedDocuments.get(previous) ?? portfolioSaveValues(previous).data : null;
  const { data: saved, error } = await supabase.rpc('save_portfolio_checked', { next_data: values.data, expected_data: expected });
  if (error) throw error;
  return saved as string;
}
export const emptyPortfolio: Portfolio = { readings: [], goals: defaultGoals };

export async function syncMarketReturns(): Promise<MarketSyncResult> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { data, error } = await supabase.functions.invoke('sync-market', { body: {}, timeout: 90_000 });
  if (error) {
    const response = error.context;
    if (response instanceof Response && response.status === 429) throw new Error('Une synchronisation vient déjà d’être lancée. Patiente deux minutes avant de réessayer.');
    if (response instanceof Response && [401, 403].includes(response.status)) throw new Error('Session expirée ou accès refusé. Reconnecte-toi pour synchroniser les rendements.');
    throw new Error('Synchronisation impossible. Réessaie plus tard ; les dernières valeurs valides sont conservées.');
  }
  if (!data || !Number.isInteger(data.succeeded) || !Number.isInteger(data.failed) || !Number.isInteger(data.total)
    || data.succeeded < 0 || data.failed < 0 || data.total < 1 || data.succeeded + data.failed !== data.total) throw new Error('Réponse de synchronisation invalide. Recharge la page pour vérifier les rendements.');
  if (data.reason !== undefined && !['rate_limited', 'source_unavailable', 'publication_failed'].includes(data.reason)) throw new Error('Réponse de synchronisation invalide.');
  return data;
}

// Pagination par instrument : ne pas tronquer silencieusement au plafond REST.
export async function loadPriceHistory(symbols: string[], signal?: AbortSignal): Promise<History> {
  const client = supabase;
  if (!client) throw new Error('Supabase non configuré.');
  const entries = await Promise.all([...new Set(symbols)].map(async symbol => {
    const prices: MarketPrice[] = [];
    for (let offset = 0; ; offset += 500) {
      const query = client.from('market_prices').select('date, close, adjusted_close').eq('symbol', symbol).order('date').range(offset, offset + 499);
      const { data, error } = await (signal ? query.abortSignal(signal) : query);
      if (error) throw error;
      prices.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    return [symbol, prices] as const;
  }));
  return Object.fromEntries(entries);
}

export async function loadMarketData(): Promise<MarketData> {
  if (!supabase) return { returns: [], statuses: [] };
  const [returns, statuses, impact] = await Promise.all([
    supabase.from('market_returns').select('*'),
    supabase.from('market_sync_status').select('*'),
    supabase.from('portfolio_sync_impact').select('before_rate, after_rate, synced_at, portfolio_updated_at, partial, reference_at, reference_changed, reference_market').maybeSingle(),
  ]);
  if (returns.error || statuses.error) return { returns: [], statuses: [], error: 'Données de marché indisponibles. Vérifie la migration SQL et la synchronisation ; les taux des relevés sont conservés.' };
  // Older deployments without the optional push migration still show market rates.
  return { returns: returns.data || [], statuses: (statuses.data || []).map(status => ({ ...status, error: isLegacyManualSyncError(status.error) ? null : status.error })), impact: impact.error ? null : impact.data as SyncImpact | null };
}
