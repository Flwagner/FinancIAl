import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { validateBoursoMappings, createBoursoToken } from '../src/lib/boursosync';
// L'extension reste du JavaScript natif, sans bundler ni dépendance embarquée.
import { parseEuro, mergeCaptures, replaceAccountCaptures, buildBatch, validateConfig, MAX_AGE } from '../extension/shared/core.mjs';
// Lire la source native évite les helpers __name injectés par tsx/esbuild.
const readerSource = readFileSync(new URL('../extension/shared/reader.mjs', import.meta.url), 'utf8').replace('export function', 'function');

const account = 'a'.repeat(64);
const mapping = { account, asset: 'IE0002XZSHO1', positionId: 'position-test', label: 'Placement de test' };
const row = { account, asset: mapping.asset, label: mapping.label, cents: 12345, capturedAt: '2026-11-16T10:00:00Z' };
const now = Date.parse(row.capturedAt);
test('montants FR : espaces Unicode, centimes et zéro ; aucune lecture permissive', () => {
  for (const text of ['1 234,56 €', '1\u202f234,56 €', '1\u00a0234,56 €']) assert.equal(parseEuro(text), 123456);
  assert.equal(parseEuro('0,00 €'), 0);
  assert.equal(parseEuro('12,3 €'), 1230);
  for (const text of ['', '•••• €', '-1 €', '12,345 €', '1.234,56', '123 € (4 %)', '12oops', '1 23,45', 'Infinity', '1000000001 €']) {
    assert.throws(() => parseEuro(text), text);
  }
});
test('capture multi-pages : conserve la plus récente, expire les anciennes', () => {
  assert.deepEqual(mergeCaptures([row], [{ ...row, cents: 1, capturedAt: '2026-11-16T09:59:00Z' }], now), [row]);
  assert.deepEqual(mergeCaptures([row], [], now + MAX_AGE + 1), []);
  assert.deepEqual(mergeCaptures([], [{ ...row, capturedAt: '2026-11-16T10:02:00Z' }], now), []);
});
test('relecture complète : retire les titres disparus du compte relu et préserve les autres comptes', () => {
  const removed = { ...row, asset: 'FR001400U5Q4', cents: 777 };
  const other = { ...row, account: 'b'.repeat(64), cents: 888 };
  const previous = [row, removed, other];
  const updated = { ...row, cents: 23456, capturedAt: '2026-11-16T10:01:00Z' };
  const result = replaceAccountCaptures(previous, { accounts: [account], rows: [updated], capturedAt: updated.capturedAt }, now + 60_000);
  assert.deepEqual(result, [other, updated]);
  assert.deepEqual(previous, [row, removed, other], 'Le tableau précédent reste intact.');
  const batch = buildBatch(result, [mapping], 'snapshot-test', now + 60_000);
  assert.equal(batch.updates.some(update => update.asset === removed.asset), false);
  assert.equal(batch.updates.some(update => update.cents === 0), false);
});
test('compte confirmé vide : efface seulement ses captures en attente, sans générer de montant zéro', () => {
  const other = { ...row, account: 'b'.repeat(64) };
  assert.deepEqual(replaceAccountCaptures([row, other], {
    accounts: [account], rows: [], capturedAt: row.capturedAt,
  }, now), [other]);
});
test('instantané invalide, périmé ou plus ancien : ne peut pas effacer une capture plus récente', () => {
  const snapshot = { accounts: [account], rows: [row], capturedAt: row.capturedAt };
  assert.deepEqual(replaceAccountCaptures([{ ...row, capturedAt: '2026-11-16T10:00:30Z' }], snapshot, now + 30_000),
    [{ ...row, capturedAt: '2026-11-16T10:00:30Z' }]);
  assert.throws(() => replaceAccountCaptures([row], snapshot, now + MAX_AGE + 1), /expirée/);
  assert.throws(() => replaceAccountCaptures([row], { ...snapshot, accounts: [] }, now), /Comptes/);
  assert.throws(() => replaceAccountCaptures([row], { ...snapshot, rows: [{ ...row, account: 'b'.repeat(64) }] }, now), /incohérentes/);
});
test('lot minimal : pas de nom, de compte bancaire brut ni de placement non associé', () => {
  const batch = buildBatch([row, { ...row, asset: 'balance' }], [mapping], 'id', now);
  assert.deepEqual(batch, { version: 1, batchId: 'id', updates: [{ account, asset: row.asset, cents: 12345, capturedAt: row.capturedAt }] });
  assert.throws(() => buildBatch([row], [mapping], 'id', now + MAX_AGE + 1));
  assert.throws(() => buildBatch([row, row], [mapping], 'id', now));
  assert.throws(() => buildBatch([{ ...row, cents: NaN }], [mapping], 'id', now));
});
test('configuration : domaine Supabase strict, clé publique uniquement, associations uniques', () => {
  const config = { version: 1, supabaseUrl: 'https://project-test.supabase.co', publishableKey: 'sb_publishable_test', token: 'b'.repeat(64), mappings: [mapping] };
  assert.equal(validateConfig(config).supabaseUrl, config.supabaseUrl);
  for (const supabaseUrl of ['http://project.supabase.co', 'https://supabase.co.evil.com', 'https://x.supabase.co/path', 'https://user@x.supabase.co']) {
    assert.throws(() => validateConfig({ ...config, supabaseUrl }));
  }
  assert.throws(() => validateConfig({ ...config, publishableKey: 'sb_secret_no' }));
  assert.throws(() => validateConfig({ ...config, mappings: [mapping, mapping] }));
  assert.throws(() => validateBoursoMappings([mapping, { ...mapping, asset: 'balance' }]));
  assert.throws(() => validateBoursoMappings([{ ...mapping, asset: 'cash' }]));
  assert.throws(() => validateConfig({ ...config, mappings: [{ ...mapping, asset: 'cash' }] }));
  assert.throws(() => buildBatch([{ ...row, asset: 'cash' }], [{ ...mapping, asset: 'cash' }], 'id', now));
  assert.throws(() => validateBoursoMappings([{ ...mapping, account: 'numéro bancaire brut' }]));
});
test('jeton aléatoire 256 bits et empreinte, jamais identiques', async () => {
  const first = await createBoursoToken(), second = await createBoursoToken();
  assert.match(first.token, /^[a-f0-9]{64}$/);
  assert.match(first.tokenHash, /^[a-f0-9]{64}$/);
  assert.notEqual(first.token, first.tokenHash);
  assert.notEqual(first.token, second.token);
});

