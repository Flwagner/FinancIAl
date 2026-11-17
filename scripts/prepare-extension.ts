import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { marketInstruments } from '../src/lib/market';
import { validateProject } from '../extension/shared/api.mjs';
import { prepareManifest } from '../extension/shared/manifest.mjs';

// Liste blanche : aucune credential FINANCIAL_* ni clé administrateur exportée.
let local: Record<string, string | undefined> = {};
try { local = parseEnv(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
const config = validateProject({
  version: 1,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || local.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || local.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  aliases: Object.fromEntries(marketInstruments.filter(i => 'isin' in i).flatMap(i => 'isin' in i
    ? [[i.code.toUpperCase(), i.isin], [i.symbol.toUpperCase(), i.isin]] : [])),
});
const manifestPath = new URL('../extension/manifest.json', import.meta.url);
const manifest = prepareManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), config);
writeFileSync(new URL('../extension/project.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Extension préparée : URL et clé publique uniquement. Aucun identifiant ni secret exporté.');
