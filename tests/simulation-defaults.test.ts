import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshSimulationRates, simulationDefaults } from '../src/lib/simulation-defaults';
import type { Portfolio, Position } from '../src/lib/portfolio';
import type { MarketData } from '../src/lib/market';
import type { SimulationLine } from '../src/lib/projection';

const position = (patch: Partial<Position>): Position => ({
  id: 'etf', name: 'WPEA', category: 'Actions', envelope: 'PEA', code: 'IE0002XZSHO1', amount: 1000, rate: 4, ...patch,
});
function portfolio(positions: Position[], categoryRates?: Record<string, number>): Portfolio {
  return { readings: [{ id: 'r', date: '2026-11-26', projected: false, total: 2000, positions, categoryRates }],
    goals: { capital: 250000, annual: 36000, monthly: 3000 } };
}
const emptyMarket: MarketData = { returns: [], statuses: [] };
test('les taux du portefeuille séparent performance capitalisée et revenus distribués', () => {
  const data = portfolio([
    position({ rate: 8 }),
    position({ id: 'scpi', name: 'SCPI', category: 'SCPI', envelope: 'Direct', rate: 6 }),
    position({ id: 'bricks', name: 'Bricks', category: 'Bricks', rate: 7 }),
    position({ id: 'or', name: 'Or', category: 'Or', rate: -9 }),
  ]);
  const original = structuredClone(data);
  const defaults = simulationDefaults(data, emptyMarket);
  assert.deepEqual(defaults.positions.map(p => [p.growth, p.income, p.reinvest]), [[8, 0, true], [0, 6, false], [0, 7, false], [-9, 0, true]]);
  assert.deepEqual(data, original);
});
test('priorité marché et repli manuel identiques à la vue d’ensemble', () => {
  const data = portfolio([position({ rateSource: 'market' })], { Actions: 99 });
  const market: MarketData = { returns: [{
    symbol: 'WPEA.PA', currency: 'EUR', rate: 13.42, method: 'adjusted_close_365d',
    as_of: '2026-11-25', fetched_at: '2026-11-26T09:00:00Z', start_date: '2025-11-25', start_price: 100, end_price: 113.42,
  }], statuses: [] };
  assert.equal(simulationDefaults(data, market).positions[0].growth, 13.42);
  assert.equal(simulationDefaults(data, emptyMarket).positions[0].growth, 4);
  assert.ok(simulationDefaults(data, emptyMarket).warnings.length);
});
test('taux de catégorie et pondération des poches de l’allocation cible', () => {
  const data = portfolio([position({ amount: 1000, rate: 8 }), position({ id: 'two', amount: 3000, rate: 12 })]);
  data.allocationTarget = { Actions: 60, SCPI: 40 };
  assert.equal(simulationDefaults(data, emptyMarket).categories.find(p => p.name === 'Actions')?.growth, 11);
  assert.equal(simulationDefaults(data, emptyMarket).categories.find(p => p.name === 'SCPI')?.income, 0);
  data.readings[0].categoryRates = { Actions: 9 };
  assert.equal(simulationDefaults(data, emptyMarket).positions[0].growth, 9);
  assert.equal(simulationDefaults(data, emptyMarket).categories.find(p => p.name === 'Actions')?.growth, 9);
});
test('reprise explicite des taux conserve allocation, versements et réinvestissement', () => {
  const defaults = simulationDefaults(portfolio([position({ rate: 8 })]), emptyMarket);
  const line: SimulationLine = { id: 'line', name: 'Renommée', sourcePositionId: 'etf',
    allocation: 50, investmentWeight: 75, growth: 3, income: 1, reinvest: false };
  const custom = { ...line, id: 'custom', name: 'Libre', sourcePositionId: undefined };
  const original = structuredClone(line);
  const result = refreshSimulationRates([line, custom], defaults);
  assert.equal(result.updated, 1);
  assert.equal(result.lines[0].growth, 8); assert.equal(result.lines[0].income, 0);
  assert.equal(result.lines[0].allocation, 50); assert.equal(result.lines[0].investmentWeight, 75);
  assert.equal(result.lines[0].reinvest, false);
  assert.deepEqual(result.lines[1], custom); assert.deepEqual(line, original);
});
test('anciens scénarios rapprochés par nom, catégorie renommée et ambiguïtés', () => {
  const data = portfolio([position({ rate: 8 })]);
  const defaults = simulationDefaults(data, emptyMarket);
  const line: SimulationLine = { id: 'line', name: 'WPEA · PEA', allocation: 100, investmentWeight: 100, growth: 0, income: 0, reinvest: true };
  assert.equal(refreshSimulationRates([line], defaults).lines[0].growth, 8);
  assert.equal(refreshSimulationRates([{ ...line, name: 'Renommée', sourceCategory: 'Actions' }], defaults).lines[0].growth, 8);
  const ambiguous = simulationDefaults(portfolio([position({}), position({ id: 'two' })]), emptyMarket);
  assert.equal(refreshSimulationRates([line], ambiguous).updated, 0);
});
