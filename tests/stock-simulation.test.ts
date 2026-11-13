import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annualStockPerformance, annualStockSimulation, periods, simulate, stockPositions, heatmapLayout, referenceFor, usesCgiSimulation, type History } from '../src/lib/stock-simulation';
import { calculateReturn, livePositions, type MarketData } from '../src/lib/market';
import { summarize, type Position, type Reading } from '../src/lib/portfolio';
const now = new Date('2026-11-13T12:00:00Z');
const a: Position = { id: 'a', name: 'World', envelope: 'PEA', category: 'Actions', code: 'EPA:WPEA', amount: 750, rate: 0 };
const b: Position = { ...a, id: 'b', name: 'Europe', code: 'EPA:PCEU', amount: 250, envelope: 'CTO' };
const prices = (values: number[]) => values.map((v, i) => ({ date: ['2026-11-10', '2026-11-11', '2026-11-12'][i], close: v, adjusted_close: v }));
const history: History = { 'WPEA.PA': prices([100, 110, 100]), 'PCEU.PA': prices([100, 90, 100]) };
test('le graphique propose 5J, 1M, 6M et 1 an', () => {
  assert.deepEqual(periods, ['5J', '1M', '6M', '1 an']);
});
test('performances cumulées pondérées : aucun rééquilibrage ni composition quotidienne', () => {
  const r = simulate([a, b], history, 'Max', now);
  assert.ok(Math.abs(r.points[1].rate - 5) < 1e-9);
  assert.equal(r.points.at(-1)!.rate, 0);
  assert.equal(r.coverage, 100);
  assert.equal(r.lines[0].rate, 0);
});
test('ligne non couverte : exclusion et renormalisation sans rendement fictif', () => {
  const r = simulate([a, { ...b, code: 'PEE-INCONNU' }], history, 'Max', now);
  assert.equal(r.coverage, 75);
  assert.equal(r.lines[1].rate, null);
  assert.equal(r.points.at(-1)!.rate, 0);
});
test('absence, ancienneté, interruptions et période trop longue ne donnent pas de faux taux', () => {
  assert.equal(simulate([a], {}, 'Max', now).points.length, 0);
  assert.equal(simulate([a], history, '1 an', now).coverage, 0);
  assert.equal(simulate([a], history, 'Max', new Date('2026-12-01')).coverage, 0);
  const broken = { 'WPEA.PA': [prices([100])[0], { date: '2026-11-01', close: 100, adjusted_close: 100 }] };
  assert.match(simulate([a], broken, 'Max', now).lines[0].reason, /Interruption|ancienne/);
});
test('dates communes uniquement et bougie du jour exclue', () => {
  const h = { ...history, 'PCEU.PA': [history['PCEU.PA'][0], history['PCEU.PA'][2], { date: '2026-11-13', close: 999, adjusted_close: 999 }] };
  assert.deepEqual(simulate([a, b], h, 'Max', now).points.map(p => p.date), ['2026-11-10', '2026-11-12']);
});
test('filtrage des enveloppes et références explicites', () => {
  assert.equal(stockPositions([a, b, { ...a, category: 'Obligations', envelope: 'PEA' }]).length, 2);
  assert.equal(stockPositions([a, b, { ...a, envelope: 'Autre' }]).length, 3);
  assert.equal(stockPositions([{ ...a, envelope: '' }]).length, 1);
  assert.equal(stockPositions([a, b], 'CTO')[0].id, 'b');
  assert.equal(referenceFor({ ...a, code: 'GB00BLD4ZL17' }), 'BTC-EUR');
});
test('carte thermique : surface proportionnelle, sans perte ni débordement', () => {
  const tiles = heatmapLayout([{ id: 'a', amount: 750 }, { id: 'b', amount: 200 }, { id: 'c', amount: 50 }, { id: 'z', amount: 0 }]);
  assert.equal(tiles.length, 3);
  for (const t of tiles) {
    assert.ok(Math.abs(t.width * t.height - t.amount * 10) < 1e-8);
    assert.ok(t.x + t.width <= 100.000001 && t.y + t.height <= 100.000001);
  }
});
test('portefeuille vide et absence de dates communes : pas de NaN ou de performance', () => {
  assert.deepEqual(simulate([], {}, 'Max', now).points, []);
  assert.equal(simulate([], {}, 'Max', now).coverage, 0);
  const h = { ...history, 'PCEU.PA': prices([100, 110]).map(p => ({ ...p, date: p.date === '2026-11-10' ? '2026-11-09' : '2026-11-11' })) };
  assert.equal(simulate([a, b], h, 'Max', now).points.length, 0);
});
test('plusieurs enveloppes pour un même instrument : conservation de chaque montant', () => {
  const r = simulate([a, { ...a, id: 'cto', envelope: 'CTO', amount: 250 }], history, 'Max', now);
  assert.equal(r.total, 1000);
  assert.equal(r.coverage, 100);
  assert.equal(r.points.at(-1)!.rate, 0);
});
test('calcul sur cours ajustés, jamais ajout manuel des dividendes', () => {
  const h = { 'WPEA.PA': prices([100, 105, 110]).map(p => ({ ...p, close: 100 })) };
  assert.ok(Math.abs(simulate([a], h, 'Max', now).points.at(-1)!.rate - 10) < 1e-9);
});

