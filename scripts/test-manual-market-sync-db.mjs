import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['tests/sql/bootstrap.sql', 'supabase/schema.sql',
  'supabase/migrations/001_market.sql',
  'supabase/migrations/20261117091351_manual_market_sync.sql',
  'tests/sql/manual-market-sync.sql'];
const sql = 'create role service_role nologin bypassrls;\n' + files.map(file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
// Base jetable uniquement : aucun réseau, port ou secret utilisateur.
const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--user', 'postgres',
  '--interactive', '--entrypoint', 'sh', 'postgres:17.6-alpine', '-c',
  'initdb -D /tmp/manual-sync-db -A trust > /dev/null && pg_ctl -D /tmp/manual-sync-db -o "-k /tmp -c listen_addresses=" -w start > /dev/null && psql -h /tmp -U postgres -v ON_ERROR_STOP=1'],
{ input: sql, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
