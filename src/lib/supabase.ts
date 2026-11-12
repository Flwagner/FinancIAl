import { createClient } from '@supabase/supabase-js';
import { defaultGoals, normalizeGoals, validatePortfolio, type Portfolio } from './portfolio';
import type { MarketData } from './market';
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
export async function savePortfolio(data: Portfolio) {
  if (!supabase) throw new Error('Supabase non configuré.');
  data = { ...data, goals: normalizeGoals(data.goals) };
  validatePortfolio(data);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) throw new Error('Connexion requise.');
  // La date de fraîcheur vient de la ligne en BDD, pas du document financier.
  const { updatedAt: _, ...document } = data;
  const { data: saved, error } = await supabase.from('portfolios').upsert({ user_id: user.id, data: document, updated_at: new Date().toISOString() }).select('updated_at').single();
  if (error) throw error;
  return saved.updated_at as string;
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