// Fragments structurels synthétiques pour tests unitaires uniquement.
// Ni page de démonstration, ni copie du HTML bancaire contenant des secrets.
const sourceAccount = 'account-test';
const headers = ['name', 'amountVariation', 'amount', 'quantity'];
function titleRow(isin = 'IE0002XZSHO1', amount = '1 234,56 €') {
  return `<tr><td><a href="/cours/test/"><span class="c-link__label">Titre</span></a><span class="c-table__mention">${isin}</span></td><td>12 €</td><td>${amount}</td><td>2</td></tr>`;
}
function markup(rows = titleRow(), total = '1 234,56 €', columns = headers) {
  return `<article class="l-holygrail__middle"><div data-account-key="${sourceAccount}"></div>
    <li class="c-databox-list__item"><div class="c-databox__name">Évaluation titres</div><div class="c-databox__value">${total}</div></li>
    <li class="c-databox-list__item"><div class="c-databox__name">Solde Espèces disponible 16/11/2026</div><div class="c-databox__value">0,00 €</div></li>
    <table data-table-trading-operations><thead><tr>${columns.map(column => `<th><a href="?colonne=${column}">${column}</a></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></article>`;
}
function extract(html: string, pathname = `/compte/pea/${sourceAccount}/positions/instantanee`, reportErrors = false) {
  const { document } = parseHTML(html);
  // Exécution sérialisée comme chrome.scripting : aucune fermeture accessible.
  return runInNewContext(`${readerSource}\nreadBoursoPage(${reportErrors})`, {
    document, location: { href: `https://clients.boursobank.com${pathname}` }, URL,
  });
}
test('lecteur autonome : colonne amount exacte, ISIN et aucune capture des espèces', () => {
  const captured = extract(markup());
  assert.equal(captured.accountKey, sourceAccount);
  assert.equal(captured.envelope, 'PEA');
  assert.equal(captured.rows[0].asset, 'IE0002XZSHO1');
  assert.equal(captured.rows[0].cents, 123456);
  assert.equal(captured.rows.length, 1);
  assert.equal(captured.rows.some((r: { asset: string }) => r.asset === 'cash'), false);
});
test('publicité injectée et ordre des lignes ne changent pas les associations', () => {
  const ad = '<tr class="np6-table-line"><td colspan="100">Publicité</td></tr>';
  const a = titleRow(), b = titleRow('FR001400U5Q4', '10,00 €');
  const first = extract(markup(a + ad + b, '1 244,56 €'));
  const second = extract(markup(b + ad + a, '1 244,56 €'));
  assert.equal(first.rows.find((r: { asset: string }) => r.asset === mapping.asset).cents,
    second.rows.find((r: { asset: string }) => r.asset === mapping.asset).cents);
});
test('bloque les titres dupliqués, incomplets, masqués ou une synthèse incohérente', () => {
  for (const html of [markup(titleRow() + titleRow()), markup('<tr><td>Incomplet</td></tr>'),
    markup(titleRow(undefined, '•••• €')), markup(titleRow(), '100 €'), markup(''), markup(titleRow(), '1 234,56 €', ['name','quantity']),
    markup().replace('</article>', '<table data-table-trading-operations></table></article>')]) {
    assert.throws(() => extract(html));
  }
});
test('tableau vide confirmé : annonce le compte effectivement relu, sans produire de ligne à zéro', () => {
  const result = extract(markup('', '0,00 €'));
  assert.equal(result.rows.length, 0);
  assert.deepEqual(Array.from(result.capturedAccounts), [sourceAccount]);
  assert.match(result.warnings.join(' '), /sans remise à zéro/);
  assert.throws(() => extract(markup('', '0,50 €')), /évaluation titres non nulle/);
});
test('bloque une autre identité de compte et la vue comptable', () => {
  assert.throws(() => extract(markup(), '/compte/pea/other/positions'));
  assert.throws(() => extract(markup(), `/compte/pea/${sourceAccount}/positions/comptable`));
});
test('aucun solde arbitraire du contenu principal : pas de sélecteur CSS configurable', () => {
  const html = `<article class="l-holygrail__middle"><div data-account-key="${sourceAccount}"></div><span class="balance">0 €</span></article>`;
  assert.throws(() => extract(html, `/compte/livret-a/${sourceAccount}`));
});

