import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StockPortfolio from '../src/components/StockPortfolio';
import type { Portfolio } from '../src/lib/portfolio';

test('écran allégé : retrait du bouton, du bloc couverture et des explications longues, mention CGI conservée', () => {
  const data: Portfolio = {
    goals: { capital: 10000, annual: 1000, monthly: 1000 / 12 },
    readings: [{ id: 'r', date: '2026-11-13', projected: false, total: 1000, positions: [
      { id: 'cgi', name: 'CGI', envelope: 'PEE', category: 'Actions', code: '', amount: 1000, rate: 30 },
    ] }],
  };
  const html = renderToStaticMarkup(createElement(StockPortfolio, { data, market: { returns: [], statuses: [] } }));
  assert.doesNotMatch(html, /Actualiser|Couverture de la courbe|lignes valorisées/);
  assert.doesNotMatch(html, /TES INVESTISSEMENTS EN DÉTAIL|La dynamique de tes placements, aux pondérations d’aujourd’hui/);
  assert.doesNotMatch(html, /Courbe partiellement simulée|Courbe entièrement simulée|Croissance quotidienne constante|Hypothèse, pas une performance observée|Les taux enregistrés et le dashboard restent inchangés/);
  assert.match(html, /CGI · Simulation à 30 % par an — aucun historique disponible/);
  assert.match(html, /<b>CGI<\/b><span class="stock-tile-identifiers">Sans cotation · Simulation · 30 % \/ an<\/span>/);
  assert.doesNotMatch(html, /<strong>CGI · Simulation/);
  assert.doesNotMatch(html, /Les devises étrangères ne sont pas converties|CGI dans le PEE, sans historique|Les autres fonds non cotés|Les erreurs de synchronisation et approximations/);
  assert.match(html, /Les performances de marché sont calculées à partir des cours ajustés Yahoo, sans ajout de dividendes\./);
  assert.match(html, /Montant détenu/);
  assert.match(html, /Placements/);
  assert.equal((html.match(/class="stock-sort-button"/g) || []).length, 6);
  assert.equal((html.match(/scope="col" aria-sort="none"/g) || []).length, 6);
  assert.match(html, /aria-label="Trier par Montant"/);
});

test('WPEA et DCAM sont regroupés dans le tableau et la carte thermique', () => {
  const data: Portfolio = {
    goals: { capital: 10000, annual: 1000, monthly: 1000 / 12 },
    readings: [{ id: 'r', date: '2026-11-13', projected: false, total: 1000, positions: [
      { id: 'w', name: 'WPEA', envelope: 'PEA', category: 'Actions', code: 'EPA:WPEA', amount: 750, rate: 17 },
      { id: 'd', name: 'DCAM', envelope: 'PEA', category: 'Actions', code: 'EPA:DCAM', amount: 250, rate: 21.2 },
    ] }],
  };
  const html = renderToStaticMarkup(createElement(StockPortfolio, { data, market: { returns: [], statuses: [] } }));
  assert.equal((html.match(/class="stock-line"/g) || []).length, 1);
  assert.equal((html.match(/class="stock-tile /g) || []).length, 1);
  assert.match(html, /ETF Monde/);
  assert.match(html, /WPEA · IE0002XZSHO1 \/ DCAM · FR001400U5Q4/);
  assert.doesNotMatch(html, /FR001400U5Q4 · EUR/);
  assert.match(html, /<b>ETF Monde<\/b><span class="stock-tile-identifiers">WPEA · DCAM<\/span>/);
});

test('les tuiles affichent le libellé puis le ticker, même pour un code ISIN', () => {
  const data: Portfolio = {
    goals: { capital: 10000, annual: 1000, monthly: 1000 / 12 },
    readings: [{ id: 'r', date: '2026-11-13', projected: false, total: 1000, positions: [
      { id: 'e', name: 'ETF Europe', envelope: 'PEA', category: 'Actions', code: 'FR0013412038', amount: 1000, rate: 16 },
    ] }],
  };
  const html = renderToStaticMarkup(createElement(StockPortfolio, { data, market: { returns: [], statuses: [] } }));
  assert.match(html, /<b>ETF Europe<\/b><span class="stock-tile-identifiers">PCEU<\/span>/);
  assert.match(html, /<small class="muted">PCEU · FR0013412038<\/small>/);
  assert.doesNotMatch(html, /<b>PCEU<\/b>/);
});
