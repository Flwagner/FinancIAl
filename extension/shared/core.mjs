export const MAX_AGE = 30 * 60 * 1000;
export const normalize = text => String(text ?? '').replace(/[\s\u00a0\u202f]+/g, ' ').trim();

// Fichier d'association uniquement : ni montants, ni référence bancaire brute, ni jeton.
export function buildDiscovery(captures) {
  if (!captures.length || captures.length > 100) throw new Error('Lis d’abord les pages à associer (100 lignes maximum).');
  const sources = captures.map(({ account, asset, label, envelope }) => {
    if (!/^[a-f0-9]{64}$/.test(account) || !/^(?:[A-Z]{2}[A-Z0-9]{9}\d|balance)$/.test(asset)
      || typeof label !== 'string' || !label.trim() || label.length > 200) throw new Error('Placement détecté invalide.');
    return { account, asset, label, envelope: typeof envelope === 'string' ? envelope : '' };
  });
  return { kind: 'boursosync-discovery', version: 1, sources };
}

// Entier en centimes : pas de parseFloat permissif, ni d'arrondi d'un montant invalide.
export function parseEuro(text) {
  const value = normalize(text).replace(/\s*€$/, '').trim();
  if (!/^(?:\d+|\d{1,3}(?: \d{3})+)(?:,\d{1,2})?$/.test(value)) {
    throw new Error('Montant EUR invalide ou masqué.');
  }
  const [whole, fraction = ''] = value.replaceAll(' ', '').split(',');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents > 100_000_000_000) throw new Error('Montant hors limites.');
  return cents;
}

export function validateConfig(config) {
  if (!config || config.version !== 1) throw new Error('Format de configuration non reconnu.');
  const url = new URL(config.supabaseUrl);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
    || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Seule une URL de projet https://….supabase.co est autorisée.');
  }
  if (!/^[a-f0-9]{64}$/.test(config.token) || typeof config.publishableKey !== 'string'
    || !config.publishableKey.startsWith('sb_publishable_')) throw new Error('Clé publique ou jeton invalide.');
  if (!Array.isArray(config.mappings) || !config.mappings.length || config.mappings.length > 100) {
    throw new Error('Associations manquantes ou trop nombreuses.');
  }
  const sources = new Set(), targets = new Set();
  for (const m of config.mappings) {
    if (!/^[a-f0-9]{64}$/.test(m.account) || !/^(?:[A-Z]{2}[A-Z0-9]{9}\d|balance)$/.test(m.asset)
      || typeof m.positionId !== 'string' || !m.positionId || typeof m.label !== 'string') throw new Error('Association invalide.');
    const key = `${m.account}:${m.asset}`;
    if (sources.has(key) || targets.has(m.positionId)) throw new Error('Association en double.');
    sources.add(key); targets.add(m.positionId);
  }
  return { version: 1, supabaseUrl: url.origin, publishableKey: config.publishableKey,
    token: config.token, mappings: config.mappings.map(({ account, asset, positionId, label }) => ({ account, asset, positionId, label })) };
}

export function mergeCaptures(previous, next, now = Date.now()) {
  const map = new Map();
  for (const row of [...previous, ...next]) {
    if (!Number.isFinite(Date.parse(row.capturedAt)) || now - Date.parse(row.capturedAt) > MAX_AGE
      || Date.parse(row.capturedAt) > now + 60_000) continue;
    const key = `${row.account}:${row.asset}`;
    if (!map.has(key) || Date.parse(map.get(key).capturedAt) < Date.parse(row.capturedAt)) map.set(key, row);
  }
  return [...map.values()];
}

// Un instantané complet remplace la file locale des seuls comptes réellement
// relus. Un titre disparu n'est plus envoyé ; il n'est jamais converti en zéro.
export function replaceAccountCaptures(previous, snapshot, now = Date.now()) {
  const time = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(time) || now - time > MAX_AGE || time > now + 60_000) throw new Error('Capture expirée : rouvre l’extension.');
  if (!Array.isArray(snapshot.accounts) || !snapshot.accounts.length || snapshot.accounts.some(account => !/^[a-f0-9]{64}$/.test(account))) {
    throw new Error('Comptes de la capture invalides.');
  }
  const accounts = new Set(snapshot.accounts);
  if (!Array.isArray(snapshot.rows) || snapshot.rows.some(row => !accounts.has(row.account) || row.capturedAt !== snapshot.capturedAt)) {
    throw new Error('Lignes de capture incohérentes avec les comptes relus.');
  }
  const fresh = mergeCaptures([], previous, now);
  // Une réponse plus ancienne ne doit pas supprimer une observation plus récente.
  for (const row of fresh) if (Date.parse(row.capturedAt) > time) accounts.delete(row.account);
  return mergeCaptures(fresh.filter(row => !accounts.has(row.account)), snapshot.rows.filter(row => accounts.has(row.account)), now);
}

export function buildBatch(rows, mappings, id, now = Date.now()) {
  const fresh = mergeCaptures([], rows, now);
  if (fresh.length !== rows.length) throw new Error('Capture expirée ou en double : relis les pages.');
  const updates = fresh.filter(row => mappings.some(m => m.account === row.account && m.asset === row.asset));
  if (!updates.length) throw new Error('Aucun montant associé à FinancIAl.');
  for (const row of updates) {
    if (!/^(?:[A-Z]{2}[A-Z0-9]{9}\d|balance)$/.test(row.asset)) throw new Error('Type de source non pris en charge. Reconfigure les associations.');
    if (!Number.isSafeInteger(row.cents) || row.cents < 0 || row.cents > 100_000_000_000) throw new Error('Montant invalide.');
  }
  return { version: 1, batchId: id, updates: updates.map(({ account, asset, cents, capturedAt }) => ({ account, asset, cents, capturedAt })) };
}