const annualPrices = (rate: number, start = '2025-11-12', end = '2026-11-12') => [
  { date: start, close: 100, adjusted_close: 100 },
  { date: '2026-05-12', close: 110, adjusted_close: 110 },
  { date: end, close: 100 + rate, adjusted_close: 100 + rate },
  { date: '2026-11-13', close: 999, adjusted_close: 999 },
];
const annualHistory = { 'WPEA.PA': annualPrices(17), 'PCEU.PA': annualPrices(21.2) };
const reading: Reading = { id: 'r', date: '2026-11-13', total: 1000, projected: false, positions: [{ ...a, rateSource: 'market' }, { ...b, rateSource: 'market' }] };
const market: MarketData = {
  returns: Object.entries(annualHistory).map(([symbol, values]) => calculateReturn(symbol, 'EUR', values, now)),
  statuses: [],
};
test('régression 17,03 / 18,05 : taux Actions, taux annuel et dernier point identiques', () => {
  const annual = annualStockPerformance(reading, market, 'Tous', now);
  const view = annualStockSimulation(annual.positions, annualHistory, now);
  const live = livePositions(reading, market, now);
  const dashboard = summarize(live.positions.filter(p => p.category === 'Actions'), live.categoryRates).rate;
  assert.ok(Math.abs(dashboard - 18.05) < 1e-9);
  assert.equal(view.rate, dashboard);
  assert.ok(Math.abs(view.points.at(-1)!.rate - dashboard) < 1e-9);
  assert.equal(view.coverage, 100);
  assert.equal(view.points[0].date, '2025-11-12');
  assert.equal(view.points.at(-1)!.date, '2026-11-12');
});
test('365 jours calendaires depuis la clôture, même en année bissextile', () => {
  const leapNow = new Date('2024-03-02T12:00:00Z');
  const h = { 'WPEA.PA': [
    { date: '2023-03-01', close: 80, adjusted_close: 80 },
    { date: '2023-03-02', close: 100, adjusted_close: 100 },
    { date: '2024-03-01', close: 120, adjusted_close: 120 },
  ] };
  const r = simulate([a], h, '1 an', leapNow);
  assert.equal(r.points[0].date, '2023-03-02');
  assert.ok(Math.abs(r.rate! - 20) < 1e-9);
});
test('fenêtres propres aux places : pas de décalage vers la première date commune', () => {
  const h = { ...annualHistory, 'PCEU.PA': annualPrices(21.2, '2025-11-13') };
  const r = simulate([a, b], h, '1 an', now);
  assert.ok(Math.abs(r.rate! - 18.05) < 1e-9);
  assert.ok(Math.abs(r.lines[0].rate! - 17) < 1e-9);
  assert.ok(Math.abs(r.lines[1].rate! - 21.2) < 1e-9);
});
test('dates finales différentes : conservation de la dernière clôture, pas d’interpolation', () => {
  const h = { ...annualHistory, 'PCEU.PA': annualPrices(21.2, '2025-11-11', '2026-11-11') };
  const r = simulate([a, b], h, '1 an', now);
  assert.ok(Math.abs(r.rate! - 18.05) < 1e-9);
  assert.equal(r.points.at(-1)!.date, '2026-11-12');
});
test('taux manuel / de repli inclus comme le dashboard, sans inventer de courbe', () => {
  const extended: Reading = { ...reading, positions: [...reading.positions, { ...a, id: 'pee', code: '', envelope: 'PEE', amount: 500, rate: 6 }] };
  const annual = annualStockPerformance(extended, market, 'Tous', now);
  const view = annualStockSimulation(annual.positions, annualHistory, now);
  assert.ok(Math.abs(view.rate! - ((1000 * 18.05 + 500 * 6) / 1500)) < 1e-9);
  assert.equal(view.lines[2].rate, 6);
  assert.equal(view.points.length, 0);
  assert.ok(view.curveWarning);
  assert.ok(view.coverage < 100);
});
test('taux de catégorie et replis conservés exactement comme dans la vue d’ensemble', () => {
  const manual: Reading = { ...reading, positions: [{ ...a, rate: 7 }, { ...b, rate: 9 }], categoryRates: { Actions: 12 } };
  assert.equal(annualStockPerformance(manual, market, 'Tous', now).rate, 12);
  const noMarket = { returns: [], statuses: [] };
  const fallback = annualStockPerformance(reading, noMarket, 'Tous', now);
  assert.equal(fallback.rate, 0);
  assert.ok(fallback.warnings.length > 0);
});
test('un historique désynchronisé ne produit jamais un autre taux sous le même titre annuel', () => {
  const annual = annualStockPerformance(reading, market, 'Tous', now);
  const view = annualStockSimulation(annual.positions, { ...annualHistory, 'WPEA.PA': annualPrices(40) }, now);
  assert.equal(view.rate, annual.rate);
  assert.equal(view.points.length, 0);
  assert.match(view.lines[0].reason, /dashboard/);
});

