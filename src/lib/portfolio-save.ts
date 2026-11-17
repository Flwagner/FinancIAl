import { normalizeGoals, validatePortfolio, type Portfolio, type Reading } from './portfolio';

// JSONB peut réordonner les clés entre deux lectures sans changer les données.
export function readingsFingerprint(readings: Reading[]) {
  return JSON.stringify(readings, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
}

export function portfolioSaveValues(portfolio: Portfolio, previous?: Portfolio, now = new Date().toISOString()) {
  const { updatedAt: _, ...data } = { ...portfolio, goals: normalizeGoals(portfolio.goals) };
  validatePortfolio(data);
  // Omettre la colonne conserve sa valeur en base lors d'une modification des objectifs.
  const readingsChanged = !previous || JSON.stringify(previous.readings) !== JSON.stringify(data.readings)
    || JSON.stringify(previous.monthlySnapshots) !== JSON.stringify(data.monthlySnapshots);
  return { data, ...(readingsChanged ? { updated_at: now } : {}) };
}
