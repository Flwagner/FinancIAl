import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = ['tests/sql/bootstrap.sql', 'supabase/schema.sql',
  'supabase/migrations/20261116141044_boursosync.sql',
   'supabase/migrations/20261116142947_remove_boursosync_cash.sql',
   'supabase/migrations/20261116145852_boursosync_extension_only.sql',
   'tests/sql/boursosync.sql', 'tests/sql/boursosync-extension.sql'];
const sql = files.map(file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')).join('\n');
// Aucun port, réseau, secret, montage de données ni connexion Supabase.
// Le conteneur et sa base sont supprimés automatiquement à la fin.
const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--user', 'postgres',
  '--interactive', '--entrypoint', 'sh', 'postgres:17.6-alpine', '-c',
  'initdb -D /tmp/boursosync-db -A trust > /dev/null && pg_ctl -D /tmp/boursosync-db -o "-k /tmp -c listen_addresses=" -w start > /dev/null && psql -h /tmp -U postgres -v ON_ERROR_STOP=1'],
{ input: sql, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
