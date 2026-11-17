import type { Position } from './portfolio';
import { marketInstruments, symbolForCode } from './market';
import { matchSources } from '../../extension/shared/matching.mjs';

type BoursoMapping = { account: string; asset: string; positionId: string; label: string };
export type BoursoSource = { account: string; asset: string; envelope: string; label: string; balanceType?: 'livret-a' | 'assurance-vie' };
type BoursoSuggestion = { source: BoursoSource; mapping: BoursoMapping; reason: string };

export function parseBoursoDiscovery(value: unknown): BoursoSource[] {
  const data = value as { kind?: unknown; version?: unknown; sources?: unknown } | null;
  if (!data || data.kind !== 'boursosync-discovery' || data.version !== 1 || !Array.isArray(data.sources)
    || !data.sources.length || data.sources.length > 100) throw new Error('Importe le fichier « placements détectés » exporté par Boursosync.');
  const seen = new Set<string>();
  return data.sources.map((row: unknown) => {
    const source = row as Partial<BoursoSource> | null;
    if (!source || typeof source.account !== 'string' || !/^[a-f0-9]{64}$/.test(source.account)
      || typeof source.asset !== 'string' || !/^(?:[A-Z]{2}[A-Z0-9]{9}\d|balance)$/.test(source.asset)
      || typeof source.envelope !== 'string' || source.envelope.length > 50
      || typeof source.label !== 'string' || !source.label.trim() || source.label.length > 200) throw new Error('Fichier de placements invalide.');
    const key = `${source.account}:${source.asset}`;
    if (seen.has(key)) throw new Error('Le fichier contient une source en double.');
    seen.add(key);
    return { account: source.account, asset: source.asset, envelope: source.envelope, label: source.label };
  });
}
function identityIsin(code: string) {
  const normalized = code.trim().toUpperCase();
  if (/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(normalized)) return normalized;
  // Identité exacte uniquement : ne jamais rapprocher BTC spot de l'ETP,
  // ni un proxy de marché du produit réellement détenu.
  const instrument = marketInstruments.find(i => i.symbol === symbolForCode(normalized));
  return instrument && 'isin' in instrument ? instrument.isin : undefined;
}
export function suggestBoursoMappings(sources: BoursoSource[], positions: Position[], existing: BoursoMapping[]): BoursoSuggestion[] {
  const aliases = Object.fromEntries(positions.map(p => [p.code.trim().toUpperCase(), identityIsin(p.code)]));
  return matchSources(sources, positions, existing, aliases);
}

type BoursoStatus = {
  active: boolean; mappings: BoursoMapping[]; expiresAt?: string;
  lastSyncedAt?: string; lastCapturedAt?: string; lastCount?: number;
};
export function validateBoursoMappings(mappings: BoursoMapping[]) {
  if (!mappings.length || mappings.length > 100) throw new Error('Ajoute entre 1 et 100 associations.');
  const sources = new Set<string>(), targets = new Set<string>();
  for (const m of mappings) {
    if (!/^[a-f0-9]{64}$/.test(m.account)) throw new Error('Copie l’empreinte du compte affichée dans l’extension (64 caractères).');
    if (!/^(?:[A-Z]{2}[A-Z0-9]{9}\d|balance)$/.test(m.asset)) throw new Error('Indique un ISIN ou « balance » pour un solde.');
    if (!m.positionId || !m.label.trim() || m.label.length > 200) throw new Error('Choisis un placement existant pour chaque source.');
    const source = `${m.account}:${m.asset}`;
    if (sources.has(source) || targets.has(m.positionId)) throw new Error('Une source et un placement ne peuvent être associés qu’une fois.');
    sources.add(source); targets.add(m.positionId);
  }
  return mappings;
}
export async function createBoursoToken() {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const tokenHash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  return { token, tokenHash };
}
