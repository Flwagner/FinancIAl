const fallbackMessage = 'Une erreur est survenue. Réessaie dans quelques instants.';

export function errorMessage(error: unknown): string {
  const message = typeof error === 'string' ? error
    : error && typeof error === 'object' && 'message' in error ? error.message : null;
  return typeof message === 'string' && message.trim() && message.trim() !== '[object Object]'
    ? message : fallbackMessage;
}
