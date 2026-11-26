import { projectScenario, scenarioErrors, type Scenario, type SimulationLine } from './projection';
import type { simulationDefaults } from './simulation-defaults';
import { currentAllocationTarget } from './portfolio';

export type SimulationGroup = {
  id: string; name: string; grouped: boolean; members: SimulationLine[];
  allocation: number; investmentWeight: number; growth: number; income: number;
  reinvest: boolean; mixedReinvestment: boolean;
};
type Defaults = ReturnType<typeof simulationDefaults>;
function displayGroup(line: SimulationLine, defaults: Defaults): string | undefined {
  if (line.displayGroup === 'ETF Monde') return 'Actions'; // Anciennes simulations.
  if (typeof line.displayGroup === 'string' && line.displayGroup.trim()) return line.displayGroup;
  if (typeof line.sourceCategory === 'string' && line.sourceCategory.trim()) return line.sourceCategory;
  const matches = defaults.positions.filter(p => line.sourcePositionId ? p.sourcePositionId === line.sourcePositionId : p.name === line.name);
  if (matches.length === 1) return matches[0].displayGroup;
  if (!line.sourcePositionId && line.name === 'ETF Monde') return 'Actions';
  if (!line.sourcePositionId && ['SCPI', 'Actions'].includes(line.name)) return line.name;
}
// La même liste de poches alimente les champs et le moteur de projection.
export function simulationGroups(lines: SimulationLine[], defaults: Defaults): SimulationGroup[] {
  const groups = new Map<string, { name: string; grouped: boolean; members: SimulationLine[] }>();
  for (const line of lines) {
    const name = displayGroup(line, defaults);
    const key = name ? `group:${name}` : `line:${line.id}`;
    const current = groups.get(key);
    if (current) current.members.push(line);
    else groups.set(key, { name: name ?? line.name, grouped: !!name, members: [line] });
  }
  const priority = (name: string) => name === 'SCPI' ? 0 : name === 'Actions' ? 1 : 2;
  const grouped = [...groups.entries()].sort(([, a], [, b]) => priority(a.name) - priority(b.name)).map(([id, group]) => {
    const allocation = group.members.reduce((sum, l) => sum + l.allocation, 0);
    const investmentWeight = group.members.reduce((sum, l) => sum + l.investmentWeight, 0);
    const weighted = (field: 'growth' | 'income') => group.members.reduce((sum, l) =>
      sum + l[field] * (allocation ? l.allocation / allocation : investmentWeight ? l.investmentWeight / investmentWeight : 1 / group.members.length), 0);
    return { ...group, id, allocation, investmentWeight, growth: Number(weighted('growth').toFixed(2)), income: Number(weighted('income').toFixed(2)),
      reinvest: group.members.every(l => l.reinvest), mixedReinvestment: group.members.some(l => l.reinvest) && group.members.some(l => !l.reinvest) };
  });
  // Répartir les centièmes résiduels garantit des pourcentages visibles totalisant
  // 100 %, au lieu de calculer avec des fractions cachées derrière les champs.
  for (const field of ['allocation', 'investmentWeight'] as const) {
    const total = grouped.reduce((sum, group) => sum + group[field], 0);
    if (Math.abs(total - 100) <= .011 && grouped.every(group => Number.isFinite(group[field]) && group[field] >= 0)) {
      const rounded = currentAllocationTarget(grouped.map(group => ({ name: group.id, value: group[field] })));
      grouped.forEach(group => { group[field] = rounded[group.id]; });
    } else {
      grouped.forEach(group => { group[field] = Number(group[field].toFixed(2)); });
    }
  }
  return grouped;
}
export function updateSimulationGroup(lines: SimulationLine[], group: SimulationGroup, patch: Partial<SimulationLine>): SimulationLine[] {
  const ids = new Set(group.members.map(l => l.id));
  const memberAllocation = group.members.reduce((sum, line) => sum + line.allocation, 0);
  return lines.map(line => {
    if (!ids.has(line.id)) return line;
    const next = { ...line, ...patch };
    for (const field of ['allocation', 'investmentWeight'] as const) {
      if (patch[field] === undefined) continue;
      const total = group.members.reduce((sum, l) => sum + l[field], 0);
      const ratio = total ? line[field] / total : memberAllocation ? line.allocation / memberAllocation : 1 / group.members.length;
      next[field] = patch[field]! * ratio;
    }
    return next;
  });
}
export function groupedScenarioErrors(scenario: Scenario, defaults: Defaults): string[] {
  const errors = scenarioErrors(scenario);
  if (errors.length) return errors;
  return simulationGroups(scenario.lines, defaults).filter(group => group.mixedReinvestment)
    .map(group => `Choisis un réinvestissement global pour la poche « ${group.name} » : les anciennes lignes ont des choix différents.`);
}
export function projectGroupedScenario(scenario: Scenario, years: number, defaults: Defaults) {
  const errors = groupedScenarioErrors(scenario, defaults);
  if (errors.length) throw new Error(errors.join(' '));
  const groups = simulationGroups(scenario.lines, defaults);
  return projectScenario({
    ...scenario,
    lines: groups.map(group => ({
      id: group.id, name: group.name,
      // La légère tolérance des sommes de saisie est normalisée par le moteur.
      allocation: Math.min(100, group.allocation),
      investmentWeight: Math.min(100, group.investmentWeight),
      growth: Number(group.growth.toFixed(2)), income: Number(group.income.toFixed(2)),
      reinvest: group.reinvest,
    })),
  }, years);
}
