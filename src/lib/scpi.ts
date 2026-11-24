import { currentSnapshot, saveCurrentReading, summarize, validatePortfolio, type Portfolio, type Position } from './portfolio';

export type ScpiLine = {
  id: string; name: string; shares: number; invested: number; buyingValue: number; withdrawalValue: number;
  ownership: string[]; rate?: number; rateYear?: number; rateReference?: 'annual' | 'general'; positionId?: string;
};
export type ScpiFact = {
  id: string; sectors: Record<string, number>; countries: Record<string, number>;
  sourceUrl: string; dataAsOf?: string;
};
export type ScpiTransaction = {
  id: string; scpiId: string; date: string; direction: 'buy' | 'sell'; shares: number;
  amount: number; ownership: string; external: boolean; inProgress: boolean; status: string;
};
export type ScpiImport = {
  version: 1; source: 'louve'; capturedAt: string; complete: true;
  positions: ScpiLine[]; facts: ScpiFact[]; transactions: ScpiTransaction[];
};
export type ScpiStore = {
  imports: ScpiImport[];
};
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const number = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const text = (s: unknown): s is string => typeof s === 'string' && !!s.trim();
function unique(ids: string[]) { if (new Set(ids).size !== ids.length) throw new Error('Identifiants SCPI dupliqués.'); }
function split(values: Record<string, number>) {
  if (!values || typeof values !== 'object' || Array.isArray(values) || Object.values(values).some(v => !number(v) || v > 1) || Object.values(values).reduce((a, b) => a + b, 0) > 1.015) throw new Error('Répartition SCPI invalide (taux attendus entre 0 et 1).');
}
export function validateScpiImport(input: unknown): asserts input is ScpiImport {
  if (!input || typeof input !== 'object') throw new Error('Import SCPI invalide.');
  const v = input as ScpiImport;
  if (v.version !== 1 || v.source !== 'louve' || v.complete !== true || !validDate(v.capturedAt) || !Array.isArray(v.positions) || !v.positions.length || !Array.isArray(v.facts) || !Array.isArray(v.transactions)) throw new Error('Import SCPI incomplet ou version inconnue.');
  unique(v.positions.map(p => p.id)); unique(v.facts.map(p => p.id)); unique(v.transactions.map(p => p.id));
  for (const p of v.positions) {
    if (!text(p.id) || !text(p.name) || ![p.shares, p.invested, p.buyingValue, p.withdrawalValue].every(number) || !Array.isArray(p.ownership) || !p.ownership.length || !p.ownership.every(text) || (p.positionId !== undefined && !text(p.positionId))) throw new Error('Position SCPI invalide.');
    if (p.rateReference !== undefined && !['annual', 'general'].includes(p.rateReference)) throw new Error('Référence du taux SCPI invalide.');
    if (p.rate !== undefined && (!number(p.rate) || (p.rateReference === 'general' ? p.rateYear !== undefined : !Number.isInteger(p.rateYear) || p.rateYear !== Number(v.capturedAt.slice(0, 4)) - 1))) throw new Error('Taux SCPI ou année de référence invalide.');
    if (!v.facts.some(f => f.id === p.id)) throw new Error(`Fiche SCPI absente : ${p.id}.`);
  }
  for (const f of v.facts) {
    if (!text(f.id) || !/^https:\/\//.test(f.sourceUrl) || (f.dataAsOf !== undefined && !validDate(f.dataAsOf))) throw new Error('Source SCPI invalide.');
    split(f.sectors); split(f.countries);
  }
  for (const t of v.transactions) {
    if (!text(t.id) || !text(t.scpiId) || !validDate(t.date) || !['buy', 'sell'].includes(t.direction) || ![t.shares, t.amount].every(number) || !text(t.ownership) || typeof t.external !== 'boolean' || typeof t.inProgress !== 'boolean' || !text(t.status)) throw new Error('Transaction SCPI invalide.');
  }
}
export function validateScpiStore(store: ScpiStore) {
  if (!store || !Array.isArray(store.imports)) throw new Error('Historique SCPI invalide.');
  store.imports.forEach(validateScpiImport);
  unique(store.imports.map(i => i.capturedAt));
}
export function latestScpi(data: Portfolio) { return [...(data.scpi?.imports ?? [])].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt)).at(-1); }
export function scpiSource(position: Position): 'manual' | 'louve' {
  // Anciens documents à sources mixtes : préserver les valeurs manuelles.
  return position.amountSource === 'manual' || position.rateSource === 'manual'
    ? 'manual' : position.scpiId && (position.amountSource === 'louve' || position.rateSource === 'louve') ? 'louve' : 'manual';
}
export function setScpiSource(position: Position, source: 'manual' | 'louve', imported?: ScpiLine): Position {
  if (position.category !== 'SCPI') throw new Error('Source commune réservée aux SCPI.');
  if (source === 'manual') return { ...position, amountSource: 'manual', rateSource: 'manual' };
  if (!imported || imported.id !== position.scpiId || imported.rate === undefined) throw new Error('Montant et taux Louve indisponibles pour cette SCPI.');
  return {
    ...position, amountSource: 'louve', rateSource: 'louve',
    amount: imported.buyingValue, rate: imported.rate, scpiRateUnavailable: false,
    rateAsOf: imported.rateYear ? `${imported.rateYear}-12-31` : undefined,
  };
}
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function matchScpi(p: Position, incoming: ScpiLine) {
  return p.category === 'SCPI' && (incoming.positionId ? p.id === incoming.positionId && (!p.scpiId || p.scpiId === incoming.id) : p.scpiId === incoming.id || (!p.scpiId && (normalize(p.name) === normalize(incoming.name) || normalize(p.name) === normalize(incoming.id))));
}
function signature(v: ScpiImport) {
  const ordered = { ...v, positions: v.positions.map(({ positionId: _, ...p }) => p).sort((a, b) => a.id.localeCompare(b.id)), facts: [...v.facts].sort((a, b) => a.id.localeCompare(b.id)), transactions: [...v.transactions].sort((a, b) => a.id.localeCompare(b.id)) };
  return JSON.stringify(ordered, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}
// Aperçu et application utilisent exactement la même transformation pure.
// Les relevés passés, les montants mensuels figés et les autres actifs ne changent pas.
export function importScpi(data: Portfolio, incoming: ScpiImport): Portfolio {
  validateScpiImport(incoming);
  const latest = latestScpi(data);
  if (latest && incoming.capturedAt < latest.capturedAt) throw new Error('Import plus ancien que le dernier relevé Louve.');
  if (latest && signature(latest) === signature(incoming)) return data;
  if (latest?.capturedAt === incoming.capturedAt) throw new Error('Un import différent existe déjà pour cette date. Vérifie les données avant de le remplacer.');
  const snapshot = currentSnapshot(data);
  if (snapshot && !snapshot.projected && snapshot.date > incoming.capturedAt) throw new Error('Un relevé plus récent existe déjà dans le portefeuille.');
  const original = snapshot?.positions ?? [];
  const matched = new Set<string>();
  const imported = incoming.positions.map(line => {
    const matches = original.filter(p => matchScpi(p, line));
    if (matches.length > 1) throw new Error(`Rapprochement ambigu pour ${line.name}.`);
    const previous = matches[0];
    if (previous) {
      if (matched.has(previous.id)) throw new Error('Deux SCPI utilisent la même ligne de destination.');
      matched.add(previous.id);
    } else if (line.positionId) throw new Error(`Ligne de destination invalide : ${line.name}.`);
    // Au premier rapprochement, un ancien taux identique au taux publié peut
    // adopter Louve sans changer sa valeur. Toute différence reste manuelle ;
    // après association, un choix Manuel est toujours une dérogation explicite.
    const manualRate = previous?.rateSource === 'manual' && !previous.scpiRateUnavailable && (!!previous.scpiId || line.rate === undefined || Math.abs(previous.rate - line.rate) > 1e-8);
    const manual = previous?.amountSource === 'manual' || manualRate;
    return {
      ...(previous ?? { id: `scpi-${line.id}`, name: line.name, category: 'SCPI', envelope: 'Direct', code: '', amount: 0, rate: 0 }),
      scpiId: line.id,
      amountSource: manual ? 'manual' : 'louve',
      amount: manual ? previous!.amount : line.buyingValue,
      rateSource: manual ? 'manual' : 'louve',
      rate: manual ? previous!.rate : line.rate ?? previous?.rate ?? 0,
      rateAsOf: manual ? previous?.rateAsOf : line.rateReference === 'general' ? undefined : line.rateYear ? `${line.rateYear}-12-31` : previous?.rateAsOf,
      scpiRateUnavailable: manual ? previous?.scpiRateUnavailable ?? false : line.rate === undefined && (!previous || previous.scpiRateUnavailable === true),
    } as Position;
  });
  // Une disparition ne signifie pas une vente confirmée : on bloque plutôt
  // que supprimer une ligne automatiquement ou doubler un nom non rapproché.
  const unmatched = original.filter(p => p.category === 'SCPI' && !matched.has(p.id));
  if (unmatched.length) throw new Error(`SCPI non rapprochées : ${unmatched.map(p => p.name).join(', ')}. Corrige le rapprochement avant l’import.`);
  const positions = [...original.filter(p => p.category !== 'SCPI'), ...imported];
  unique(positions.map(p => p.id));
  const next = saveCurrentReading(data, { id: '', date: incoming.capturedAt, projected: false, positions, total: summarize(positions).total, categoryRates: snapshot?.categoryRates }, incoming.capturedAt, `louve-${incoming.capturedAt}`);
  // Un taux de catégorie SCPI écraserait les sources individuelles.
  const reading = next.readings.find(r => r.date === incoming.capturedAt)!;
  if (reading.categoryRates?.SCPI !== undefined) {
    reading.categoryRates = { ...reading.categoryRates };
    delete reading.categoryRates.SCPI;
  }
  next.scpi = { imports: [...(data.scpi?.imports ?? []), structuredClone(incoming)] };
  validatePortfolio(next);
  return next;
}
export function scpiPositions(data: Portfolio) { return (currentSnapshot(data)?.positions ?? []).filter(p => p.category === 'SCPI'); }
export function scpiAllocation(data: Portfolio, field: 'sectors' | 'countries') {
  const facts = latestScpi(data)?.facts ?? [];
  const groups = new Map<string, number>();
  for (const p of scpiPositions(data)) {
    const entries = Object.entries(facts.find(f => f.id === p.scpiId)?.[field] ?? {});
    const sum = entries.reduce((s, [, weight]) => s + weight, 0);
    // Petits arrondis >100 % : normaliser seulement ce dépassement.
    for (const [name, weight] of entries) groups.set(name, (groups.get(name) ?? 0) + p.amount * weight / Math.max(1, sum));
    const missing = sum < 1 - 1e-8 ? p.amount * Math.max(0, 1 - sum) : 0;
    if (missing) groups.set('Non renseignée', (groups.get('Non renseignée') ?? 0) + missing);
  }
  return [...groups].filter(([, value]) => value > 0).map(([name, value]) => ({ name, value }));
}
