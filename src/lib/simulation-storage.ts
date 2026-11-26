import { parseScenarios, type Scenario } from './projection';

export type SimulationWorkspace = { scenarios: Scenario[]; horizon: number };
export type SimulationDraft = SimulationWorkspace & { base: string | null };
// JSONB réordonne les clés : la comparaison ne doit pas créer de faux conflits.
export function simulationFingerprint(scenarios: Scenario[] | null | undefined, horizon = 20): string | null {
  if (!scenarios) return null;
  return JSON.stringify({ scenarios, horizon }, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
}
export function parseSimulationDraft(raw: string | null): SimulationDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || (value.base !== null && typeof value.base !== 'string')) return null;
    const horizon = value.horizon === undefined ? 20 : value.horizon;
    if (!Number.isInteger(horizon) || horizon < 1 || horizon > 30) return null;
    const scenarios = parseScenarios(JSON.stringify(value.scenarios));
    return scenarios ? { scenarios, base: value.base, horizon } : null;
  } catch { return null; }
}
export function resolveSimulationDraft(cloud: Scenario[] | null, draft: SimulationDraft | null, legacy: Scenario[] | null, cloudHorizon = 20) {
  const local: SimulationWorkspace | null = draft ? { scenarios: draft.scenarios, horizon: draft.horizon } : legacy ? { scenarios: legacy, horizon: 20 } : null;
  if (!cloud) return { workspace: local, recovery: null };
  const fingerprint = simulationFingerprint(cloud, cloudHorizon);
  if (draft && draft.base === fingerprint) return { workspace: local, recovery: null };
  const pending = local && (!draft || simulationFingerprint(draft.scenarios, draft.horizon) !== draft.base);
  // Une version d’un autre appareil prime sur un ancien brouillon, sans le jeter.
  return { workspace: { scenarios: cloud, horizon: cloudHorizon },
    recovery: pending && simulationFingerprint(local.scenarios, local.horizon) !== fingerprint ? local : null };
}
