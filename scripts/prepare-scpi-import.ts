import { readFile, writeFile } from 'node:fs/promises';
import { normalizeLouve } from '../src/lib/scpi-normalize';

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || input === output) throw new Error('Usage : npx tsx scripts/prepare-scpi-import.ts <bundle-mcp.json> <import.json>');
  const normalized = normalizeLouve(JSON.parse(await readFile(input, 'utf8')));
  await writeFile(output, JSON.stringify(normalized, null, 2), { mode: 0o600, flag: 'wx' });
  console.log(`Import validé : ${normalized.positions.length} SCPI, ${normalized.transactions.length} transactions, relevé du ${normalized.capturedAt}. Aucune écriture en base.`);
  const fallback = normalized.positions.filter(p => p.rateReference === 'general');
  if (fallback.length) console.log(`Taux de la fiche générale en repli (année non précisée) : ${fallback.map(p => p.name).join(', ')}.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Préparation impossible.'); process.exitCode = 1; });
