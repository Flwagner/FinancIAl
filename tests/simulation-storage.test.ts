import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSimulationDraft, resolveSimulationDraft, simulationFingerprint } from '../src/lib/simulation-storage';
import type { Scenario } from '../src/lib/projection';

const scenario = (name = 'Portefeuille'): Scenario => ({
  id: 's', name, capital: 10000, monthly: 100, redirect: 50,
  lines: [{ id: 'line', name: 'Actions', allocation: 100, investmentWeight: 100, growth: 7, income: 0, reinvest: true }],
});
test('sans stockage local, un autre appareil charge les scénarios et l’horizon en base', () => {
  const cloud = [scenario()];
  const result = resolveSimulationDraft(cloud, null, null, 30);
  assert.deepEqual(result.workspace, { scenarios: cloud, horizon: 30 });
  assert.equal(result.recovery, null);
});
test('migration des simulations locales existantes sans écriture en base', () => {
  const legacy = [scenario()];
  const result = resolveSimulationDraft(null, null, legacy);
  assert.deepEqual(result.workspace, { scenarios: legacy, horizon: 20 });
  assert.equal(result.recovery, null);
  assert.deepEqual(parseSimulationDraft(JSON.stringify({ scenarios: legacy, base: null })), { scenarios: legacy, base: null, horizon: 20 });
});
test('un brouillon non enregistré et son horizon sont conservés si la base n’a pas changé', () => {
  const cloud = [scenario()];
  const local = [scenario('Mon brouillon')];
  const draft = { scenarios: local, horizon: 15, base: simulationFingerprint(cloud) };
  assert.deepEqual(resolveSimulationDraft(cloud, draft, null).workspace, { scenarios: local, horizon: 15 });
  assert.deepEqual(parseSimulationDraft(JSON.stringify(draft)), draft);
});
test('une sauvegarde plus récente d’un autre appareil prime, sans perdre le brouillon local', () => {
  const old = [scenario('Ancien')], cloud = [scenario('Nouveau sur téléphone')], local = [scenario('Brouillon ordinateur')];
  const draft = { scenarios: local, horizon: 10, base: simulationFingerprint(old) };
  const result = resolveSimulationDraft(cloud, draft, null, 30);
  assert.deepEqual(result.workspace, { scenarios: cloud, horizon: 30 });
  assert.deepEqual(result.recovery, { scenarios: local, horizon: 10 });
});
test('un ancien cache déjà enregistré ne déclenche pas de faux brouillon à restaurer', () => {
  const old = [scenario('Ancien')], cloud = [scenario('Nouveau')];
  const draft = { scenarios: old, horizon: 20, base: simulationFingerprint(old) };
  assert.equal(resolveSimulationDraft(cloud, draft, null).recovery, null);
});
test('empreinte stable malgré l’ordre des clés JSONB, sensible aux scénarios et à l’horizon', () => {
  const value = [scenario()];
  const reordered = JSON.parse(JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).reverse()) : v));
  assert.equal(simulationFingerprint(value), simulationFingerprint(reordered));
  assert.notEqual(simulationFingerprint(value, 20), simulationFingerprint(value, 30));
  assert.notEqual(simulationFingerprint(value), simulationFingerprint([scenario('Autre')]));
});
test('stockage corrompu, scénarios invalides et horizons impossibles ignorés', () => {
  for (const raw of [null, '', 'bad', 'null', '{}', '{"scenarios":[],"base":null,"horizon":20}',
    JSON.stringify({ scenarios: [scenario()], base: 42, horizon: 20 }),
    JSON.stringify({ scenarios: [scenario()], base: null, horizon: 31 })]) {
    assert.equal(parseSimulationDraft(raw), null);
  }
});
