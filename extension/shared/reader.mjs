// Fonction autonome injectée dans le monde ISOLATED, jamais dans les scripts de la banque.
// Ne lit ni cookies, ni stockage, ni window.BRS_CONFIG, ni jetons d'authentification.
export function readBoursoPage(reportErrors = false) {
  try {
    const normalize = text => String(text ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();
    const money = text => {
      const value = normalize(text).replace(/\s*€$/, '').trim();
      if (!/^(?:\d+|\d{1,3}(?: \d{3})+)(?:,\d{1,2})?$/.test(value)) throw new Error('Montant EUR invalide ou masqué.');
      const [whole, fraction = ''] = value.replaceAll(' ', '').split(',');
      const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
      if (!Number.isSafeInteger(cents) || cents > 100_000_000_000) throw new Error('Montant hors limites.');
      return cents;
    };
    const url = new URL(location.href);
    if (url.origin !== 'https://clients.boursobank.com') throw new Error('Ouvre une page de compte sur clients.boursobank.com.');
    const warnings = [], balances = new Map(), capturedAccounts = new Set();
    // Liste blanche des sections personnelles. Ne jamais lire « Comptes de mes
    // enfants », les comptes courants, les crédits, le total global ni les cartes.
    for (const sidebar of document.querySelectorAll('[data-sidebar-accounts-category][data-segmented-control-refresh="accounts-perso"]')) {
      for (const panel of sidebar.querySelectorAll('.c-panel')) {
        const section = normalize(panel.querySelector('.c-panel__title')?.textContent);
        if (!['Mon épargne', 'Mes placements financiers'].includes(section)) continue;
        for (const link of panel.querySelectorAll('a.c-info-box__link-wrapper[href]')) {
          const accountUrl = new URL(link.getAttribute('href'), url);
          if (accountUrl.origin !== url.origin || accountUrl.username || accountUrl.password || accountUrl.search || accountUrl.hash) continue;
          const saving = accountUrl.pathname.match(/^\/compte\/epargne\/livret-a\/([a-zA-Z0-9-]+)\/?$/);
          const insurance = accountUrl.pathname.match(/^\/compte\/assurance-vie\/([a-zA-Z0-9-]+)\/?$/);
          const type = section === 'Mon épargne' && saving ? 'livret-a'
            : section === 'Mes placements financiers' && insurance ? 'assurance-vie' : null;
          if (!type) continue;
          const accountKey = (saving || insurance)[1];
          const labels = [...link.querySelectorAll('.c-info-box__account-label[data-account-label]')];
          const amounts = [...link.querySelectorAll('.c-info-box__account-balance')];
          if (labels.length !== 1 || labels[0].getAttribute('data-account-label') !== accountKey) {
            throw new Error('Compte personnel de la sidebar non identifié sans ambiguïté.');
          }
          if (amounts.length !== 1 || !amounts[0].classList.contains('c-info-box__account-balance--loaded')) {
            throw new Error('Solde personnel de la sidebar non chargé. Patiente puis rouvre l’extension.');
          }
          const row = { accountKey, asset: 'balance', balanceType: type,
            envelope: type === 'livret-a' ? 'Direct' : 'Assurance vie',
            label: type === 'livret-a' ? 'Livret A personnel' : 'Assurance vie personnelle · total du contrat',
            cents: money(amounts[0].textContent) };
          const previous = balances.get(accountKey);
          if (previous && (previous.cents !== row.cents || previous.balanceType !== type)) {
            throw new Error('Plusieurs soldes personnels différents dans la sidebar. Recharge la page.');
          }
          balances.set(accountKey, row);
        }
      }
    }
    if ([...balances.values()].some(row => row.balanceType === 'assurance-vie')) {
      warnings.push('Assurance vie : montant total du contrat, pas le détail des supports. Confirme uniquement si la destination représente le contrat entier ; sinon ignore cette ligne.');
    }
    const match = url.pathname.match(/^\/compte\/(pea|pea-pme|ord|cto)\/([a-zA-Z0-9-]+)(?:\/|$)/);
    const rows = [];
    const instantPositions = /\/positions(?:\/instantanee)?\/?$/.test(url.pathname);
    if (match && !instantPositions) {
      if (!balances.size) throw new Error('Utilise la vue Positions instantanées.');
      warnings.push('Seuls les soldes personnels de la sidebar sont lus sur cette vue. Pour les titres, ouvre les positions PEA/CTO puis rouvre l’extension.');
    }
    if (match && instantPositions) {
      const middle = document.querySelector('article.l-holygrail__middle');
      const keys = [...new Set([
        ...[...middle?.querySelectorAll('[data-account-key]') ?? []].map(el => el.getAttribute('data-account-key')),
        ...[...middle?.querySelectorAll('table[data-table-trading-operations] [data-order-frame-trigger-order-account]') ?? []]
          .map(el => el.getAttribute('data-order-frame-trigger-order-account')),
      ])];
      if (!middle || keys.length !== 1 || keys[0] !== match[2]) throw new Error('Compte non identifié sans ambiguïté. Aucune capture.');
      const tables = [...middle.querySelectorAll('table[data-table-trading-operations]')];
      if (tables.length > 1) throw new Error('Plusieurs tableaux de positions : capture ambiguë, annulée.');
      const table = tables[0];
      if (!table) throw new Error('Tableau des titres introuvable. Ouvre la page Positions ; les espèces ne sont pas importées.');
      const headers = [...table.querySelectorAll('thead th')];
      const amountColumns = headers.flatMap((el, i) => el.querySelector('a[href*="colonne=amount"]')
        && new URL(el.querySelector('a').href, url).searchParams.get('colonne') === 'amount' ? [i] : []);
      if (amountColumns.length !== 1) throw new Error('Colonne Montant non identifiée.');
      const seen = new Set();
      for (const tr of table.querySelectorAll('tbody tr')) {
        if (tr.classList.contains('np6-table-line')) continue;
        const cells = [...tr.children];
        const mentions = [...tr.querySelectorAll('.c-table__mention')].map(el => normalize(el.textContent))
          .filter(text => /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(text));
        if (mentions.length !== 1 || cells.length !== headers.length || seen.has(mentions[0])) {
          throw new Error('Ligne de titre inconnue, incomplète ou en double : capture annulée.');
        }
        seen.add(mentions[0]);
        rows.push({ asset: mentions[0], label: normalize(tr.querySelector('a[href*="/cours/"] .c-link__label')?.textContent) || mentions[0],
          cents: money(cells[amountColumns[0]].textContent) });
      }
      const total = rows.reduce((sum, row) => sum + row.cents, 0);
      const summaries = [...middle.querySelectorAll('.c-databox-list__item')]
        .filter(el => normalize(el.querySelector('.c-databox__name')?.textContent) === 'Évaluation titres');
      if (!summaries.length) {
        if (!rows.length) throw new Error('Tableau vide non confirmé par une évaluation titres nulle. Recharge la page.');
        if (!['ord', 'cto'].includes(match[1])) throw new Error('Synthèse « Évaluation titres » absente.');
        warnings.push('Synthèse « Évaluation titres » indisponible : seuls les titres du tableau sont lus. Vérifie chaque montant avant confirmation ; le total du compte peut inclure des espèces non importées.');
      } else {
        const amounts = summaries.map(el => money(el.querySelector('.c-databox__value')?.textContent));
        if (new Set(amounts).size !== 1) throw new Error('Synthèse « Évaluation titres » ambiguë : plusieurs montants différents. Recharge la page.');
        const expected = amounts[0];
        if (!rows.length && expected !== 0) throw new Error('Tableau vide mais évaluation titres non nulle. Recharge la page.');
        if (Math.abs(total - expected) > Math.max(100, expected * 0.001)) throw new Error('Somme des lignes différente de l’évaluation titres. Recharge la page.');
        if (total !== expected) warnings.push('Petit écart avec la synthèse (cotations en cours). Montants des lignes conservés.');
      }
      capturedAccounts.add(match[2]);
      if (!rows.length) warnings.push('Aucun titre : les anciennes captures de ce compte sont retirées de l’aperçu, sans remise à zéro dans FinancIAl.');
    }
    const envelope = match ? match[1] === 'pea' ? 'PEA' : match[1] === 'pea-pme' ? 'PEA-PME' : 'CTO' : '';
    rows.push(...balances.values());
    for (const accountKey of balances.keys()) capturedAccounts.add(accountKey);
    if (!capturedAccounts.size) throw new Error('Aucun titre ni solde personnel Livret A/assurance vie reconnu. Ouvre les positions PEA/CTO ou une page affichant la sidebar personnelle.');
    return { accountKey: match?.[2], envelope, capturedAccounts: [...capturedAccounts], capturedAt: new Date().toISOString(), rows, warnings };
  } catch (error) {
    if (!reportErrors) throw error;
    // Chrome peut perdre une exception d'injection : transmettre le diagnostic,
    // sans trace de page ni référence de compte.
    return { error: error instanceof Error ? error.message : 'Lecture de la page impossible.' };
  }
}
