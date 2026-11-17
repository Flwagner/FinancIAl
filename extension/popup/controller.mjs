import { mergeCaptures, replaceAccountCaptures } from '../shared/core.mjs';
import { readBoursoPage } from '../shared/reader.mjs';
import { createApi, validateProject } from '../shared/api.mjs';
import { matchSources, selectedBatch } from '../shared/matching.mjs';
const $ = id => document.getElementById(id);
let captures = [], choices = {}, catalog = null, connection = null, project = null, api = null, busy = false, networkAllowed = false;
const key = row => `${row.account}:${row.asset}`;
const euro = cents => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
function status(message) { $('status').textContent = message; }
async function prepareChoices() {
  for (const suggestion of matchSources(captures, catalog?.positions || [], catalog?.mappings || [], project?.aliases || {})) {
    const sourceKey = key(suggestion.source);
    if (!Object.hasOwn(choices, sourceKey) || choices[sourceKey] === '') choices[sourceKey] = suggestion.mapping.positionId;
  }
  await chrome.storage.session.set({ choices });
}
function render() {
  $('login').hidden = !project || !networkAllowed || !!catalog;
  $('connected').hidden = !catalog;
  $('connection-status').textContent = catalog ? 'Connecté à FinancIAl · reconnaissance automatique activée' : '';
  $('connect').disabled = busy || !networkAllowed; $('disconnect').disabled = busy;
  $('rows').replaceChildren();
  const suggestions = matchSources(captures, catalog?.positions || [], catalog?.mappings || [], project?.aliases || {});
  for (const suggestion of suggestions) {
    const row = suggestion.source;
    const tr = document.createElement('tr');
    for (const text of [`${row.label} · ${row.asset} · ${row.envelope || 'Sans enveloppe'} · ${new Date(row.capturedAt).toLocaleTimeString('fr-FR')}`, euro(row.cents)]) {
      const td = document.createElement('td'); td.textContent = text; tr.append(td);
    }
    const td = document.createElement('td'), select = document.createElement('select');
    select.setAttribute('aria-label', `Destination ${row.label}`); select.disabled = busy || !catalog;
    for (const [value, label] of [['', 'Choisir une destination'], ['ignore', 'Ignorer cette ligne'],
      ...(catalog?.positions || []).map(p => [p.id, `${p.name} · ${p.envelope}${p.code ? ` · ${p.code}` : ''}`])]) {
      const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option);
    }
    select.value = choices[key(row)];
    select.addEventListener('change', async () => {
      choices[key(row)] = select.value;
      await chrome.storage.session.set({ choices }); await chrome.storage.session.remove('pending'); render();
    });
    td.append(select);
    const hint = document.createElement('small'); hint.textContent = suggestion.reason; td.append(hint); tr.append(td); $('rows').append(tr);
  }
  let valid = false;
  try { selectedBatch(captures, choices, catalog?.positions || [], 'preview'); valid = true; } catch { /* Le choix reste à compléter. */ }
  $('sync').disabled = busy || !catalog || !valid;
}
async function refreshCatalog() {
  if (!await chrome.permissions.contains({ origins: [`${project.supabaseUrl}/*`] })) {
    throw new Error('Autorise l’accès réseau dans les détails de Boursosync sur chrome://extensions, puis rouvre le popup.');
  }
  const result = await api.call(connection.token, 'context');
  if (!Array.isArray(result?.positions) || !Array.isArray(result?.mappings) || result.positions.length > 1000
    || result.positions.some(p => !p || ['id', 'name', 'code', 'envelope'].some(field => typeof p[field] !== 'string'))) {
    throw new Error('Liste des placements invalide. Aucun envoi possible.');
  }
  catalog = result;
}
async function load() {
  try {
    const response = await fetch(chrome.runtime.getURL('project.json'), { credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error();
    project = validateProject(await response.json()); api = createApi(project);
  } catch {
    status('Extension non préparée : lance npm run extension:prepare dans le projet, puis recharge l’extension.'); render(); return;
  }
  const local = await chrome.storage.local.get(['connection', 'config']);
  await chrome.storage.local.remove('balanceSelector');
  connection = local.connection || (local.config?.supabaseUrl === project.supabaseUrl ? { token: local.config.token } : null);
  networkAllowed = await chrome.permissions.contains({ origins: [`${project.supabaseUrl}/*`] });
  if (!networkAllowed) {
    status('Autorise l’accès réseau dans les détails de Boursosync sur chrome://extensions, puis rouvre le popup. Aucun identifiant à saisir avant cette autorisation.');
    render(); return;
  }
  const stored = await chrome.storage.session.get(['captures', 'choices', 'pending']);
  captures = mergeCaptures([], stored.captures || []); choices = stored.choices || {};
  if (connection) {
    try {
      await refreshCatalog(); await chrome.storage.local.set({ connection }); await chrome.storage.local.remove('config');
    } catch (error) {
      status(error.message);
      // Une panne réseau ne doit pas supprimer un accès encore valide.
      if (error.status === 401 || error.status === 403) { connection = null; await chrome.storage.local.remove('connection'); }
    }
  } else status('Connecte une fois ton compte FinancIAl : la page BoursoBank sera lue automatiquement.');
  if (catalog) await prepareChoices();
  render();
  if (catalog) {
    // Une réponse perdue peut cacher un succès serveur. Ne pas remplacer
    // l'aperçu confirmé ni l'identifiant de ce lot par une nouvelle capture.
    if (stored.pending && captures.length) status('Un envoi précédent attend confirmation. Réessaie la synchronisation du même lot, sans double écriture.');
    else await capturePage();
  }
}
$('login').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !api || !networkAllowed) return;
  const email = $('email').value.trim(), password = $('password').value;
  let connected = false;
  $('password').value = ''; busy = true; render();
  try {
    // Ne jamais ouvrir une demande d'autorisation après la saisie : Chrome
    // peut fermer le popup et interrompre la connexion. L'accès est déclaré
    // dans le manifeste et vérifié avant d'afficher le formulaire.
    if (!await chrome.permissions.contains({ origins: [`${project.supabaseUrl}/*`] })) {
      networkAllowed = false;
      throw new Error('Accès réseau retiré. Autorise Boursosync dans chrome://extensions, puis rouvre le popup.');
    }
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    connection = await api.connect(email, password);
    // Sauver la capacité avant une éventuelle panne lors de la lecture du catalogue.
    await chrome.storage.local.set({ connection }); await chrome.storage.local.remove('config');
    await chrome.storage.session.clear(); choices = {}; captures = [];
    await refreshCatalog(); connected = true;
  } catch (error) { status(error.message); }
  finally { busy = false; render(); }
  if (connected) await capturePage();
});
async function capturePage() {
  if (busy || !catalog) return;
  busy = true; status('Lecture de la page en cours…'); render();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || new URL(tab.url).origin !== 'https://clients.boursobank.com') throw new Error('Ouvre un compte sur clients.boursobank.com.');
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readBoursoPage, args: [true] });
    const result = results[0]?.result;
    if (!result) throw new Error('Lecture impossible.');
    if (result.error) throw new Error(result.error);
    if (!Array.isArray(result.capturedAccounts) || !result.capturedAccounts.length) throw new Error('Comptes capturés non identifiés.');
    const accounts = new Map(), rows = [];
    for (const bankKey of result.capturedAccounts) {
      if (typeof bankKey !== 'string' || !/^[a-zA-Z0-9-]+$/.test(bankKey)) throw new Error('Compte capturé non identifié.');
      if (!accounts.has(bankKey)) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bankKey));
        accounts.set(bankKey, [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join(''));
      }
    }
    for (const { accountKey, ...row } of result.rows) {
      const bankKey = accountKey || result.accountKey;
      if (!accounts.has(bankKey)) throw new Error('Ligne hors des comptes relus.');
      // Ne jamais persister la référence brute : plusieurs comptes distincts
      // sont lus sur la même page (titres, Livret A et assurance vie).
      rows.push({ ...row, account: accounts.get(bankKey), envelope: row.envelope || result.envelope, capturedAt: result.capturedAt });
    }
    captures = replaceAccountCaptures(captures, {
      accounts: [...accounts.values()], rows, capturedAt: result.capturedAt,
    });
    const remaining = new Set(captures.map(key));
    choices = Object.fromEntries(Object.entries(choices).filter(([sourceKey]) => remaining.has(sourceKey)));
    await chrome.storage.session.set({ captures, choices }); await chrome.storage.session.remove('pending');
    await prepareChoices();
    status(`${result.rows.length} montant(s) lu(s). Vérifie les destinations puis confirme. ${result.warnings.join(' ')}`);
  } catch (error) { status(error.message); }
  finally { busy = false; render(); }
}
$('sync').addEventListener('click', async () => {
  if (busy || !catalog) return;
  busy = true; render();
  try {
    const candidate = selectedBatch(captures, choices, catalog.positions, crypto.randomUUID());
    const { pending } = await chrome.storage.session.get('pending');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ updates: candidate.updates, token: connection.token })));
    const fingerprint = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
    const batch = pending?.fingerprint === fingerprint ? pending.batch : candidate;
    await chrome.storage.session.set({ pending: { fingerprint, batch } });
    const result = await api.call(connection.token, 'sync', batch);
    if (result?.ok !== true || result.batchId !== batch.batchId) throw new Error('Confirmation invalide. Aucun succès confirmé.');
    captures = []; choices = {}; await chrome.storage.session.clear();
    status(`Synchronisé : ${result.count} placement(s).${result.duplicate ? ' Lot déjà reçu, sans double écriture.' : ''}`);
    await refreshCatalog().catch(() => {}); // Une panne de relecture n'annule pas le succès confirmé.
  } catch (error) { status(error.name === 'TimeoutError' || error instanceof TypeError
    ? 'Réponse réseau non reçue : réessaie le même lot sans double écriture.' : error.message); }
  finally { busy = false; render(); }
});
$('disconnect').addEventListener('click', async () => {
  if (busy || !connection) return;
  busy = true; render();
  try {
    const result = await api.call(connection.token, 'revoke');
    if (result?.ok !== true) throw new Error('Révocation non confirmée.');
    await chrome.storage.local.remove(['connection', 'config']); await chrome.storage.session.clear();
    connection = null; catalog = null; captures = []; choices = {}; status('Extension déconnectée et accès révoqué.');
  } catch (error) { status('Déconnexion non confirmée. Réessaie avec une connexion réseau ; l’accès n’a pas été oublié localement.'); }
  finally { busy = false; render(); }
});
load().catch(() => { status('Impossible de charger l’extension. Ferme puis rouvre le popup.'); render(); });
