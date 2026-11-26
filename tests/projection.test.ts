import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSimulationInputs, parseScenarios, projectScenario, scenarioErrors, type Scenario } from '../src/lib/projection';

const base = (): Scenario => ({
  id: 'a', name: 'Test', capital: 10000, monthly: 0, redirect: 0,
  lines: [{ id: 'one', name: 'Placement', allocation: 100, growth: 0, income: 0, reinvest: false, investmentWeight: 100 }],
});
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < .00001, `${a} ≠ ${b}`);
test('rendement annuel effectif et horizons', () => {
  const s = base(); s.lines[0].growth = 5;
  const points = projectScenario(s);
  assert.equal(points.length, 21);
  near(points[20].total, 10000 * 1.05 ** 20);
});
test('revenus SCPI non réinvestis consommés et exclus du patrimoine', () => {
  const s = base(); s.lines[0].income = 6;
  const end = projectScenario(s)[20];
  near(end.invested, 10000); near(end.consumed, 12000); near(end.total, 10000);
  near(end.gains, 0);
  near(end.contributions, 10000); near(end.annualIncome, 600);
});
test('revenus réinvestis mensuellement', () => {
  const s = base(); s.lines[0].income = 6; s.lines[0].reinvest = true;
  const end = projectScenario(s)[20];
  near(end.consumed, 0); near(end.total, 10000 * 1.005 ** 240);
});
test('rediriger les revenus vers les ETF ne crée pas un apport personnel', () => {
  const s = base(); s.redirect = 50; s.monthly = 100;
  s.lines[0].income = 6; s.lines[0].investmentWeight = 0;
  s.lines.push({ ...s.lines[0], id: 'etf', name: 'ETF', allocation: 0, income: 0, investmentWeight: 100 });
  const end = projectScenario(s, 1)[1];
  near(end.balances[0], 10000); near(end.balances[1], 1500);
  near(end.consumed, 300); near(end.contributions, 11200);
  near(end.redirected, 300); near(end.gains, 300); near(end.total, 11500);
});
test('versements en fin de mois, taux nul et perte totale', () => {
  const s = base(); s.monthly = 100;
  near(projectScenario(s, 1)[1].total, 11200);
  s.monthly = 0; s.lines[0].growth = -100;
  near(projectScenario(s, 1)[1].total, 0);
  s.lines[0].growth = -10;
  near(projectScenario(s, 1)[1].total, 9000);
});
test('allocations et valeurs invalides rejetées', () => {
  const s = base(); s.lines[0].allocation = 90;
  assert.ok(scenarioErrors(s).length); assert.throws(() => projectScenario(s));
  s.lines[0].allocation = 100; s.lines[0].growth = NaN;
  assert.throws(() => projectScenario(s));
  assert.equal(parseScenarios('garbage'), null);
  assert.equal(parseScenarios('[null]'), null);
  assert.equal(parseScenarios(JSON.stringify([base()] ))?.length, 1);
  assert.equal(parseScenarios(JSON.stringify([base(), base()])), null);
});
test('les arrondis des allocations ne créent ni ne détruisent de capital', () => {
  const s = base(); s.lines[0].allocation = 99.99; s.lines[0].investmentWeight = 99.99; s.monthly = 100;
  const end = projectScenario(s, 1)[1];
  near(end.total, 11200); near(end.gains, 0);
});
test('réinvestissement local prioritaire sur la redirection, calcul sans mutation', () => {
  const s = base(); s.lines[0].income = 6; s.lines[0].reinvest = true; s.redirect = 100;
  const original = structuredClone(s);
  const end = projectScenario(s, 1)[1];
  near(end.distributions, 0); near(end.redirected, 0); near(end.consumed, 0);
  assert.deepEqual(s, original);
});
test('rediriger 100 % des revenus ne laisse aucun revenu consommé', () => {
  const s = base(); s.lines[0].income = 7.77; s.redirect = 100;
  for (const point of projectScenario(s, 20)) assert.equal(point.consumed, 0);
});
test('normalisation des entrées monétaires en euros entiers, sans modifier les données sources', () => {
  const s = { ...base(), capital: 10000.49, monthly: 100.5, redirect: 33.333333 };
  const normalized = normalizeSimulationInputs(s);
  assert.equal(normalized.capital, 10000);
  assert.equal(normalized.monthly, 101);
  assert.equal(normalized.redirect, 33.33);
  assert.equal(s.capital, 10000.49);
  const projected = projectScenario({ ...s, lines: [{ ...s.lines[0], growth: 0 }] }, 1)[1];
  assert.equal(projected.total, 11212);
  assert.equal(projected.contributions, 11212);
});
