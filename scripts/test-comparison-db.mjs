import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['tests/sql/bootstrap.sql', 'supabase/schema.sql',
  'supabase/migrations/001_market.sql',
  'supabase/migrations/20261113085126_push_sync_impact.sql',
  'supabase/migrations/20261113094822_daily_return_reference.sql',
  'supabase/migrations/20261114120000_latest_actual_reading.sql',
  'supabase/migrations/20261116093305_notify_unchanged_returns.sql',
  'supabase/migrations/20261116152534_reweight_daily_comparison.sql',
  'tests/sql/push-security.sql', 'tests/sql/daily-reference.sql', 'tests/sql/comparison-market.sql'];
const sql = files.map(file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
// Base jetable uniquement : aucun réseau, port ou secret utilisateur.
const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--user', 'postgres',
  '--interactive', '--entrypoint', 'sh', 'postgres:17.6-alpine', '-c',
  'initdb -D /tmp/comparison-db -A trust > /dev/null && pg_ctl -D /tmp/comparison-db -o "-k /tmp -c listen_addresses=" -w start > /dev/null && psql -h /tmp -U postgres -v ON_ERROR_STOP=1'],
{ input: sql, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
