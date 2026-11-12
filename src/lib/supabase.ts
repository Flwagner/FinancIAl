import { createClient } from '@supabase/supabase-js';
import { defaultGoals, validatePortfolio, type Portfolio } from './portfolio';
import type { MarketData } from './market';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export async function loadPortfolio(): Promise<Portfolio | null> {
  if (!supabase) throw new Error('Supabase non configuré.');
  const { data, error } = await supabase.from('portfolios').select('data').maybeSingle();
  if (error) throw error;
  return data?.data ? data.data as Portfolio : null;
}
export async function savePortfolio(data: Portfolio) {
  if (!supabase) throw new Error('Supabase non configuré.');
  validatePortfolio(data);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Connexion requise.');
  const { error } = await supabase.from('portfolios').upsert({ user_id: user.id, data, updated_at: new Date().toISOString() });
  if (error) throw error;
}
export const emptyPortfolio: Portfolio = { readings: [], goals: defaultGoals };

export async function loadMarketData(): Promise<MarketData> {
  if (!supabase) return { returns: [], statuses: [] };
  const [returns, statuses] = await Promise.all([
    supabase.from('market_returns').select('*'),
    supabase.from('market_sync_status').select('*'),
  ]);
  if (returns.error || statuses.error) return { returns: [], statuses: [], error: 'Données de marché indisponibles. Vérifie la migration SQL et la synchronisation ; les taux des relevés sont conservés.' };
  return { returns: returns.data || [], statuses: statuses.data || [] };
}
