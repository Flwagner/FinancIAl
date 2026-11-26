import { livePositions, type MarketData } from './market';
import { currentSnapshot, type Portfolio } from './portfolio';
import type { SimulationLine } from './projection';

export type SimulationDefault = Pick<SimulationLine, 'name' | 'growth' | 'income' | 'reinvest' | 'sourcePositionId' | 'sourceCategory'> & {
  amount: number;
  displayGroup?: string;
};
// Les cours ajustés incluent déjà les distributions : ne pas les ajouter
// une deuxième fois. Seules les poches de revenus identifiées sont séparées.
function rates(category: string, rate: number) {
  return category === 'SCPI' || category === 'Bricks'
    ? { growth: 0, income: Math.max(0, rate), reinvest: false }
    : { growth: rate, income: 0, reinvest: true };
}
export function simulationDefaults(data: Portfolio, market: MarketData) {
  const live = livePositions(currentSnapshot(data), market);
  const positions: SimulationDefault[] = live.positions.map(p => ({
    name: `${p.name}${p.envelope ? ` · ${p.envelope}` : ''}`, amount: p.amount,
    sourcePositionId: p.id,
    displayGroup: p.category,
    ...rates(p.category, live.categoryRates[p.category] ?? p.rate),
  }));
  const categories = [...new Set([...live.positions.map(p => p.category), ...Object.keys(data.allocationTarget ?? {})])].map(category => {
    const held = live.positions.filter(p => p.category === category);
    const amount = held.reduce((sum, p) => sum + p.amount, 0);
    const rate = live.categoryRates[category] ?? (amount ? held.reduce((sum, p) => sum + p.amount * p.rate, 0) / amount : 0);
    return { name: category, amount, sourceCategory: category, ...rates(category, rate) };
  });
  return { positions, categories, warnings: live.warnings };
}
// L’action est explicite : les simulations enregistrées restent indépendantes
// du marché. Les allocations, versements et choix de réinvestissement sont conservés.
export function refreshSimulationRates(lines: SimulationLine[], defaults: ReturnType<typeof simulationDefaults>) {
  let updated = 0;
  const next = lines.map(line => {
    let matches: SimulationDefault[];
    if (line.sourcePositionId) matches = defaults.positions.filter(p => p.sourcePositionId === line.sourcePositionId);
    else if (line.sourceCategory) matches = defaults.categories.filter(p => p.sourceCategory === line.sourceCategory);
    else matches = [...defaults.positions, ...defaults.categories].filter(p => p.name === line.name);
    if (matches.length !== 1) return line;
    updated++;
    const source = matches[0];
    return { ...line, growth: source.growth, income: source.income,
      sourcePositionId: source.sourcePositionId, sourceCategory: source.sourceCategory };
  });
  return { lines: next, updated };
}
