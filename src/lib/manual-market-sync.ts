export type MarketSyncReason = 'rate_limited' | 'source_unavailable' | 'publication_failed';
export type MarketSyncResult = { succeeded: number; failed: number; total: number; reason?: MarketSyncReason };

// Contrat partagé entre l'adaptateur Yahoo (cron Node et Edge Function Deno), le
// handler de la fonction et le navigateur : un refus de débit doit être
// reconnaissable sans relire un message libre.
const yahooRateLimitMessage = 'Yahoo Finance : HTTP 429.';
export class YahooRateLimitError extends Error {
  constructor() {
    super(yahooRateLimitMessage);
    this.name = 'YahooRateLimitError';
  }
}
export function isYahooRateLimit(error: unknown): boolean {
  return error instanceof YahooRateLimitError || (error instanceof Error && error.message === yahooRateLimitMessage);
}

// Anciennes versions du bouton : ne plus réafficher leurs erreurs de tentative
// après rechargement. Les erreurs du cron et les alertes de fraîcheur restent.
export function isLegacyManualSyncError(error: string | null): boolean {
  return error !== null && [
    'Échec de la synchronisation manuelle. Dernières valeurs valides conservées.',
    'Yahoo Finance limite les requêtes (HTTP 429). Réessaie plus tard. Dernières valeurs valides conservées.',
    'Enregistrement des cours refusé. Dernières valeurs valides conservées.',
    'Cours Yahoo Finance indisponibles ou invalides. Dernières valeurs valides conservées.',
  ].includes(error);
}

export function marketSyncMessage(result: MarketSyncResult): string {
  if (result.reason === 'rate_limited') return `${result.succeeded}/${result.total} rendements synchronisés. Yahoo Finance limite les requêtes (HTTP 429) : synchronisation interrompue. Réessaie plus tard ; les dernières valeurs valides sont conservées.`;
  const summary = `${result.succeeded}/${result.total} rendements synchronisés.`;
  if (!result.failed) return summary;
  if (result.reason === 'publication_failed') return `${summary} L’enregistrement des cours a échoué. Les dernières valeurs valides sont conservées.`;
  return `${summary} Certains cours sont indisponibles ou invalides chez Yahoo Finance. Les dernières valeurs valides sont conservées.`;
}
