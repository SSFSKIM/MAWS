// The local hub, one command: `pnpm --filter desk-hub local` (from the worktree root). It starts `wrangler dev` with the
// Worker and its Durable Objects on workerd, configured to verify assertions from, and mint service tokens through,
// the stand-in for Access (./standin.ts), and puts the stand-in's proxy in front of it. Clients — DC4's daemon, DC5's
// web app, curl — talk to the proxy's URL only, as they will talk to Access in front of the deployed hub.
//
//   --port <n>      the proxy's port (default 8747; 8787, wrangler's own default, is often taken); wrangler dev listens on the next one, on 127.0.0.1 only
//   --user <email>  who a request with no other identity is signed in as (default owner@example.com, the org's admin);
//                   --user '' makes such a request refused, as Access refuses it
//   --heartbeat-ms <n>  the machine stream's heartbeat (default 2000; the deployed hub's is 15000). wrangler dev's own
//                   proxy closes its hop to the hub gracefully, so a machine's close reaches the hub at the next write to
//                   its stream: this bounds how long a dropped machine stays online here (test/stream-close.test.ts)
//   --state <dir>   where state is kept (default apps/desk-hub/.wrangler); a suite passes a directory of its own
//
// State survives restarts: the Worker's objects in <state>/state (wrangler's), the stand-in's signing key and the
// service tokens it minted in <state>/standin.json, the hub's VAPID key in <state>/vapid.json. Delete the directory to
// start from nothing.
import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { codeHelpers } from './helpers.ts';
import { startProxy } from './proxy.ts';
import { AccessStandin, IDENTITY_HEADER, type StandinState } from './standin.ts';

const app = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: { port: { type: 'string', default: '8747' }, user: { type: 'string', default: 'owner@example.com' }, state: { type: 'string', default: join(app, '.wrangler') }, 'heartbeat-ms': { type: 'string', default: '2000' } },
});
const stateDir = resolve(values.state);
const port = Number(values.port);
const hubPort = port + 1;
const origin = `http://127.0.0.1:${port}`;
const ORG = 'local';
const ADMIN = 'owner@example.com';

// macOS lets 127.0.0.1:<port> be bound beside a listener on the wildcard address, so a taken port would not fail the
// bind: clients could reach the other server. Refuse a port something already answers on.
for (const taken of [port, hubPort]) {
  const answers = await new Promise<boolean>((done) => {
    const socket = connect({ host: '127.0.0.1', port: taken }, () => (socket.destroy(), done(true)));
    socket.on('error', () => done(false));
  });
  if (answers) {
    console.error(`port ${taken} is in use; pass --port <n> (the hub takes n and n + 1)`);
    process.exit(1);
  }
}

// wrangler refuses a configured assets directory that does not exist; the web app (DC5) may not be built yet.
mkdirSync(resolve(app, '../desk-web/dist'), { recursive: true });

const statePath = join(stateDir, 'standin.json');
mkdirSync(dirname(statePath), { recursive: true });
const standin = await AccessStandin.create({
  issuer: `${origin}/standin`,
  audience: 'desk-local',
  account: 'local',
  defaultUser: values.user || undefined,
  state: existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as StandinState) : undefined,
  persist: (state) => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 }),
});

// The hub's VAPID key for Web Push: generated on the first run and kept beside the stand-in's state (git-ignored, never
// committed), since a browser's push subscription is bound to the key it subscribed with.
const vapidPath = join(stateDir, 'vapid.json');
if (!existsSync(vapidPath)) {
  const pair = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const { kty, crv, x, y, d } = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  writeFileSync(vapidPath, JSON.stringify({ kty, crv, x, y, d }), { mode: 0o600 });
}

const vars: Record<string, string> = {
  ORG_ID: ORG,
  ORG_NAME: 'Local org',
  ORG_ADMIN_EMAIL: ADMIN,
  ACCESS_ISSUER: standin.issuer,
  ACCESS_AUD: standin.audience,
  ACCESS_CERTS_URL: `${origin}/standin/certs`,
  CF_API_URL: `${origin}/standin/client/v4`,
  CF_ACCOUNT_ID: standin.account,
  CF_API_TOKEN: standin.apiToken,
  VAPID_KEY: readFileSync(vapidPath, 'utf8'),
  HEARTBEAT_MS: values['heartbeat-ms'],
};
const wranglerBin = join(dirname(createRequire(import.meta.url).resolve('wrangler/package.json')), 'bin', 'wrangler.js');
const wrangler = spawn(
  process.execPath,
  [
    wranglerBin,
    'dev',
    '--ip',
    '127.0.0.1',
    '--port',
    String(hubPort),
    '--persist-to',
    join(stateDir, 'state'),
    '--show-interactive-dev-session=false',
    ...Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`]),
  ],
  { cwd: app, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
);

const proxy = await startProxy({
  standin,
  upstream: () => `http://127.0.0.1:${hubPort}`,
  port,
  // Conveniences for a machine-side developer with no web app: an enrollment code and a provisioning code as the browser
  // would build them.
  extra: codeHelpers({ origin: () => origin, org: ORG, standin, admin: ADMIN }),
});

const stop = async () => {
  wrangler.kill('SIGTERM');
  await proxy.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
wrangler.on('exit', (code) => {
  console.error(`wrangler dev exited (${code}); stopping the stand-in`);
  void proxy.close().then(() => process.exit(code ?? 1));
});

console.log(`
The local hub, behind its stand-in for Access: ${proxy.url}
  (wrangler dev on http://127.0.0.1:${hubPort}; talk to ${proxy.url} only)

  org ${ORG}; admin ${ADMIN}; a machine's stream beats every ${values['heartbeat-ms']} ms (deployed: 15000)
  a request with no identity is ${standin.defaultUser ? `signed in as ${standin.defaultUser}` : 'refused, as Access refuses it'}
  another person:  header ${IDENTITY_HEADER}: <email>, or a browser at ${proxy.url}/standin/login?email=<email>
  a machine:       CF-Access-Client-Id / CF-Access-Client-Secret from its enrollment, as with Access

  an enrollment code for machine <name> (a fresh org key unless you pass one):
    curl -s -X POST ${proxy.url}/standin/enrollment-code -d '{"machine": "<name>"}'
  then on the machine: sminos hub enroll, and paste the code at its hidden prompt (never an argument: it carries
    the org key); it redeems at ${proxy.url}/machine/enroll

  a provisioning code for machines named <prefix>… (a reusable key; also label, ttl_s, max_uses, offline_revoke_s, key):
    curl -s -X POST ${proxy.url}/standin/provisioning-code -d '{"prefix": "dc-", "offline_revoke_s": 3600}'
  then on each machine: printf %s "$CODE" | sminos hub enroll --name dc-<machine>
`);
