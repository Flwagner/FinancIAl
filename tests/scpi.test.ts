import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultGoals, currentSnapshot, validatePortfolio, type Portfolio, type Position } from '../src/lib/portfolio';
import { importScpi, scpiAllocation, scpiSource, setScpiSource, validateScpiImport, type ScpiImport } from '../src/lib/scpi';
import { normalizeLouve, type LouveBundle } from '../src/lib/scpi-normalize';
import { portfolioSaveValues } from '../src/lib/portfolio-save';

test('interface SCPI : aucun bloc de chargement manuel, entrée technique masquée conservée pour le skill', () => {
  const source = readFileSync(new URL('../src/components/ScpiPortfolio.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Importer depuis Louve Invest|Fichier d’import SCPI|Dans OpenCode, demande/);
  assert.match(source, /<input hidden aria-label="Import technique SCPI" type="file"/);
  assert.match(source, /Confirmer l’import SCPI/);
});

// Cas unitaires minimaux, jamais utilisés pour une page de démonstration.
const line = (): Position => ({ id: 'existing', name: 'Test SCPI', category: 'SCPI', envelope: 'Direct', code: '', amount: 100, rate: 5 });
const portfolio = (p = line()): Portfolio => ({ goals: defaultGoals, readings: [{ id: 'old', date: '2026-01-01', projected: false, total: p.amount, positions: [p] }], monthlySnapshots: [{ month: '2026-01', capturedAt: '2026-01-01', total: p.amount }] });
const incoming = (): ScpiImport => ({
  version: 1, source: 'louve', complete: true, capturedAt: '2026-11-24',
  positions: [{ id: 'test-scpi', name: 'Test SCPI', shares: 2, invested: 100, buyingValue: 120, withdrawalValue: 108, ownership: ['Pleine propriété'], rate: 6, rateYear: 2025 }],
  facts: [{ id: 'test-scpi', sourceUrl: 'https://app.louveinvest.com/invest/scpi/test-scpi', sectors: { office: .5 }, countries: { FRA: 1 } }], transactions: [],
});
test('import rapproche sans doublon et préserve historique, autres actifs et mois figés', () => {
  const old = portfolio();
  old.readings[0].positions.push({ ...line(), id: 'stock', category: 'Actions', name: 'Action' });
  old.readings[0].total = 200;
  const copy = structuredClone(old);
  const next = importScpi(old, incoming());
  assert.deepEqual(old, copy);
  assert.deepEqual(next.readings[0], old.readings[0]);
  assert.deepEqual(next.monthlySnapshots, old.monthlySnapshots);
  assert.equal(currentSnapshot(next)?.positions.length, 2);
  assert.equal(currentSnapshot(next)?.total, 220);
  validatePortfolio(next);
});
test('une source manuelle conserve le montant et le taux ensemble', () => {
  const next = importScpi(portfolio({ ...line(), amountSource: 'manual', rateSource: 'manual' }), incoming());
  const p = currentSnapshot(next)!.positions[0];
  assert.equal(p.amount, 100); assert.equal(p.rate, 5);
  assert.equal(p.scpiId, 'test-scpi');
});
test('premier import : un taux legacy identique adopte Louve, un choix manuel associé reste manuel', () => {
  const legacy = currentSnapshot(importScpi(portfolio({ ...line(), rate: 6, rateSource: 'manual' }), incoming()))!.positions[0];
  assert.equal(legacy.rateSource, 'louve');
  const linked = currentSnapshot(importScpi(portfolio({ ...line(), rate: 6, rateSource: 'manual', scpiId: 'test-scpi' }), incoming()))!.positions[0];
  assert.equal(linked.rateSource, 'manual');
});
test('rapprochement explicite : réutilise une ligne de nom différent sans en changer le montant manuel', () => {
  const input = incoming(); input.positions[0].positionId = 'existing';
  const result = importScpi(portfolio({ ...line(), name: 'Nom historique', amountSource: 'manual' }), input);
  assert.equal(currentSnapshot(result)!.positions[0].id, 'existing');
  assert.equal(currentSnapshot(result)!.positions[0].amount, 100);
  assert.equal(currentSnapshot(result)!.positions[0].name, 'Nom historique');
});
test('les anciennes sources mixtes deviennent manuelles sans écraser aucune valeur', () => {
  const p = { ...line(), scpiId: 'test-scpi', amountSource: 'manual' as const, rateSource: 'louve' as const };
  const actual = currentSnapshot(importScpi(portfolio(p), incoming()))!.positions[0];
  assert.equal(actual.amount, 100); assert.equal(actual.rate, 5);
  assert.equal(actual.amountSource, 'manual'); assert.equal(actual.rateSource, 'manual');
});
test('la source Louve rétablit simultanément montant et taux du dernier import', () => {
  const original = { ...line(), scpiId: 'test-scpi', amountSource: 'manual' as const, rateSource: 'manual' as const };
  const result = setScpiSource(original, 'louve', incoming().positions[0]);
  assert.equal(result.amount, 120); assert.equal(result.rate, 6);
  assert.equal(result.amountSource, 'louve'); assert.equal(result.rateSource, 'louve');
  assert.equal(result.rateAsOf, '2025-12-31');
  assert.equal(scpiSource(result), 'louve');
  assert.equal(original.amount, 100);
  const manual = setScpiSource(result, 'manual');
  assert.equal(manual.amount, 120); assert.equal(manual.rate, 6);
  assert.equal(manual.amountSource, 'manual'); assert.equal(manual.rateSource, 'manual');
});
test('la source commune refuse une fiche absente, différente ou sans taux', () => {
  const p = { ...line(), scpiId: 'test-scpi' };
  assert.throws(() => setScpiSource(p, 'louve'));
  assert.throws(() => setScpiSource(p, 'louve', { ...incoming().positions[0], id: 'autre' }));
  assert.throws(() => setScpiSource(p, 'louve', { ...incoming().positions[0], rate: undefined }));
});
test('la colonne Source suit les colonnes Montant et Taux sans sélecteur sous le montant', () => {
  const source = readFileSync(new URL('../src/components/Editor.tsx', import.meta.url), 'utf8');
  assert.match(source, /<th>Montant \(€\)<\/th><th>Taux annuel \(%\)<\/th><th>Source<\/th>/);
  assert.doesNotMatch(source, /Source du montant|Source du taux/);
});
test('un import identique est un no-op, les conflits du même jour sont refusés', () => {
  const first = importScpi(portfolio(), incoming());
  assert.equal(importScpi(first, incoming()), first);
  const different = incoming(); different.positions[0].buyingValue = 121;
  assert.throws(() => importScpi(first, different), /cette date/);
});
test('un import ancien est refusé', () => {
  const first = importScpi(portfolio(), incoming());
  const old = incoming(); old.capturedAt = '2026-01-01';
  assert.throws(() => importScpi(first, old), /ancien/);
});
test('une disparition ou un rapprochement ambigu bloque au lieu de supprimer', () => {
  assert.throws(() => importScpi(portfolio({ ...line(), name: 'Autre SCPI' }), incoming()), /non rapprochées/);
  const old = portfolio(); old.readings[0].positions.push({ ...line(), id: 'duplicate' });
  assert.throws(() => importScpi(old, incoming()), /ambigu/);
});
test('les répartitions gardent une part inconnue et sont pondérées', () => {
  const result = scpiAllocation(importScpi(portfolio(), incoming()), 'sectors');
  assert.deepEqual(result, [{ name: 'office', value: 60 }, { name: 'Non renseignée', value: 60 }]);
});
test('les identifiants dupliqués, dates et taux invalides sont refusés', () => {
  const duplicate = incoming(); duplicate.positions.push(duplicate.positions[0]);
  assert.throws(() => validateScpiImport(duplicate), /dupliqués/);
  const invalid = incoming(); invalid.capturedAt = '2026-02-30';
  assert.throws(() => validateScpiImport(invalid));
  const invalidRate = incoming(); invalidRate.positions[0].rate = NaN;
  assert.throws(() => validateScpiImport(invalidRate));
  const wrongYear = incoming(); wrongYear.positions[0].rateYear = 2024;
  assert.throws(() => validateScpiImport(wrongYear));
});
test('une importation partielle ou une fiche absente est refusée', () => {
  assert.throws(() => validateScpiImport({ ...incoming(), complete: false }));
  assert.throws(() => validateScpiImport({ ...incoming(), facts: [] }));
});
test('les répartitions impossibles sont refusées', () => {
  const bad = incoming(); bad.facts[0].countries = { FRA: .8, DEU: .8 };
  assert.throws(() => validateScpiImport(bad), /Répartition/);
});
function bundle(): LouveBundle {
  return {
    portfolio: { date: '2026-11-24', scpi: { buyingPrice: 120, investedAmount: 100, sellingPrice: 108, positions: [{ scpiUrlId: 'test-scpi', scpiName: 'Test SCPI', nbShares: 2, investedAmount: 100, buyingPrice: 120, sellingPrice: 108, ownership: ['Pleine propriété'] }] } },
    facts: [{ urlId: 'test-scpi', pageUrl: 'https://app.louveinvest.com/invest/scpi/test-scpi', assetTypes: { office: 1 }, geographyDistribution: { FRA: .5, FRA_region: .5, DEU: .5 }, performanceHistory: [{ year: 2025, period: 'FY', distributionRate: .06 }, { year: 2025, period: 'T4', distributionRate: .02 }] }],
    transactionPages: [{ page: 1, total: 0, hasMore: false, transactions: [] }],
  };
}
test('normalisation prend FY N−1, convertit les taux et évite le double comptage France', () => {
  const result = normalizeLouve(bundle());
  assert.equal(result.positions[0].rate, 6);
  assert.deepEqual(result.facts[0].countries, { FRA: .5, DEU: .5 });
  assert.equal(result.facts[0].dataAsOf, undefined);
});
test('normalisation sans FY ne fabrique aucun rendement', () => {
  const raw = bundle(); raw.facts[0].performanceHistory = [];
  assert.equal(normalizeLouve(raw).positions[0].rate, undefined);
});
test('le taux général sert de repli si le taux FY N−1 est absent, sans inventer son année', () => {
  for (const history of [[], [{ year: 2025, period: 'FY' }]]) {
    const raw = bundle(); raw.facts[0].performanceHistory = history; raw.facts[0].distributionRate = .062;
    const result = normalizeLouve(raw);
    assert.equal(result.positions[0].rate, 6.2);
    assert.equal(result.positions[0].rateReference, 'general');
    assert.equal(result.positions[0].rateYear, undefined);
    validateScpiImport(result);
  }
});
test('le taux FY N−1 prime sur la fiche générale, y compris zéro', () => {
  const raw = bundle(); raw.facts[0].distributionRate = .09;
  assert.equal(normalizeLouve(raw).positions[0].rate, 6);
  raw.facts[0].performanceHistory![0].distributionRate = 0;
  const result = normalizeLouve(raw);
  assert.equal(result.positions[0].rate, 0);
  assert.equal(result.positions[0].rateReference, 'annual');
  assert.equal(result.positions[0].rateYear, 2025);
});
test('le repli général est importé en source Louve et retire une ancienne année de référence', () => {
  const raw = bundle(); raw.facts[0].performanceHistory = []; raw.facts[0].distributionRate = .062;
  const old = portfolio({ ...line(), rateSource: 'louve', scpiId: 'test-scpi', rateAsOf: '2024-12-31' });
  const result = currentSnapshot(importScpi(old, normalizeLouve(raw)))!.positions[0];
  assert.equal(result.rate, 6.2);
  assert.equal(result.rateSource, 'louve');
  assert.equal(result.rateAsOf, undefined);
});
test('une nouvelle ligne sans taux est signalée indisponible et non comme un vrai rendement zéro', () => {
  const input = incoming(); delete input.positions[0].rate; delete input.positions[0].rateYear;
  const result = importScpi({ readings: [], goals: defaultGoals }, input);
  assert.equal(currentSnapshot(result)!.positions[0].scpiRateUnavailable, true);
});
test('nue-propriété et détention mixte : ne pas appliquer le rendement pleine propriété', () => {
  const raw = bundle(); raw.portfolio.scpi.positions[0].ownership = ['Nue-propriété'];
  assert.equal(normalizeLouve(raw).positions[0].rate, 0);
  raw.portfolio.scpi.positions[0].ownership = ['Pleine propriété', 'Nue-propriété'];
  assert.equal(normalizeLouve(raw).positions[0].rate, undefined);
});
test('une vente en cours est conservée comme telle, sans retirer la position', () => {
  const raw = bundle();
  raw.transactionPages = [{ page: 1, total: 1, hasMore: false, transactions: [{ transactionId: 'pending', scpiUrlId: 'test-scpi', direction: 'Vente', executionDate: '2026-11-24', nbShares: 2, amount: 100, ownership: 'Pleine propriété', isExternal: false, inProgress: true, status: { code: 'sent-to-scpi', label: 'En cours' } }] }];
  const result = normalizeLouve(raw);
  assert.equal(result.positions.length, 1);
  assert.equal(result.transactions[0].inProgress, true);
});
test('un ordre de clés JSONB différent ne casse pas l’idempotence', () => {
  const original = incoming();
  const first = importScpi(portfolio(), original);
  // Reconstruire avec clés inversées comme le ferait JSONB.
  const reverse = (value: unknown): unknown => Array.isArray(value) ? value.map(reverse) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, v]) => [key, reverse(v)])) : value;
  assert.equal(importScpi(first, reverse(original) as ScpiImport), first);
});
test('normalisation refuse pagination et totaux incomplets', () => {
  const raw = bundle(); raw.transactionPages[0].hasMore = true;
  assert.throws(() => normalizeLouve(raw), /Pagination/);
  const other = bundle(); other.portfolio.scpi.buyingPrice = 999;
  assert.throws(() => normalizeLouve(other), /totaux/);
});
test('le document sauvegardé contient l’historique SCPI', () => {
  const old = portfolio(); const next = importScpi(old, incoming());
  assert.deepEqual(portfolioSaveValues(next, old).data.scpi?.imports, [incoming()]);
});
