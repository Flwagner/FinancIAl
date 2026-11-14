import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateReturn, freezeChangedReadings, groupedInvestments, livePositions, marketInstruments, resolveSymbol, symbolForCode, type MarketPrice, type MarketReturn } from '../src/lib/market';
import { summarize, validatePortfolio, type Position, type Reading } from '../src/lib/portfolio';
import { parseYahooChart, fetchYahooReturn } from '../scripts/lib/yahoo';

const now = new Date('2026-11-12T06:17:00Z');
const prices: MarketPrice[] = [
  { date: '2025-11-10', close: 101, adjusted_close: 90 },
  { date: '2025-11-11', close: 100, adjusted_close: 90 },
  { date: '2026-11-11', close: 105, adjusted_close: 108 },
  { date: '2026-11-12', close: 200, adjusted_close: 200 },
];
const performance = calculateReturn('JEQP.DE', 'EUR', prices, now);
const base: Position = { id: '1', name: 'JEQP', category: 'Actions', envelope: 'CTO', code: 'LON:JEQP', amount: 1000, rate: 2, rateSource: 'market' };
const reading: Reading = { id: 'r', date: '2026-11-01', projected: false, total: 1000, positions: [base], categoryRates: { Actions: 99 } };

test('365 jours en clôture : cours du jour exclu, distributions déjà dans le cours ajusté', () => {
  assert.equal(performance.start_date, '2025-11-11');
  assert.equal(performance.as_of, '2026-11-11');
  assert.ok(Math.abs(performance.rate - 20) < 1e-9);
  assert.equal(performance.currency, 'EUR');
});
test('week-end : premier jour coté suivant la date de référence', () => {
  const result = calculateReturn('TEST', 'EUR', [
    { date: '2025-11-03', close: 100, adjusted_close: 100 },
    { date: '2026-11-01', close: 110, adjusted_close: 110 },
  ], new Date('2026-11-02T06:00:00Z'));
  assert.equal(result.start_date, '2025-11-03');
});
test('pas de performance inventée pour un ETF trop récent, cours absent ou périmé', () => {
  assert.throws(() => calculateReturn('X', 'EUR', prices.slice(2), now), /insuffisant/);
  assert.throws(() => calculateReturn('X', 'EUR', [], now), /récent/);
  assert.throws(() => calculateReturn('X', 'EUR', prices.slice(0, 2), now), /récent/);
  assert.throws(() => calculateReturn('X', 'EUR', [{ ...prices[0], adjusted_close: 0 }], now), /invalide/);
  assert.throws(() => calculateReturn('X', 'EUR', [...prices, prices[0]], now), /dupliqué/);
});
test('regroupement ETF Monde pondéré par capital, jamais additionné une seconde fois', () => {
  const positions = [
    { ...base, name: 'WPEA', group: 'ETF Monde', amount: 900, rate: 10 },
    { ...base, id: '2', name: 'DCAM', group: 'ETF Monde', amount: 100, rate: 30 },
  ];
  const groups = groupedInvestments(positions);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].value, 1000);
  assert.equal(groups[0].rate, 12);
});
test('marché prioritaire au taux de synthèse, sans mutation du relevé historique', () => {
  const before = JSON.stringify(reading);
  const result = livePositions(reading, { returns: [performance], statuses: [] }, now);
  assert.ok(Math.abs(result.positions[0].rate - 20) < 1e-9);
  assert.equal(result.categoryRates.Actions, undefined);
  assert.equal(JSON.stringify(reading), before);
  assert.ok(Math.abs(summarize(result.positions, result.categoryRates).annual - 200) < 1e-9);
});
test('échec de synchronisation : dernière bonne valeur conservée et avertissement', () => {
  const result = livePositions(reading, { returns: [performance], statuses: [{ symbol: 'JEQP.DE', last_attempt_at: now.toISOString(), error: 'HTTP 429' }] }, now);
  assert.ok(Math.abs(result.positions[0].rate - 20) < 1e-9);
  assert.match(result.warnings[0], /échec/);
  const fallback = livePositions(reading, { returns: [], statuses: [] }, now);
  assert.equal(fallback.positions[0].rate, 2);
  assert.match(fallback.warnings[0], /conservé/);
});
test('aucun faux avertissement pendant le chargement initial des rendements', () => {
  const pending = livePositions(reading, { returns: [], statuses: [], loading: true }, now);
  assert.deepEqual(pending.warnings, []);
  assert.equal(pending.positions[0].rate, base.rate);
  const loaded = livePositions(reading, { returns: [performance], statuses: [] }, now);
  assert.deepEqual(loaded.warnings, []);
  assert.ok(Math.abs(loaded.positions[0].rate - 20) < 1e-9);
  const missing = livePositions(reading, { returns: [], statuses: [] }, now);
  assert.match(missing.warnings[0], /indisponible/);
  const failed = livePositions(reading, { returns: [], statuses: [], error: 'Lecture impossible.' }, now);
  assert.ok(failed.warnings.includes('Lecture impossible.'));
  assert.match(failed.warnings[0], /indisponible/);
});
test('mode manuel inchangé et avertissement en cas de données anciennes', () => {
  const manual = livePositions({ ...reading, positions: [{ ...base, rateSource: 'manual' }] }, { returns: [performance], statuses: [] }, now);
  assert.equal(manual.positions[0].rate, 2);
  assert.equal(manual.categoryRates.Actions, 99);
  const old: MarketReturn = { ...performance, as_of: '2026-10-01' };
  assert.match(livePositions(reading, { returns: [old], statuses: [] }, now).warnings[0], /ancienne/);
});
test('cotation JEQP en EUR à Xetra, distincte du JEPQ américain', () => {
  // La ligne JEQP.L (Londres, GBp) n'est plus suivie : cours ajusté Yahoo sans
  // les distributions. Les anciens relevés restent lisibles via resolveSymbol.
  assert.equal(symbolForCode('LON:JEQP'), undefined);
  assert.equal(resolveSymbol('LON:JEQP'), 'JEQP.DE');
  assert.equal(resolveSymbol('JEQP.L'), 'JEQP.DE');
  assert.equal(resolveSymbol(' ie000u9j8hx9 '), 'JEQP.DE');
  assert.equal(marketInstruments.find(i => 'isin' in i && i.isin === 'IE000U9J8HX9')?.currency, 'EUR');
  assert.equal(symbolForCode(' wpea.pa '), 'WPEA.PA');
  assert.equal(symbolForCode('JEPQ'), undefined);
});
test('relevé JEQP encore codé LON:JEQP : taux EUR appliqué, ancien cours GBp ignoré', () => {
  const live = livePositions(reading, { returns: [performance], statuses: [] }, now);
  assert.ok(Math.abs(live.positions[0].rate - 20) < 1e-9);
  assert.equal(live.positions[0].rateAsOf, performance.as_of);
  const pence = livePositions(reading, { returns: [{ ...performance, symbol: 'JEQP.L', currency: 'GBp', rate: -3.16 }], statuses: [] }, now);
  assert.equal(pence.positions[0].rate, base.rate);
  assert.match(pence.warnings.join(' '), /indisponible/);
});
test('ISIN des huit placements BoursoBank : identité préservée, références EUR distinctes', () => {
  const expected = [
    ['IE0002XZSHO1', 'WPEA.PA'], ['FR001400U5Q4', 'DCAM.PA'],
    ['FR0013412038', 'PCEU.PA'], ['FR0013412020', 'PAEEM.PA'],
    ['FR0013412012', 'PAASI.PA'], ['IE00BDBRDM35', 'AGGH.MI'],
    ['GB00BLD4ZL17', 'BITC.PA'], ['FRSGE001BQW9', 'FRSGE001BQW9'],
  ];
  for (const [isin, symbol] of expected) {
    assert.equal(symbolForCode(` ${isin.toLowerCase()} `), symbol);
    assert.equal(marketInstruments.find(i => i.symbol === symbol)?.currency, 'EUR');
  }
  for (const code of ['GLD', 'NYSEARCA:GLD', 'AGGH']) assert.equal(symbolForCode(code), undefined);
  assert.equal(symbolForCode('BTC-EUR'), 'BTC-EUR');
  assert.equal(symbolForCode('IE00B579F325'), 'SGLD.MI');
  assert.equal(symbolForCode('EPA:BITC'), 'BITC.PA');
});
test('les archives restent valides et immuables ; GLD USD ne sert plus de référence', () => {
  for (const code of ['NYSEARCA:GLD', 'BTCEUR']) {
    const archived = { ...reading, positions: [{ ...base, code }] };
    const before = JSON.stringify(archived);
    const result = livePositions(archived, { returns: [{ ...performance, symbol: 'GLD', currency: 'USD', rate: -25 }], statuses: [] }, now);
    assert.equal(result.positions[0].rate, base.rate);
    assert.equal(result.updatedAt, undefined);
    assert.match(result.referenceNotes.join(' '), /Approximation/);
    validatePortfolio({ readings: [archived], goals: { capital: 1, annual: 1, monthly: 1 } });
    assert.equal(JSON.stringify(archived), before);
  }
});
test('approximations explicites BTC-EUR et SGLD.MI : pas de réétiquetage du produit détenu', () => {
  for (const [code, symbol] of [['GB00BLD4ZL17', 'BTC-EUR'], ['FRSGE001BQW9', 'SGLD.MI'], ['BTCEUR', 'BTC-EUR'], ['NYSEARCA:GLD', 'SGLD.MI']]) {
    const held = { ...reading, positions: [{ ...base, code }] };
    const result = livePositions(held, { returns: [{ ...performance, currency: 'EUR', symbol, rate: 7 }], statuses: [] }, now);
    assert.equal(result.positions[0].rate, 7);
    assert.equal(result.positions[0].code, code);
    assert.equal(result.positions[0].rateAsOf, performance.as_of);
    assert.match(result.referenceNotes[0], /Approximation/);
    assert.ok(result.referenceNotes[0].includes(symbol));
    assert.deepEqual(result.warnings, []);
    assert.equal(held.positions[0].rate, base.rate);
    const failed = livePositions(held, { returns: [{ ...performance, currency: 'EUR', symbol, rate: 7 }], statuses: [{ symbol, last_attempt_at: now.toISOString(), error: 'HTTP 429' }] }, now);
    assert.match(failed.warnings.join(' '), /échec/);
    const wrongCurrency = livePositions(held, { returns: [{ ...performance, currency: 'USD', symbol, rate: 99 }], statuses: [] }, now);
    assert.equal(wrongCurrency.positions[0].rate, base.rate);
    assert.match(wrongCurrency.warnings.join(' '), /indisponible/);
  }
});
test('obligations automatiques : AGGH en EUR remplace le taux manuel et le taux de catégorie', () => {
  const bonds = { ...reading, positions: [{ ...base, code: 'IE00BDBRDM35', category: 'Obligations' }], categoryRates: { Obligations: 10 } };
  const result = livePositions(bonds, { returns: [{ ...performance, currency: 'EUR', symbol: 'AGGH.MI', rate: -1.88 }], statuses: [] }, now);
  assert.equal(result.positions[0].rate, -1.88);
  assert.equal(result.categoryRates.Obligations, undefined);
  assert.deepEqual(result.warnings, []);
});
const payload = { chart: { error: null, result: [{ meta: { symbol: 'JEQP.DE', currency: 'EUR', exchangeTimezoneName: 'Europe/Berlin' }, timestamp: [1762866000], indicators: { quote: [{ close: [100] }], adjclose: [{ adjclose: [95] }] } }] } };
test('adaptateur Yahoo : vérification de la cotation, devise et prix ajustés', () => {
  assert.equal(parseYahooChart(payload, 'JEQP.DE', 'EUR')[0].adjusted_close, 95);
  assert.throws(() => parseYahooChart(payload, 'JEPQ', 'USD'), /inattendus/);
  // L'ancienne cotation en pence sterling est refusée : elle ne peut pas être
  // réécrite comme un cours EUR.
  assert.throws(() => parseYahooChart(payload, 'JEQP.DE', 'GBp'), /inattendus/);
  const missing = structuredClone(payload);
  missing.chart.result[0].indicators.adjclose = [];
  assert.throws(() => parseYahooChart(missing, 'JEQP.DE', 'EUR'), /absent/);
});
test('adaptateur Yahoo : HTTP 429 remonte en erreur, sans contournement', async () => {
  const request = (async () => new Response('', { status: 429 })) as typeof fetch;
  await assert.rejects(fetchYahooReturn('JEQP.DE', 'EUR', now, request), /HTTP 429/);
});
test('validation : seuls les relevés modifiés figent la dernière valeur et sa date', () => {
  const market = { returns: [performance], statuses: [] };
  const untouched = freezeChangedReadings([reading], [structuredClone(reading)], market)[0];
  assert.equal(untouched.positions[0].rate, 2);
  const changed = { ...reading, positions: [{ ...base, amount: 2000 }], total: 2000 };
  const frozen = freezeChangedReadings([reading], [reading, { ...changed, id: 'new' }], market);
  assert.equal(frozen[0].positions[0].rate, 2);
  assert.ok(Math.abs(frozen[1].positions[0].rate - 20) < 1e-9);
  assert.equal(frozen[1].positions[0].rateAsOf, '2026-11-11');
  assert.equal(reading.positions[0].rate, 2);
});
