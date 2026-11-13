import { createClient } from '@supabase/supabase-js';
import { defaultGoals, normalizeGoals, type Portfolio } from './portfolio';
import { portfolioSaveValues } from './portfolio-save';
import type { MarketData } from './market';
import type { SyncImpact } from './sync-impact';
import type { History } from './stock-simulation';
import type { MarketPrice } from './market';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export async function loadPortfolio(): Promise<Portfolio | null> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { data, error } = await supabase.from('portfolios').select('data, updated_at').maybeSingle();
  if (error) throw error;
  if (!data?.data) return null;
  const portfolio = data.data as Portfolio;
  return { ...portfolio, goals: normalizeGoals(portfolio.goals), updatedAt: data.updated_at };
}
export async function savePortfolio(data: Portfolio, previous?: Portfolio) {
  if (!supabase) throw new Error('Supabase non configuré.');
  const values = portfolioSaveValues(data, previous);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Connexion requise.');
  const { data: saved, error } = await supabase.from('portfolios').upsert({ user_id: user.id, ...values }).select('updated_at').single();
  if (error) throw error;
  return saved.updated_at as string;
}
export const emptyPortfolio: Portfolio = { readings: [], goals: defaultGoals };

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
    supabase.from('portfolio_sync_impact').select('before_rate, after_rate, synced_at, portfolio_updated_at, partial, reference_at, reference_changed').maybeSingle(),
  ]);
  if (returns.error || statuses.error) return { returns: [], statuses: [], error: 'Données de marché indisponibles. Vérifie la migration SQL et la synchronisation ; les taux des relevés sont conservés.' };
  // Older deployments without the optional push migration still show market rates.
  return { returns: returns.data || [], statuses: statuses.data || [], impact: impact.error ? null : impact.data as SyncImpact | null };
}
