import { validateProject } from './api.mjs';

// Autorisation déclarée avant la connexion, pour le seul projet configuré.
// Aucun accès permanent au site bancaire : sa lecture reste volontaire via activeTab.
export function prepareManifest(manifest, project) {
  const config = validateProject(project);
  const { optional_host_permissions, options_ui, ...base } = manifest;
  return { ...base, host_permissions: [`${config.supabaseUrl}/*`] };
}
