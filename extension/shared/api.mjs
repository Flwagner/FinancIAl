export function validateProject(project) {
  if (!project || project.version !== 1) throw new Error('Extension non préparée. Lance npm run extension:prepare dans le projet.');
  const url = new URL(project.supabaseUrl);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
    || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || typeof project.publishableKey !== 'string' || !project.publishableKey.startsWith('sb_publishable_')) {
    throw new Error('Configuration publique de l’extension invalide.');
  }
  return { version: 1, supabaseUrl: url.origin, publishableKey: project.publishableKey, aliases: project.aliases || {} };
}
export function createApi(project, fetcher = fetch, cryptography = crypto) {
  const config = validateProject(project);
  async function request(path, payload, bearer, auth = false) {
    const response = await fetcher(`${config.supabaseUrl}${path}`, {
      method: 'POST', headers: { apikey: config.publishableKey, 'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(payload), credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const error = new Error(response.status === 429 ? 'Trop de tentatives. Patiente avant de réessayer.'
        : auth ? 'Connexion refusée. Vérifie tes identifiants FinancIAl (pas ceux de BoursoBank).'
        : response.status === 401 || response.status === 403 ? 'Accès expiré ou révoqué. Reconnecte l’extension.'
        : 'Synchronisation refusée ou service indisponible. Relis les pages et vérifie les destinations.');
      error.status = response.status;
      throw error; // Ne jamais inclure le corps HTTP, un JWT ou un secret dans l'erreur.
    }
    return response.status === 204 ? null : response.json();
  }
  return {
    async connect(email, password) {
      const auth = await request('/auth/v1/token?grant_type=password', { email, password }, null, true);
      if (typeof auth?.access_token !== 'string') throw new Error('Connexion FinancIAl non confirmée.');
      try {
        const token = [...cryptography.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
        const digest = await cryptography.subtle.digest('SHA-256', new TextEncoder().encode(token));
        const token_hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
        const result = await request('/rest/v1/rpc/boursosync_connect', { token_hash }, auth.access_token);
        if (result?.ok !== true) throw new Error('Autorisation FinancIAl non confirmée.');
        return { token }; // Ni mot de passe, ni refresh token, ni session Supabase persistée.
      } finally {
        // Révoquer uniquement la session temporaire créée ici, jamais celle du site.
        await request('/auth/v1/logout?scope=local', {}, auth.access_token).catch(() => {});
      }
    },
    async call(token, operation, payload = {}) {
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Reconnecte l’extension à FinancIAl.');
      return request('/rest/v1/rpc/boursosync_extension', { sync_token: token, operation, payload });
    },
  };
}
