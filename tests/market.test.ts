import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateReturn, freezeChangedReadings, groupedInvestments, livePositions, symbolForCode, type MarketPrice, type MarketReturn } from '../src/lib/market';
import { summarize, type Position, type Reading } from '../src/lib/portfolio';
import { parseYahooChart, fetchYahooReturn } from '../scripts/lib/yahoo';

const now = new Date('2026-11-12T06:17:00Z');
const prices: MarketPrice[] = [
  { date: '2025-11-10', close: 101, adjusted_close: 90 },
  { date: '2025-11-11', close: 100, adjusted_close: 90 },
  { date: '2026-11-11', close: 105, adjusted_close: 108 },
  { date: '2026-11-12', close: 200, adjusted_close: 200 },
];
const performance = calculateReturn('JEQP.L', 'GBp', prices, now);
const base: Position = { id: '1', name: 'JEQP', category: 'Actions', envelope: 'CTO', code: 'LON:JEQP', amount: 1000, rate: 2, rateSource: 'market' };
const reading: Reading = { id: 'r', date: '2026-11-01', projected: false, total: 1000, positions: [base], categoryRates: { Actions: 99 } };

test('365 jours en clôture : cours du jour exclu, distributions déjà dans le cours ajusté', () => {
  assert.equal(performance.start_date, '2025-11-11');
  assert.equal(performance.as_of, '2026-11-11');
  assert.ok(Math.abs(performance.rate - 20) < 1e-9);
  assert.equal(performance.currency, 'GBp');
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
  const result = livePositions(reading, { returns: [performance], statuses: [{ symbol: 'JEQP.L', last_attempt_at: now.toISOString(), error: 'HTTP 429' }] }, now);
  assert.ok(Math.abs(result.positions[0].rate - 20) < 1e-9);
  assert.match(result.warnings[0], /échec/);
  const fallback = livePositions(reading, { returns: [], statuses: [] }, now);
  assert.equal(fallback.positions[0].rate, 2);
  assert.match(fallback.warnings[0], /conservé/);
});
test('mode manuel inchangé et avertissement en cas de données anciennes', () => {
  const manual = livePositions({ ...reading, positions: [{ ...base, rateSource: 'manual' }] }, { returns: [performance], statuses: [] }, now);
  assert.equal(manual.positions[0].rate, 2);
  assert.equal(manual.categoryRates.Actions, 99);
  const old: MarketReturn = { ...performance, as_of: '2026-10-01' };
  assert.match(livePositions(reading, { returns: [old], statuses: [] }, now).warnings[0], /ancienne/);
});
test('cotation JEQP britannique distincte du JEPQ américain', () => {
  assert.equal(symbolForCode('LON:JEQP'), 'JEQP.L');
  assert.equal(symbolForCode(' wpea.pa '), 'WPEA.PA');
  assert.equal(symbolForCode('JEPQ'), undefined);
});
const payload = { chart: { error: null, result: [{ meta: { symbol: 'JEQP.L', currency: 'GBp', exchangeTimezoneName: 'Europe/London' }, timestamp: [1762866000], indicators: { quote: [{ close: [100] }], adjclose: [{ adjclose: [95] }] } }] } };
test('adaptateur Yahoo : vérification de la cotation, devise et prix ajustés', () => {
  assert.equal(parseYahooChart(payload, 'JEQP.L', 'GBp')[0].adjusted_close, 95);
  assert.throws(() => parseYahooChart(payload, 'JEPQ', 'USD'), /inattendus/);
  const missing = structuredClone(payload);
  missing.chart.result[0].indicators.adjclose = [];
  assert.throws(() => parseYahooChart(missing, 'JEQP.L', 'GBp'), /absent/);
});
test('adaptateur Yahoo : HTTP 429 remonte en erreur, sans contournement', async () => {
  const request = (async () => new Response('', { status: 429 })) as typeof fetch;
  await assert.rejects(fetchYahooReturn('JEQP.L', 'GBp', now, request), /HTTP 429/);
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
