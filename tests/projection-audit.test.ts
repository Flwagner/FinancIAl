import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectScenario, type Scenario } from '../src/lib/projection';
import { projectGroupedScenario } from '../src/lib/simulation-groups';
import { referenceProjection, type OraclePlan } from './helpers/projection-oracle';

const defaults = { positions: [], categories: [], warnings: [] };
const scenario = (plan: OraclePlan): Scenario => ({
  id: 'audit', name: 'Audit', capital: plan.capital, monthly: plan.monthly, redirect: plan.redirect,
  lines: plan.pockets.map((p, i) => ({ ...p, id: `${i}`, sourceCategory: p.name })),
});
const near = (actual: number, expected: number, description = '') =>
  assert.ok(Math.abs(actual - expected) < .00001, `${description} : ${actual} ≠ ${expected}`);
const onePocket = (growth: number, income = 0, reinvest = true): OraclePlan => ({
  capital: 10000, monthly: 0, redirect: 0,
  pockets: [{ name: 'Actions', allocation: 100, investmentWeight: 100, growth, income, reinvest }],
});

test('oracle indépendant vérifié par les formules fermées : capital composé et épargne en fin de mois', () => {
  const plan = onePocket(7.5); plan.monthly = 200;
  const monthly = 1.075 ** (1 / 12) - 1;
  for (const years of [1, 5, 10, 15, 20, 30]) {
    const expected = 10000 * 1.075 ** years + 200 * ((1 + monthly) ** (years * 12) - 1) / monthly;
    near(referenceProjection(plan, years).total, expected);
  }
  const zero = onePocket(0); zero.monthly = 200;
  near(referenceProjection(zero, 20).total, 58000);
});
test('oracle indépendant vérifié pour les revenus encaissés ou capitalisés', () => {
  const paid = onePocket(0, 6, false);
  near(referenceProjection(paid, 20).invested, 10000);
  near(referenceProjection(paid, 20).consumed, 12000);
  near(referenceProjection(paid, 20).total, 10000);
  const reinvested = onePocket(0, 6, true);
  near(referenceProjection(reinvested, 20).total, 10000 * 1.005 ** 240);
});
test('audit matriciel : 864 configurations, 4 320 échéances et tous les indicateurs financiers', () => {
  let configurations = 0, checks = 0, maxError = 0;
  const destinations = [[0, 100, 0], [100, 0, 0], [30, 60, 10], [0, 0, 100]];
  for (const growth of [-5, 0, 7.25]) for (const income of [0, 4.25, 8.5])
    for (const redirect of [0, 25, 50, 100]) for (const monthly of [0, 100, 750])
      for (const weights of destinations) for (const reinvest of [false, true]) {
        const plan: OraclePlan = { capital: 125000, monthly, redirect, pockets: [
          { name: 'SCPI', allocation: 50, investmentWeight: weights[0], growth: 0, income, reinvest },
          { name: 'Actions', allocation: 40, investmentWeight: weights[1], growth, income: 0, reinvest: true },
          { name: 'Livret A', allocation: 10, investmentWeight: weights[2], growth: 1.7, income: 0, reinvest: true },
        ] };
        const input = scenario(plan), copy = structuredClone(input);
        const actual = projectScenario(input, 30), grouped = projectGroupedScenario(input, 30, defaults);
        for (const years of [1, 5, 10, 20, 30]) {
          const expected = referenceProjection(plan, years);
          for (const points of [actual, grouped]) {
            for (const key of ['invested', 'consumed', 'total', 'contributions', 'gains', 'annualIncome', 'distributions', 'redirected'] as const) {
              const error = Math.abs(points[years][key] - expected[key]);
              maxError = Math.max(maxError, error);
              assert.ok(error < .00001, `Configuration ${configurations}, ${years} ans, ${key} : écart ${error} €`);
            }
            expected.balances.forEach((value, i) => near(points[years].balances[i], value, `Poche ${i}`));
            near(points[years].total, points[years].invested);
            near(points[years].consumed + points[years].redirected, points[years].distributions);
            near(points[years].gains, points[years].total - points[years].contributions);
            if (redirect === 100) assert.equal(points[years].consumed, 0);
          }
          checks++;
        }
        assert.deepEqual(input, copy);
        configurations++;
      }
  assert.equal(configurations, 864); assert.equal(checks, 4320);
  console.log(`Oracle indépendant : ${configurations} configurations, ${checks} échéances ; écart maximal ${maxError.toExponential(3)} €.`);
});
test('un capital nul, une perte de 100 % et des répartitions arrondies ne créent pas d’argent', () => {
  const zero = onePocket(0); zero.capital = 0; zero.monthly = 300;
  near(projectGroupedScenario(scenario(zero), 20, defaults)[20].total, referenceProjection(zero, 20).total);
  const loss = onePocket(-100);
  near(projectGroupedScenario(scenario(loss), 20, defaults)[20].total, 0);
  const rounded = onePocket(0); rounded.pockets[0].allocation = 99.99; rounded.pockets[0].investmentWeight = 99.99;
  near(projectGroupedScenario(scenario(rounded), 20, defaults)[20].total, referenceProjection(rounded, 20).total);
});
test('réinvestissement SCPI sur place et redirection intégrale vers cette même poche sont équivalents', () => {
  const local = onePocket(0, 6, true);
  const redirected = onePocket(0, 6, false); redirected.redirect = 100;
  for (const years of [1, 5, 10, 15, 20, 30]) {
    const a = projectGroupedScenario(scenario(local), years, defaults).at(-1)!;
    const b = projectGroupedScenario(scenario(redirected), years, defaults).at(-1)!;
    near(a.total, b.total);
    near(a.contributions, b.contributions);
  }
});
test('capital et épargne fractionnaires sont calculés à l’euro affiché, y compris pour les anciens scénarios', () => {
  const plan = onePocket(7.5, 6, false); plan.monthly = 200; plan.redirect = 50;
  const input = { ...scenario(plan), capital: 10000.49, monthly: 200.49, redirect: 50.004 };
  const original = structuredClone(input);
  for (const years of [1, 5, 10, 15, 20, 30]) {
    const expected = referenceProjection(plan, years);
    const actual = projectGroupedScenario(input, years, defaults).at(-1)!;
    near(actual.total, expected.total);
    near(actual.consumed, expected.consumed);
    near(actual.contributions, expected.contributions);
  }
  assert.deepEqual(input, original);
});