const cgi: Position = { id: 'cgi', name: 'CGI', category: 'Actions', envelope: 'PEE', code: '', amount: 500, rate: 6 };
test('CGI PEE : courbe théorique quotidienne à exactement 30 % sur 365 jours', () => {
  const view = annualStockSimulation([cgi], {}, now);
  assert.equal(view.rate, 30);
  assert.equal(view.coverage, 100);
  assert.equal(view.simulatedAmount, 500);
  assert.equal(view.points.length, 366);
  assert.equal(view.points[0].rate, 0);
  assert.ok(Math.abs(view.points.at(-1)!.rate - 30) < 1e-9);
  const dailyGrowth = Math.pow(1.3, 1 / 365);
  for (let i = 1; i < view.points.length; i++) {
    const growth = (1 + view.points[i].rate / 100) / (1 + view.points[i - 1].rate / 100);
    assert.ok(Math.abs(growth - dailyGrowth) < 1e-12);
  }
  assert.equal(view.lines[0].simulated, true);
  assert.equal(view.curveWarning, '');
});
test('Tous : CGI simulée intégrée avec son poids, sans modifier les taux réels ou les relevés', () => {
  const before = structuredClone({ positions: [a, b, cgi], history: annualHistory, reading });
  const live = annualStockPerformance(reading, market, 'Tous', now);
  const view = annualStockSimulation([...live.positions, cgi], annualHistory, now);
  const expected = (1000 * 18.05 + 500 * 30) / 1500;
  assert.ok(Math.abs(view.rate! - expected) < 1e-9);
  assert.ok(Math.abs(view.points.at(-1)!.rate - expected) < 1e-9);
  assert.equal(view.coverage, 100);
  assert.equal(view.simulatedAmount, 500);
  assert.equal(view.lines[0].simulated, false);
  assert.deepEqual({ positions: [a, b, cgi], history: annualHistory, reading }, before);
  assert.ok(Math.abs(annualStockPerformance(reading, market, 'Tous', now).rate - 18.05) < 1e-9);
});
test('CGI : 5J, 1M et 6M suivent le même taux constant annualisé, pas 30 % à chaque période', () => {
  for (const period of ['5J', '1M', '6M'] as const) {
    const r = simulate([cgi], {}, period, now);
    const days = (Date.parse(r.points.at(-1)!.date) - Date.parse(r.points[0].date)) / 86400000;
    assert.ok(Math.abs(r.rate! - (Math.pow(1.3, days / 365) - 1) * 100) < 1e-9);
    assert.ok(r.rate! > 0 && r.rate! < 30);
    assert.equal(r.coverage, 100);
    assert.equal(r.lines[0].simulated, true);
  }
});
test('5J : dernières clôtures des cinq jours calendaires, bougie du jour exclue', () => {
  const h = { 'WPEA.PA': Array.from({ length: 8 }, (_, i) => ({
    date: `2026-11-${String(i + 6).padStart(2, '0')}`, close: 100 + i, adjusted_close: 100 + i,
  })) };
  const r = simulate([a], h, '5J', now);
  assert.deepEqual(r.points.map(p => p.date), ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']);
  assert.ok(Math.abs(r.rate! - (106 / 102 - 1) * 100) < 1e-9);
});
test('simulation limitée à CGI en PEE sans historique, jamais aux autres placements ni aux vrais cours', () => {
  assert.equal(usesCgiSimulation(cgi, {}), true);
  assert.equal(usesCgiSimulation({ ...cgi, name: 'Actions CGI' }, {}), true);
  assert.equal(usesCgiSimulation({ ...cgi, name: 'Autre fonds' }, {}), false);
  assert.equal(usesCgiSimulation({ ...cgi, name: 'CGIABC' }, {}), false);
  assert.equal(usesCgiSimulation({ ...cgi, envelope: 'CTO' }, {}), false);
  assert.equal(usesCgiSimulation({ ...cgi, category: 'Obligations' }, {}), false);
  assert.equal(usesCgiSimulation({ ...cgi, code: 'EPA:WPEA' }, annualHistory), false);
});
test('week-end : CGI suit la date de dernière clôture des historiques disponibles', () => {
  const view = annualStockSimulation([cgi], annualHistory, new Date('2026-11-15T12:00:00Z'));
  assert.equal(view.points.at(-1)!.date, '2026-11-13');
  assert.equal(view.rate, 30);
});
