// Moteur commun au popup et aux tests de l'application. Aucune donnée de montant nécessaire.
export function matchSources(sources, positions, existing = [], aliases = {}) {
  const envelope = value => String(value || '').trim().toUpperCase();
  const isin = code => {
    const value = String(code || '').trim().toUpperCase();
    return /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(value) ? value : Object.hasOwn(aliases, value) ? aliases[value] : undefined;
  };
  const suggestions = sources.map(source => {
    const saved = existing.find(m => m.account === source.account && m.asset === source.asset);
    const savedPosition = positions.find(p => p.id === saved?.positionId);
    const identifiable = source.asset !== 'balance' && envelope(source.envelope);
    const sameIsin = identifiable ? positions.filter(p => isin(p.code) === source.asset) : [];
    let candidates = sameIsin.filter(p => envelope(p.envelope) === envelope(source.envelope));
    if (source.asset === 'balance' && source.balanceType === 'livret-a' && envelope(source.envelope) === 'DIRECT') {
      candidates = positions.filter(p => envelope(p.envelope) === 'DIRECT' && !String(p.code || '').trim()
        && envelope(p.name) === 'LIVRET A');
    }
    if (source.asset === 'balance' && source.balanceType === 'assurance-vie' && envelope(source.envelope) === 'ASSURANCE VIE') {
      const contracts = positions.filter(p => envelope(p.envelope) === 'ASSURANCE VIE');
      // Ne pas attribuer le total du contrat à un ETF/support parmi plusieurs.
      candidates = contracts.length === 1 && !String(contracts[0].code || '').trim() ? contracts : [];
    }
    const position = !savedPosition && candidates.length === 1 ? candidates[0] : undefined;
    return { source, mapping: saved && savedPosition ? { ...saved } : { account: source.account, asset: source.asset,
      positionId: position?.id || '', label: position ? `${position.name} · ${position.envelope}` : '' },
    reason: savedPosition ? 'Association mémorisée.' : position
      ? source.balanceType === 'livret-a' ? 'Livret A personnel reconnu.'
        : source.balanceType === 'assurance-vie' ? 'Assurance vie personnelle · total du contrat à vérifier.'
        : 'Reconnu par ISIN et enveloppe.'
      : source.asset === 'balance' ? 'Choisis le placement correspondant à ce solde.'
      : !source.envelope ? 'Enveloppe inconnue : choisis la destination.'
      : candidates.length > 1 ? 'Plusieurs correspondances : choisis la destination.'
      : 'Aucune correspondance : choisis une destination ou ignore cette ligne.' };
  });
  return suggestions.map(suggestion => {
    const { mapping } = suggestion;
    if (mapping.positionId && !existing.some(m => m.account === mapping.account && m.asset === mapping.asset && m.positionId === mapping.positionId)) {
      if (existing.some(m => m.positionId === mapping.positionId)
        || suggestions.filter(s => s.mapping.positionId === mapping.positionId).length > 1) {
        return { ...suggestion, mapping: { ...mapping, positionId: '', label: '' },
          reason: 'Destination déjà associée ou commune à plusieurs comptes : choisis une destination distincte.' };
      }
    }
    return suggestion;
  });
}

export function selectedBatch(captures, choices, positions, batchId, now = Date.now()) {
  const seenSources = new Set(), seenTargets = new Set(), updates = [];
  for (const row of captures) {
    const source = `${row.account}:${row.asset}`;
    const choice = choices[source];
    if (choice === 'ignore') continue;
    const target = positions.find(p => p.id === choice);
    if (!target) throw new Error('Choisis une destination pour chaque ligne, ou « Ignorer ».');
    if (!/^[a-f0-9]{64}$/.test(row.account) || !/^(?:[A-Z]{2}[A-Z0-9]{9}\d|balance)$/.test(row.asset)
      || !Number.isSafeInteger(row.cents) || row.cents < 0 || row.cents > 100_000_000_000) throw new Error('Capture invalide.');
    const time = Date.parse(row.capturedAt);
    if (!Number.isFinite(time) || now - time > 30 * 60_000 || time > now + 60_000) throw new Error('Capture expirée : relis les pages.');
    if (seenSources.has(source) || seenTargets.has(target.id)) throw new Error('Deux lignes ne peuvent pas écraser le même placement.');
    seenSources.add(source); seenTargets.add(target.id);
    updates.push({ account: row.account, asset: row.asset, cents: row.cents, capturedAt: row.capturedAt,
      positionId: target.id, code: target.code, envelope: target.envelope });
  }
  if (!updates.length || updates.length > 100) throw new Error('Sélectionne entre 1 et 100 placements.');
  return { version: 1, batchId, updates };
}
