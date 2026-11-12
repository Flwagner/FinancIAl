import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, currentReadings, summarize, validatePortfolio } from '../src/lib/portfolio';
import { demo } from './fixtures/portfolio';
import { importSheets, numberFR, type ImportFiles } from '../src/lib/import';
test('gains pondérés, négatifs et division mensuelle', () => {
  const positions = demo.readings.find(r => r.positions.length)!.positions;
  const stats = summarize(positions);
  assert.equal(stats.monthly, stats.annual / 12);
  assert.equal(summarize([]).rate, 0);
  assert.equal(summarize([{ ...positions[0], amount: 1000, rate: -5 }]).annual, -50);
  assert.equal(summarize([{ ...positions[0], amount: 1000, rate: -5 }], { SCPI: 10 }).annual, 100);
  assert.equal(aggregate(positions, 'category').reduce((s, p) => s + p.value, 0), stats.total);
});
test('la projection ne remplace pas le dernier relevé réel', () => {
  const state = currentReadings(demo.readings);
  assert.equal(state.actual?.date, '2026-11-01');
  assert.equal(state.projection?.date, '2026-12-01');
  assert.equal(state.change, 1200);
});
test('validation des doublons, dates, objectifs et montants', () => {
  validatePortfolio(demo);
  assert.throws(() => validatePortfolio({ ...demo, readings: [...demo.readings, demo.readings[0]] }), /date/);
  assert.throws(() => validatePortfolio({ ...demo, readings: [{ ...demo.readings[0], date: '2026-02-30' }] }), /Date/);
  assert.throws(() => validatePortfolio({ ...demo, goals: { ...demo.goals, annual: 0 } }), /objectifs/);
  assert.throws(() => validatePortfolio({ ...demo, readings: [{ ...demo.readings[0], total: NaN }] }), /Total/);
});
const files: ImportFiles = {
  evolution: 'Période,Montant\n01/01/2026,2000\n01/02/2026,2100\n01/03/2026,\n',
  portfolio: 'Support,Taux,Montant,Annuel,Mensuel,Code\nSCPI,7,1000,,,\nActions,12,1100,,,\n',
  scpi: 'Nom,Montant,Rendement\nPierre,1000,6\n',
  actions: 'Nom,Montant,Code,Rendement,Support,Dividende\nETF Monde,1100,,9,PEA,\n',
};
test('import : détail et synthèse sans double comptage, projections explicites', () => {
  const { data } = importSheets(files, '2026-02-01', '2026-02-01');
  assert.equal(data.readings.length, 2);
  const detail = data.readings[1];
  assert.equal(detail.projected, true);
  assert.equal(detail.positions.length, 2);
  assert.equal(detail.total, 2100);
  assert.equal(summarize(detail.positions, detail.categoryRates).annual, 159);
});
test('import refuse les incohérences entre détail et agrégat', () => {
  assert.throws(() => importSheets({ ...files, scpi: files.scpi.replace('1000', '999') }, '2026-02-01', '2026-02-01'), /ne correspond pas/);
  assert.throws(() => importSheets(files, '', ''), /date/);
});
test('formats financiers français et nombres invalides', () => {
  assert.equal(numberFR('1 234,56 €'), 1234.56);
  assert.equal(numberFR('-5,39 %'), -5.39);
  assert.throws(() => numberFR(''));
  assert.throws(() => numberFR('123abc'));
});
test('import refuse les mauvais onglets et les dates incohérentes', () => {
  assert.throws(() => importSheets({ ...files, actions: files.scpi }, '2026-02-01', '2026-02-01'), /Colonnes CSV/);
  assert.throws(() => importSheets(files, '2026-02-01', '2026-02-30'), /Date/);
  assert.throws(() => importSheets({ ...files, evolution: files.evolution.replace('2100', '2200') }, '2026-02-01', '2026-02-01'), /total détaillé/);
});
test('historique sans projection : variation des deux derniers relevés réels', () => {
  const state = currentReadings(demo.readings.filter(r => !r.projected));
  assert.equal(state.projection, undefined);
  assert.equal(state.change, state.actual!.total - state.previous!.total);
  assert.equal(currentReadings([]).change, null);
});
test('objectifs configurables avant le premier relevé', () => {
  validatePortfolio({ readings: [], goals: demo.goals });
});
test('import CSV à point-virgule et virgules décimales', () => {
  const converted = Object.fromEntries(Object.entries(files).map(([k, value]) => [k, value.replaceAll(',', ';')])) as ImportFiles;
  converted.scpi = converted.scpi.replace(';6\n', ';6,5\n');
  const result = importSheets(converted, '2026-02-01', '2026-02-01');
  assert.equal(result.data.readings[1].positions[0].rate, 6.5);
});

test('import harmonisé : WPEA/DCAM séparés et JEQP inclus, aucun taux Actions hérité', () => {
  const harmonized: ImportFiles = {
    ...files,
    evolution: 'Période,Montant\n01/02/2026,2300\n',
    portfolio: 'Support,Taux,Montant\nSCPI,7,1000\nActions,99,1300\n',
    actions: 'Nom,Montant,Code,Rendement,Support,Dividende,,,Nom,Montant,Code,Rendement\nETF Monde,1100,,50,PEA,,,,WPEA,1000,EPA:WPEA,10\nJEQP,200,LON:JEQP,20,CTO,10,,,DCAM,100,EPA:DCAM,30\n',
  };
  const detail = importSheets(harmonized, '2026-02-01', '2026-03-01').data.readings[0];
  assert.equal(detail.positions.length, 4);
  assert.equal(detail.positions.filter(p => p.group === 'ETF Monde').length, 2);
  assert.equal(detail.positions.filter(p => p.rateSource === 'market').length, 3);
  assert.equal(detail.categoryRates?.Actions, undefined);
  // Pierre 60 + WPEA 100 + DCAM 30 + JEQP 40.
  assert.equal(summarize(detail.positions, detail.categoryRates).annual, 230);
  assert.equal(detail.total, 2300);
  assert.throws(() => importSheets({ ...harmonized, actions: harmonized.actions.replace('DCAM,100,', 'DCAM,90,') }, '2026-02-01', '2026-03-01'), /WPEA\/DCAM/);
});
