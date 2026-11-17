import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBoursoDiscovery, suggestBoursoMappings, type BoursoSource } from '../src/lib/boursosync';
import { buildDiscovery } from '../extension/shared/core.mjs';
import type { Position } from '../src/lib/portfolio';

const source: BoursoSource = { account: 'a'.repeat(64), asset: 'IE0002XZSHO1', envelope: 'PEA', label: 'Libellé bancaire' };
const position: Position = { id: 'wpea-test', code: source.asset, envelope: 'PEA', name: 'Nom différent dans FinancIAl', amount: 0, rate: 0, category: 'Actions' };
test('ISIN + enveloppe : correspondance unique sans utiliser le nom ni fusionner WPEA et DCAM', () => {
  const positions = [position, { ...position, id: 'dcam-test', code: 'FR001400U5Q4' }];
  const sources = [source, { ...source, asset: 'FR001400U5Q4' }];
  const result = suggestBoursoMappings(sources, positions, []);
  assert.deepEqual(result.map(s => s.mapping.positionId), ['wpea-test', 'dcam-test']);
  assert.deepEqual(positions[0], position);
});
test('un même ISIN dans un CTO ne correspond pas à un PEA ; alias de cotation exact reconnu', () => {
  assert.equal(suggestBoursoMappings([source], [{ ...position, envelope: 'CTO' }], [])[0].mapping.positionId, '');
  assert.equal(suggestBoursoMappings([source], [{ ...position, code: 'EPA:WPEA' }], [])[0].mapping.positionId, position.id);
  assert.equal(suggestBoursoMappings([source], [{ ...position, code: ' wpea.pa ', envelope: ' pea ' }], [])[0].mapping.positionId, position.id);
});
test('absence, doublons, solde sans ISIN et enveloppe inconnue : aucun choix inventé', () => {
  for (const [sources, positions] of [
    [[source], []],
    [[source], [position, { ...position, id: 'other' }]],
    [[{ ...source, asset: 'balance' }], [position]],
    [[{ ...source, envelope: '' }], [position]],
  ] as [BoursoSource[], Position[]][]) {
    assert.equal(suggestBoursoMappings(sources, positions, [])[0].mapping.positionId, '');
  }
});
test('ne jamais assimiler un proxy de marché au produit bancaire', () => {
  const bitcoin = { ...source, asset: 'GB00BLD4ZL17', envelope: 'CTO' };
  assert.equal(suggestBoursoMappings([bitcoin], [{ ...position, code: 'BTC-EUR', envelope: 'CTO' }], [])[0].mapping.positionId, '');
});
test('CTO : reconnaît les 3 ISIN indépendamment de leur classe d’actifs, sans changer le portefeuille', () => {
  const identities = [
    ['IE00BDBRDM35', 'BIT:AGGH', 'Obligations'],
    ['FRSGE001BQW9', 'FRSGE001BQW9', 'Or'],
    ['GB00BLD4ZL17', 'EPA:BITC', 'Bitcoin'],
  ];
  const sources = identities.map(([asset]) => ({ ...source, asset, envelope: 'CTO' }));
  const positions = identities.map(([, code, name], i) => ({ ...position, id: `cto-${i}`, name, code, envelope: 'CTO', category: name }));
  const before = JSON.stringify(positions);
  const result = suggestBoursoMappings(sources, positions, []);
  assert.deepEqual(result.map(s => s.mapping.positionId), ['cto-0', 'cto-1', 'cto-2']);
  assert.ok(result.every(s => s.reason.includes('ISIN et enveloppe')));
  assert.equal(JSON.stringify(positions), before);
});
test('CTO : exige la bonne enveloppe, jamais Direct/PEA/assurance-vie ni noms ou proxies', () => {
  const sources = [{ ...source, asset: 'GB00BLD4ZL17', envelope: 'CTO' }];
  const direct = { ...position, code: 'EPA:BITC', envelope: 'Direct' };
  const explicit = { ...direct, id: 'explicit-cto', envelope: 'CTO' };
  assert.equal(suggestBoursoMappings(sources, [direct, explicit], [])[0].mapping.positionId, explicit.id);
  for (const p of [
    direct, { ...direct, envelope: 'PEA' }, { ...direct, envelope: 'Assurance vie' },
    { ...direct, code: 'BTC-EUR', name: 'COINSHARES BITCOIN ETP' },
  ]) assert.equal(suggestBoursoMappings(sources, [p], [])[0].mapping.positionId, '');
  assert.equal(suggestBoursoMappings([{ ...source, envelope: 'PEA' }], [{ ...position, envelope: 'Direct' }], [])[0].mapping.positionId, '');
});
test('CTO : doublons, destination occupée et plusieurs comptes restent bloqués', () => {
  const sources = [{ ...source, envelope: 'CTO' }];
  const direct = { ...position, envelope: 'CTO' };
  assert.equal(suggestBoursoMappings(sources, [direct, { ...direct, id: 'other' }], [])[0].mapping.positionId, '');
  const mapping = { account: 'b'.repeat(64), asset: source.asset, positionId: direct.id, label: 'Déjà associé' };
  assert.equal(suggestBoursoMappings(sources, [direct], [mapping])[0].mapping.positionId, '');
  assert.ok(suggestBoursoMappings([...sources, { ...sources[0], account: 'c'.repeat(64) }], [direct], []).every(s => !s.mapping.positionId));
});
test('soldes personnels : Livret A et contrat d’assurance vie uniques reconnus sans ISIN', () => {
  const sources: BoursoSource[] = [
    { ...source, asset: 'balance', envelope: 'Direct', balanceType: 'livret-a' },
    { ...source, account: 'b'.repeat(64), asset: 'balance', envelope: 'Assurance vie', balanceType: 'assurance-vie' },
  ];
  const positions = [
    { ...position, id: 'saving', name: 'Livret A', category: 'Livret A', code: '', envelope: 'Direct' },
    { ...position, id: 'insurance', name: 'Assurance vie (fonds €)', category: 'Assurance vie (fonds €)', code: '', envelope: 'Assurance vie' },
  ];
  const result = suggestBoursoMappings(sources, positions, []);
  assert.deepEqual(result.map(s => s.mapping.positionId), ['saving', 'insurance']);
  assert.match(result[1].reason, /total du contrat/);
});
test('soldes : pas de rapprochement sans type reconnu ni attribution du total AV à un support parmi plusieurs', () => {
  const insurance: BoursoSource = { ...source, asset: 'balance', envelope: 'Assurance vie', balanceType: 'assurance-vie' };
  const fund = { ...position, id: 'fund', code: '', envelope: 'Assurance vie', name: 'Fonds euros' };
  for (const positions of [
    [fund, { ...fund, id: 'other', name: 'Autre contrat' }],
    [fund, { ...fund, id: 'uc', code: 'IE0002XZSHO1', name: 'Unités de compte' }],
    [{ ...fund, code: 'IE0002XZSHO1' }],
  ]) assert.equal(suggestBoursoMappings([insurance], positions, [])[0].mapping.positionId, '');
  assert.equal(suggestBoursoMappings([{ ...insurance, balanceType: undefined }], [fund], [])[0].mapping.positionId, '');
  const saving = { ...position, id: 'saving', name: 'Livret A', code: '', envelope: 'Direct' };
  const savingSource: BoursoSource = { ...source, asset: 'balance', envelope: 'Direct', balanceType: 'livret-a' };
  assert.equal(suggestBoursoMappings([savingSource], [saving, { ...saving, id: 'other' }], [])[0].mapping.positionId, '');
  assert.equal(suggestBoursoMappings([savingSource], [{ ...saving, name: 'Compte courant' }], [])[0].mapping.positionId, '');
});
test('deux comptes concurrents : pas de double association ni de fusion des montants', () => {
  const second = { ...source, account: 'b'.repeat(64) };
  const result = suggestBoursoMappings([source, second], [position], []);
  assert.ok(result.every(s => s.mapping.positionId === ''));
});
test('préserve les associations existantes et refuse de voler leur destination', () => {
  const existing = { account: source.account, asset: source.asset, positionId: position.id, label: 'Déjà associé' };
  const second = { ...source, account: 'b'.repeat(64) };
  const result = suggestBoursoMappings([source, second], [position], [existing]);
  assert.deepEqual(result[0].mapping, existing);
  assert.equal(result[1].mapping.positionId, '');
});
test('une ancienne destination supprimée ne reste pas sélectionnée', () => {
  const existing = { account: source.account, asset: source.asset, positionId: 'deleted', label: 'Supprimé' };
  assert.equal(suggestBoursoMappings([source], [], [existing])[0].mapping.positionId, '');
  assert.equal(suggestBoursoMappings([source], [position], [existing])[0].mapping.positionId, position.id);
});
test('export/import : seulement compte pseudonymisé, ISIN, enveloppe et libellé', () => {
  const discovery = buildDiscovery([{ ...source, cents: 999, token: 'secret-test', accountKey: 'private-bank-key' }]);
  const imported = parseBoursoDiscovery(discovery);
  assert.deepEqual(imported, [source]);
  for (const field of ['cents', 'token', 'accountKey']) assert.equal(JSON.stringify(discovery).includes(field), false);
  assert.throws(() => buildDiscovery([]));
});
test('fichier invalide, doublons, espèces et configuration privée sont refusés', () => {
  const discovery = { kind: 'boursosync-discovery', version: 1, sources: [source] };
  for (const invalid of [null, { version: 1, token: 'private' }, { ...discovery, version: 2 },
    { ...discovery, sources: [source, source] }, { ...discovery, sources: [{ ...source, asset: 'cash' }] },
    { ...discovery, sources: [{ ...source, account: 'raw-bank-account' }] },
    { ...discovery, sources: [{ ...source, envelope: null }] }]) assert.throws(() => parseBoursoDiscovery(invalid));
  assert.deepEqual(parseBoursoDiscovery({ ...discovery, sources: [{ ...source, cents: 42, token: 'ignored' }] }), [source]);
});
