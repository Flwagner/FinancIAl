import { normalizeGoals, validatePortfolio, type Portfolio } from './portfolio';

export function portfolioSaveValues(portfolio: Portfolio, previous?: Portfolio, now = new Date().toISOString()) {
  const { updatedAt: _, ...data } = { ...portfolio, goals: normalizeGoals(portfolio.goals) };
  validatePortfolio(data);
  // Omettre la colonne conserve sa valeur en base lors d'une modification des objectifs.
  const readingsChanged = !previous || JSON.stringify(previous.readings) !== JSON.stringify(data.readings);
  return { data, ...(readingsChanged ? { updated_at: now } : {}) };
}
