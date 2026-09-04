// Opt-in real PostgreSQL regression runner. It NEVER accepts a DB URL or uses
// linked Supabase credentials: every run creates its own loopback-only cluster.
// Install embedded-postgres@17.6.0-beta.15 and pg into a separate npm prefix,
// then run: node tools/test-db-contention.mjs <absolute-prefix-directory>
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dependencyPrefix = process.argv[2];
assert.ok(dependencyPrefix && path.isAbsolute(dependencyPrefix), 'An isolated absolute npm prefix is required');
const requireRuntime = createRequire(path.join(dependencyPrefix, 'package.json'));
const { Client } = requireRuntime('pg');
const nativeName = process.platform === 'win32' ? 'windows' : process.platform;
const binaries = await import(pathToFileURL(requireRuntime.resolve(`@embedded-postgres/${nativeName}-${process.arch}`)).href);
const execFileAsync = promisify(execFile);
const scratch = await mkdtemp(path.join(tmpdir(), '63world-contention-test-'));
const databaseDir = path.join(scratch, 'cluster');
console.log(`Isolated synthetic-data cluster: ${scratch}`);

const portReservation = net.createServer();
portReservation.listen(0, '127.0.0.1');
await once(portReservation, 'listening');
const port = portReservation.address().port;
await new Promise(resolve => portReservation.close(resolve));
const config = {
  host: '127.0.0.1', port, user: 'postgres', database: 'postgres', password: 'local-test-only',
  connectionTimeoutMillis: 5000, statement_timeout: 15000, application_name: '63world-isolated-regression'
};
const clients = new Set();
async function connect() {
  const client = new Client(config);
  await client.connect();
  clients.add(client);
  client.once('end', () => clients.delete(client));
  return client;
}
let server;
let output = '';
try {
  await execFileAsync(binaries.initdb, [
    '-D', databaseDir, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C'
  ], { windowsHide: true, timeout: 60000 });
  server = spawn(binaries.postgres, [
    '-D', databaseDir, '-p', String(port), '-h', '127.0.0.1',
    '-c', 'max_connections=80', '-c', 'deadlock_timeout=100ms',
    '-c', 'wal_level=logical', '-c', 'log_min_messages=warning'
  ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { output += chunk; });
  server.stderr.on('data', chunk => { output += chunk; });
  let admin;
  const readyBy = Date.now() + 15000;
  while (!admin && Date.now() < readyBy) {
    try { admin = await connect(); }
    catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(admin, `Local PostgreSQL failed to start: ${output}`);
  const version = (await admin.query('select version()')).rows[0].version;
  console.log(version);
  assert.match(version, /PostgreSQL 17\./);
  // Minimal Supabase platform fixtures; application tables/functions below are
  // the actual historical migrations, not JavaScript/store mocks.
  await admin.query(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create schema extensions;
    create schema realtime;
    create table auth.users (
      id uuid primary key, email text, raw_app_meta_data jsonb default '{}'::jsonb,
      raw_user_meta_data jsonb default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    grant usage on schema auth, extensions to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table realtime.messages(id bigint, extension text, topic text);
    create function realtime.topic() returns text language sql stable as
      $$ select current_setting('realtime.topic', true) $$;
    create publication supabase_realtime;
  `);
  const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
  const files = (await readdir(migrationsDir)).filter(file => file.endsWith('.sql')).sort();
  let applied = 0;
  for (const file of files) {
    // pg_cron is Supabase-managed, not present in this native Windows runtime.
    // New patches are applied by their tests AFTER reproducing the old bug.
    if (file.startsWith('20260904') || file.includes('lunch_server_schedule')) continue;
    try { await admin.query(await readFile(path.join(migrationsDir, file), 'utf8')); }
    catch (error) { throw new Error(`Migration ${file}: ${error.message}`, { cause: error }); }
    applied++;
  }
  console.log(`Applied ${applied} unchanged historical migrations (pg_cron schedule excluded).`);
  console.log('Historical function body fingerprints:', JSON.stringify((await admin.query(`
    select p.proname as function_name, md5(regexp_replace(p.prosrc, '\\s+', ' ', 'g')) as body_hash
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('private_heartbeat_raid_room_v1','private_publish_raid_round_v1',
      'private_ack_raid_question_ready_v1','sync_world_presence_v1','sync_world_presence_v2',
      'sync_world_presence_v3','sync_world_presence_v4','private_enforce_world_channel_capacity_v1')
    order by p.proname
  `)).rows));
  if (!process.argv.includes('--bootstrap-only')) {
    if (!process.argv.includes('--world-only')) {
      const { runRaidLockTests } = await import('./test-raid-lock-postgres.mjs');
      await runRaidLockTests({ connect, admin, repoRoot });
    }
    if (!process.argv.includes('--raid-only')) {
      const { runWorldLockTests } = await import('./test-world-lock-postgres.mjs');
      await runWorldLockTests({ connect, admin, repoRoot });
    }
  }
  console.log('All requested isolated PostgreSQL checks passed. Production was not contacted.');
} finally {
  await Promise.all([...clients].map(client => client.end().catch(() => {})));
  if (server && server.exitCode === null) {
    await execFileAsync(binaries.pg_ctl, ['-D', databaseDir, '-m', 'fast', '-w', '-t', '15', 'stop'],
      { windowsHide: true, timeout: 20000 });
  }
  console.log(`Test PostgreSQL stopped; synthetic cluster files retained at ${scratch}`);
}
