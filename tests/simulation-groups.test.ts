import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulationDefaults } from '../src/lib/simulation-defaults';
import { groupedScenarioErrors, projectGroupedScenario, simulationGroups, updateSimulationGroup } from '../src/lib/simulation-groups';
import { projectScenario, type Scenario, type SimulationLine } from '../src/lib/projection';
import type { Portfolio, Position } from '../src/lib/portfolio';

function setup() {
  const position = (id: string, name: string, category: string, code: string, amount: number, rate: number): Position =>
    ({ id, name, category, code, amount, rate, envelope: category === 'Actions' ? 'PEA' : 'Direct' });
  const data: Portfolio = { goals: { capital: 250000, annual: 36000, monthly: 3000 }, readings: [{
    id: 'r', date: '2026-11-26', projected: false, total: 10000, positions: [
      position('a', 'SCPI A', 'SCPI', '', 1000, 4), position('b', 'SCPI B', 'SCPI', '', 3000, 8),
      position('w', 'ETF renommé', 'Actions', 'IE0002XZSHO1', 1000, 10),
      position('d', 'DCAM', 'Actions', 'FR001400U5Q4', 3000, 14),
      position('e', 'ETF Europe', 'Actions', 'FR0013412038', 2000, 12),
    ],
  }] };
  const defaults = simulationDefaults(data, { returns: [], statuses: [] });
  const lines: SimulationLine[] = defaults.positions.map((p, i) => ({
    ...p, id: `line-${i}`, allocation: p.amount / 100, investmentWeight: p.amount / 100,
  }));
  return { defaults, lines };
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
test('une ligne SCPI et une ligne Actions globale, taux et allocations pondérés', () => {
  const { defaults, lines } = setup();
  const original = structuredClone(lines);
  const groups = simulationGroups(lines, defaults);
  assert.deepEqual(groups.map(g => g.name), ['SCPI', 'Actions']);
  assert.equal(groups[0].members.length, 2); assert.equal(groups[1].members.length, 3);
  near(groups[0].income, 7); near(groups[1].growth, 12.67);
  near(groups[0].allocation, 40); near(groups[1].investmentWeight, 60);
  assert.deepEqual(lines, original);
  const scenario = { id: 's', name: 'Test', capital: 10000, monthly: 100, redirect: 50, lines };
  const before = projectScenario(scenario);
  simulationGroups(lines, defaults);
  assert.deepEqual(projectScenario(scenario), before);
});
test('Actions réunit PEA, CTO, PEE et les anciens groupes ETF Monde, sans les autres actifs du CTO', () => {
  const { defaults, lines } = setup();
  const legacy = lines.map(l => ({ ...l }));
  legacy[2].displayGroup = 'ETF Monde';
  const cto = { ...legacy[3], id: 'cto', name: 'Actions CTO', sourcePositionId: 'cto', displayGroup: 'Actions' as const };
  const pee = { ...legacy[4], id: 'pee', name: 'Actions PEE', sourcePositionId: 'pee', displayGroup: 'Actions' as const };
  const gold = { ...legacy[4], id: 'gold', name: 'Or · CTO', sourcePositionId: 'gold', displayGroup: undefined };
  const groups = simulationGroups([...legacy, cto, pee, gold], defaults);
  assert.deepEqual(groups.map(g => g.name), ['SCPI', 'Actions', 'Or · CTO']);
  assert.equal(groups[1].members.length, 5);
  const changed = updateSimulationGroup([...legacy, cto, pee, gold], groups[1], { growth: 7 });
  assert.ok(changed.filter(l => groups[1].members.some(m => m.id === l.id)).every(l => l.growth === 7));
  assert.equal(changed.at(-1)?.growth, gold.growth);
  assert.equal(simulationGroups([{ ...lines[2], displayGroup: undefined, sourcePositionId: undefined, sourceCategory: 'Actions', name: 'Allocation actions cible' }], defaults)[0].name, 'Actions');
});
test('allocation globale : les autres classes sont aussi regroupées sans mélange avec les actions', () => {
  const { defaults, lines } = setup();
  const assets: SimulationLine[] = [
    { ...lines[0], id: 'gold-a', name: 'Or A', displayGroup: 'Or', allocation: 10 },
    { ...lines[1], id: 'gold-b', name: 'Or B', displayGroup: 'Or', allocation: 20 },
    { ...lines[2], id: 'bond', name: 'Obligations', displayGroup: 'Obligations', allocation: 70 },
  ];
  const groups = simulationGroups(assets, defaults);
  assert.deepEqual(groups.map(g => g.name), ['Or', 'Obligations']);
  near(groups[0].allocation, 30);
  assert.equal(groups[0].members.length, 2);
});
test('les modifications de groupe se répartissent sans perte, sans toucher aux autres poches', () => {
  const { defaults, lines } = setup();
  const scpi = simulationGroups(lines, defaults)[0];
  const next = updateSimulationGroup(lines, scpi, { allocation: 60, investmentWeight: 20 });
  near(next[0].allocation, 15); near(next[1].allocation, 45);
  near(next[0].investmentWeight, 5); near(next[1].investmentWeight, 15);
  assert.deepEqual(next.slice(2), lines.slice(2));
  const rate = updateSimulationGroup(lines, scpi, { income: 6, reinvest: true });
  assert.equal(rate[0].income, 6); assert.equal(rate[1].income, 6);
  assert.ok(rate[0].reinvest && rate[1].reinvest);
  assert.equal(lines[0].income, 4);
});
test('choix de réinvestissement mixtes préservés et signalés', () => {
  const { defaults, lines } = setup(); lines[0].reinvest = true;
  const scpi = simulationGroups(lines, defaults)[0];
  assert.equal(scpi.mixedReinvestment, true);
  assert.equal(scpi.reinvest, false);
  const updated = simulationGroups(updateSimulationGroup(lines, scpi, { reinvest: false }), defaults)[0];
  assert.equal(updated.mixedReinvestment, false); assert.equal(updated.reinvest, false);
});
test('scénarios anciens rapprochés par identifiant ou nom, cibles et placements disparus', () => {
  const { defaults, lines } = setup();
  const legacy = lines.map(({ displayGroup: _, ...line }) => line);
  legacy[0].name = 'SCPI renommée';
  assert.equal(simulationGroups(legacy, defaults)[0].members.length, 2);
  const byName = legacy.map(({ sourcePositionId: _, ...line }) => line);
  byName[0].name = defaults.positions[0].name;
  assert.equal(simulationGroups(byName, defaults)[0].members.length, 2);
  assert.equal(simulationGroups([{ ...lines[0], displayGroup: undefined, sourcePositionId: undefined, sourceCategory: 'SCPI', name: 'SCPI cible' }], defaults)[0].name, 'SCPI');
  assert.equal(simulationGroups(lines, { ...defaults, positions: [] })[0].members.length, 2);
});
test('poches à zéro : pas de division par zéro ni de perte des nouveaux versements', () => {
  const { defaults, lines } = setup();
  const zero = lines.map(l => ({ ...l, allocation: 0, investmentWeight: 0 }));
  const group = simulationGroups(zero, defaults)[0];
  assert.equal(group.income, 6);
  const next = updateSimulationGroup(zero, group, { allocation: 40, investmentWeight: 60 });
  near(next[0].allocation + next[1].allocation, 40);
  near(next[0].investmentWeight + next[1].investmentWeight, 60);
});
test('régression CGI : seul le taux Actions affiché est composé, jamais un rendement caché à 30 %', () => {
  const { defaults, lines } = setup();
  const scenario: Scenario = { id: 's', name: 'Portefeuille', capital: 10000, monthly: 0, redirect: 0,
    lines: [
      { ...lines[2], allocation: 90, investmentWeight: 90, growth: 10 },
      { ...lines[3], allocation: 10, investmentWeight: 10, growth: 30 },
    ] };
  const original = structuredClone(scenario);
  const projected = projectGroupedScenario(scenario, 20, defaults);
  assert.equal(projected[20].balances.length, 1);
  assert.ok(Math.abs(projected[20].total - 10000 * 1.12 ** 20) < 1e-6);
  assert.ok(projectScenario(scenario, 20)[20].total > projected[20].total);
  assert.deepEqual(scenario, original);
});
test('portefeuille détaillé et scénario global aux mêmes valeurs affichées donnent la même trajectoire', () => {
  const { defaults, lines } = setup();
  const current: Scenario = { id: 'current', name: 'Portefeuille', capital: 10000, monthly: 100, redirect: 100, lines };
  const global: Scenario = { ...current, id: 'global', name: 'Allocation cible',
    lines: [
      { id: 'scpi', name: 'SCPI', sourceCategory: 'SCPI', allocation: 40, investmentWeight: 40, growth: 0, income: 7, reinvest: false },
      { id: 'actions', name: 'Actions', sourceCategory: 'Actions', allocation: 60, investmentWeight: 60, growth: 12.67, income: 0, reinvest: true },
    ] };
  const a = projectGroupedScenario(current, 20, defaults), b = projectGroupedScenario(global, 20, defaults);
  for (let year = 0; year <= 20; year++) {
    assert.ok(Math.abs(a[year].total - b[year].total) < 1e-6);
    assert.ok(Math.abs(a[year].invested - b[year].invested) < 1e-6);
    near(a[year].contributions, b[year].contributions);
  }
});
test('les revenus utilisent eux aussi exactement le taux affiché à deux décimales', () => {
  const { defaults, lines } = setup();
  const scenario: Scenario = { id: 's', name: 'SCPI', capital: 10000, monthly: 0, redirect: 0, lines: [
    { ...lines[0], allocation: 25, investmentWeight: 25, income: 4.12345, reinvest: true },
    { ...lines[1], allocation: 75, investmentWeight: 75, income: 8.98765, reinvest: true },
  ] };
  const end = projectGroupedScenario(scenario, 20, defaults)[20];
  assert.ok(Math.abs(end.total - 10000 * (1 + .0777 / 12) ** 240) < 1e-6);
  assert.ok(Math.abs(end.annualIncome - end.total * .0777) < 1e-6);
});
test('à taux comparables, plus d’actions à meilleur rendement améliore la projection sans apport personnel', () => {
  const { defaults, lines } = setup();
  const current: Scenario = { id: 's', name: 'Portefeuille', capital: 10000, monthly: 0, redirect: 100, lines: [
    { ...lines[0], allocation: 80, investmentWeight: 80, income: 5, reinvest: false },
    { ...lines[2], allocation: 18, investmentWeight: 18, growth: 10 },
    { ...lines[3], allocation: 2, investmentWeight: 2, growth: 30 },
  ] };
  const target: Scenario = { ...current, id: 'target', name: 'Allocation cible', lines: [
    { ...lines[0], allocation: 40, investmentWeight: 40, income: 5, reinvest: false },
    { ...lines[2], allocation: 60, investmentWeight: 60, growth: 12 },
  ] };
  const a = projectGroupedScenario(current, 20, defaults), b = projectGroupedScenario(target, 20, defaults);
  for (let year = 1; year <= 20; year++) {
    assert.ok(b[year].total > a[year].total, `L’allocation cible doit être supérieure à ${year} ans.`);
    near(a[year].contributions, 10000); near(b[year].contributions, 10000);
  }
});
test('un ancien réinvestissement mixte doit être résolu explicitement avant la projection globale', () => {
  const { defaults, lines } = setup(); lines[0].reinvest = true;
  const scenario: Scenario = { id: 's', name: 'Mixte', capital: 10000, monthly: 0, redirect: 0, lines };
  assert.match(groupedScenarioErrors(scenario, defaults)[0], /réinvestissement global.*SCPI/);
  assert.throws(() => projectGroupedScenario(scenario, 20, defaults), /réinvestissement global/);
});
test('allocations et investissements visibles totalisent 100 %, sans décimales cachées', () => {
  const { defaults, lines } = setup();
  [10.99987, 29.98778, 15.12345, 25.87654, 18.01236].forEach((value, i) => { lines[i].allocation = value; });
  [4.12345, 25.54321, 15, 25, 30.33334].forEach((value, i) => { lines[i].investmentWeight = value; });
  const groups = simulationGroups(lines, defaults);
  near(groups.reduce((sum, g) => sum + g.allocation, 0), 100);
  near(groups.reduce((sum, g) => sum + g.investmentWeight, 0), 100);
  for (const g of groups) for (const field of ['allocation', 'investmentWeight', 'growth', 'income'] as const) {
    assert.equal(g[field], Number(g[field].toFixed(2)));
  }
  const s: Scenario = { id: 'rounded', name: 'Arrondis', capital: 10000, monthly: 0, redirect: 100, lines };
  const before = projectGroupedScenario(s, 20, defaults);
  let reentered = lines;
  for (const group of groups) reentered = updateSimulationGroup(reentered, group, { allocation: group.allocation, investmentWeight: group.investmentWeight });
  const after = projectGroupedScenario({ ...s, lines: reentered }, 20, defaults);
  for (let year = 0; year <= 20; year++) assert.ok(Math.abs(before[year].total - after[year].total) < 1e-6);
});
test('modifier une poche sans versement initial conserve exactement le montant demandé malgré les arrondis', () => {
  const { defaults, lines } = setup();
  [10.99987, 29.98778, 15.12345, 25.87654, 18.01236].forEach((value, i) => { lines[i].allocation = value; });
  [0, 0, 30, 30, 40].forEach((value, i) => { lines[i].investmentWeight = value; });
  const group = simulationGroups(lines, defaults)[0];
  const changed = updateSimulationGroup(lines, group, { investmentWeight: 100 });
  near(changed[0].investmentWeight + changed[1].investmentWeight, 100);
});