// Structure DOM CTO reproduite pour les tests ; noms, quantités, prix et montants
// entièrement synthétiques. Aucun relevé bancaire personnel n'est versionné.
const ctoColumns = ['', 'name', 'quantity', 'buyingPrice', 'lastPrice', 'amount', 'amountVariation', 'variation', ''];
function ctoMarkup() {
  const rows = [
    ['IE00BDBRDM35', 'Titre CTO test A', '7', '400,00 €', '425,50 €', '2 978,50 €', '178,50 €', '6,38 %'],
    ['FRSGE001BQW9', 'Titre CTO test B', '11', '30,00 €', '28,75 €', '316,25 €', '-13,75 €', '- 4,17 %'],
    ['GB00BLD4ZL17', 'Titre CTO test C', '13', '5,00 €', '6,00 €', '78,00 €', '13,00 €', '20,00 %'],
  ].map(([isin, name, ...cells]) => `<tr>
    <td><button data-order-frame-trigger-order-account="${sourceAccount}">A</button><button data-order-frame-trigger-order-account="${sourceAccount}">V</button></td>
    <td><a href="/cours/test/"><span class="c-link__label">${name}</span></a><span class="c-table__mention">${isin}</span></td>
    ${cells.map(cell => `<td><div><span class="u-ellipsis">${cell}</span></div></td>`).join('')}<td>Notification</td></tr>`);
  return `<article class="l-holygrail__middle"><h3>Positions au comptant</h3>
    <table data-table-trading-operations><thead><tr>${ctoColumns.map(column => `<th>${column ? `<a href="?sens=0&amp;colonne=${column}">${column}</a>` : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows[0]}<tr class="np6-table-line"><td colspan="100%">Publicité</td></tr>${rows.slice(1).join('')}</tbody></table>
    <h3>Engagements en liquidation</h3><ul class="overview"><li><span class="overview__name">Total des +/- values latentes</span><span class="overview__value">0,00 €</span></li></ul>
    </article>`;
}
test('CTO synthétique : 3 ISIN, colonne Montant exacte, publicité ignorée, ni espèces ni liquidation', () => {
  const result = extract(ctoMarkup(), `/compte/ord/${sourceAccount}/positions`);
  assert.equal(result.envelope, 'CTO');
  assert.equal(result.accountKey, sourceAccount);
  assert.deepEqual(Array.from(result.rows, (r: any) => [r.asset, r.cents]), [
    ['IE00BDBRDM35', 297850], ['FRSGE001BQW9', 31625], ['GB00BLD4ZL17', 7800],
  ]);
  assert.match(result.warnings.join(' '), /Vérifie chaque montant/);
});
test('CTO : identité absente, étrangère ou contradictoire bloque la capture', () => {
  const pathname = `/compte/ord/${sourceAccount}/positions`;
  assert.throws(() => extract(ctoMarkup().replaceAll('data-order-frame-trigger-order-account', 'data-unused'), pathname), /Compte non identifié/);
  assert.throws(() => extract(ctoMarkup().replace(`account="${sourceAccount}"`, 'account="other"'), pathname), /Compte non identifié/);
  assert.throws(() => extract(ctoMarkup().replace('</article>', '<div data-account-key="other"></div></article>'), pathname), /Compte non identifié/);
});
test('CTO : synthèse présente contrôlée, titres masqués refusés et PEA toujours strict', () => {
  const summary = '<li class="c-databox-list__item"><span class="c-databox__name">Évaluation titres</span><span class="c-databox__value">3 372,75 €</span></li>';
  const html = ctoMarkup().replace('</article>', `${summary}</article>`);
  const pathname = `/compte/ord/${sourceAccount}/positions`;
  assert.equal(extract(html, pathname).warnings.length, 0);
  assert.throws(() => extract(html.replace('3 372,75', '1'), pathname), /Somme des lignes/);
  assert.throws(() => extract(html.replace('2 978,50', '••••'), pathname), /Montant/);
  assert.throws(() => extract(ctoMarkup(), `/compte/pea/${sourceAccount}/positions`), /Synthèse/);
});
test('diagnostic sérialisé : message exploitable sans exception perdue ni capture partielle', () => {
  const result = extract(ctoMarkup().replace('2 978,50', '••••'), `/compte/ord/${sourceAccount}/positions`, true);
  assert.match(result.error, /Montant EUR invalide/);
  assert.equal(result.rows, undefined);
  assert.equal(result.accountKey, undefined);
});
test('synthèse responsive CTO : copies identiques acceptées, pas de confusion avec titres + espèces', () => {
  const summary = (value: string) => `<li class="c-databox-list__item"><span class="c-databox__name">Évaluation titres</span><span class="c-databox__value">${value}</span></li>`;
  const total = '<li class="c-databox-list__item"><span class="c-databox__name">Total Portefeuille (titres + espèces)</span><span class="c-databox__value">99 999,99 €</span></li>';
  const pathname = `/compte/ord/${sourceAccount}/positions`;
  const html = ctoMarkup().replace('</article>', `${summary('3 372,75 €')}${summary('3 372,75 €')}${total}</article>`);
  const result = extract(html, pathname);
  assert.equal(result.rows.length, 3);
  assert.equal(result.warnings.length, 0);
  assert.throws(() => extract(html.replace('3 372,75', '3 371,75'), pathname), /ambiguë.*plusieurs montants différents/);
  assert.throws(() => extract(html.replace('3 372,75', '••••'), pathname), /Montant EUR invalide/);
  assert.throws(() => extract(html.replaceAll('3 372,75', '3 000,00').replaceAll('3 372,75', '3 000,00'), pathname), /Somme des lignes/);
});
test('synthèse responsive PEA : doublons identiques acceptés sans relâcher le contrôle du total', () => {
  const summary = '<li class="c-databox-list__item"><div class="c-databox__name">Évaluation titres</div><div class="c-databox__value">1 234,56 €</div></li>';
  assert.equal(extract(markup().replace('</article>', `${summary}</article>`)).rows.length, 1);
  assert.throws(() => extract(markup().replace('</article>', `${summary.replace('1 234,56', '1 235,56')}</article>`)), /ambiguë/);
});

// Structure DOM de la sidebar reproduite ; tous les soldes et comptes ci-dessous
// sont synthétiques, y compris les comptes exclus de la lecture.
const sidebarAccount = (path: string, key: string, label: string, amount: string) => `
  <li><a class="c-info-box__link-wrapper" href="${path}">
    <span class="c-info-box__account-label" data-account-label="${key}">${label}</span>
    <span class="c-info-box__account-balance c-info-box__account-balance--loaded">${amount}</span>
  </a></li>`;
const sidebarPanel = (title: string, accounts: string) => `<div class="c-panel">
  <div class="c-panel__header"><span class="c-panel__title">${title}</span></div>
  <ul class="c-info-box">${accounts}</ul></div>`;
function sidebar() {
  return `<div data-sidebar-accounts-category data-segmented-control-refresh="accounts-perso">
    <span id="sidebar-personal-amount-value">98 765,43 €</span>
    ${sidebarPanel('Mes comptes bancaires', sidebarAccount('/compte/cav/current-test/', 'current-test', 'Compte courant', '321,09 €'))}
    ${sidebarPanel('Mon épargne', sidebarAccount('/compte/epargne/livret-a/saving-test/', 'saving-test', 'LIVRET A', '2&nbsp;345,67&nbsp;€'))}
    ${sidebarPanel('Mes placements financiers',
      sidebarAccount('/compte/ord/cto-test/', 'cto-test', 'Titres', '3 456,78 €')
      + sidebarAccount('/compte/pea/pea-test/', 'pea-test', 'PEA', '6 543,21 €')
      + sidebarAccount('/compte/assurance-vie/insurance-test', 'insurance-test', 'Assurance Vie', '7&nbsp;654,32&nbsp;€'))}
    ${sidebarPanel('Mes crédits', sidebarAccount('/budget/compte/loan-test/', 'loan-test', 'Prêt', '− 123 456,78 €'))}
    ${sidebarPanel('Comptes de mes enfants',
      sidebarAccount('/compte/epargne/livret-a/child-saving-test/', 'child-saving-test', 'LIVRET A', '234,56 €')
      + sidebarAccount('/compte/assurance-vie/child-insurance-test', 'child-insurance-test', 'Assurance Vie', '345,67 €'))}
    </div>`;
}
test('sidebar : seuls Livret A et assurance vie personnels, sans total global ni enfants ni espèces', () => {
  const result = extract(sidebar(), '/');
  assert.deepEqual(Array.from(result.rows, (r: any) => [r.accountKey, r.asset, r.balanceType, r.envelope, r.cents]), [
    ['saving-test', 'balance', 'livret-a', 'Direct', 234567],
    ['insurance-test', 'balance', 'assurance-vie', 'Assurance vie', 765432],
  ]);
  assert.match(result.warnings.join(' '), /montant total du contrat/);
  assert.equal(JSON.stringify(result).includes('child-'), false);
});
test('sidebar : lecture des soldes personnels en plus du tableau PEA ou CTO', () => {
  const pea = extract(markup() + sidebar());
  assert.equal(pea.rows.length, 3);
  assert.equal(pea.rows[0].asset, 'IE0002XZSHO1');
  assert.equal(pea.rows[1].accountKey, 'saving-test');
  const cto = extract(ctoMarkup() + sidebar(), `/compte/ord/${sourceAccount}/positions`);
  assert.equal(cto.rows.length, 5);
  assert.equal(cto.rows.filter((r: any) => r.asset === 'balance').length, 2);
  const overview = extract(sidebar(), '/compte/pea/pea-test/');
  assert.equal(overview.rows.length, 2);
  assert.deepEqual(Array.from(overview.capturedAccounts), ['saving-test', 'insurance-test']);
  assert.match(overview.warnings.join(' '), /Seuls les soldes personnels/);
});
test('sidebar : identité contradictoire, solde masqué/non chargé ou différent entre copies = refus', () => {
  assert.throws(() => extract(sidebar().replace('data-account-label="saving-test"', 'data-account-label="other-test"'), '/'), /non identifié/);
  assert.throws(() => extract(sidebar().replace('2&nbsp;345,67', '••••'), '/'), /Montant EUR invalide/);
  assert.throws(() => extract(sidebar().replaceAll('c-info-box__account-balance--loaded', ''), '/'), /non chargé/);
  assert.equal(extract(sidebar() + sidebar(), '/').rows.length, 2);
  assert.throws(() => extract(sidebar() + sidebar().replace('2&nbsp;345,67', '2&nbsp;346,67'), '/'), /soldes personnels différents/);
});
test('sidebar : zéro lu accepté ; comptes enfants, externes et autres segments ne sont jamais capturés', () => {
  assert.equal(extract(sidebar().replace('2&nbsp;345,67', '0,00'), '/').rows[0].cents, 0);
  assert.throws(() => extract(`<div data-sidebar-accounts-category data-segmented-control-refresh="accounts-perso">
    ${sidebarPanel('Comptes de mes enfants', sidebarAccount('/compte/epargne/livret-a/child-test/', 'child-test', 'LIVRET A', '0 €'))}</div>`, '/'));
  assert.throws(() => extract(sidebar().replace('accounts-perso', 'accounts-other'), '/'));
  const result = extract(sidebar().replace('/compte/epargne/livret-a/saving-test/', 'https://other.example/compte/epargne/livret-a/saving-test/'), '/');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].balanceType, 'assurance-vie');
});
