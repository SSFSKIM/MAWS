// `deployment deploy`: puts the hub on the owner's account behind Access, in an order that never leaves it reachable
// unguarded — Access's applications and policies first, then the Worker with its variables, then its two secrets (until
// both are in, the Worker answers 503 to everything). Every step is idempotent: a second run updates Access in place,
// redeploys the Worker, and puts a secret only when the Worker lacks it, so the VAPID key that push subscriptions are
// bound to survives every later deploy.
//
// Tokens come from the environment, never an argument or a file of the repository:
//   CF_ACCESS_SETUP_TOKEN       Access: apps and policies edit, service tokens edit, organizations read
//   CF_DESK_HUB_SERVICE_TOKENS  service tokens edit only; becomes the Worker's CF_API_TOKEN secret
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { generateVapidKey } from '../src/push/web-push';
import { accessPlan, cfApi, reconcileAccess } from './access';
import { deployVars, readDeployConfig, type DeployConfig } from './config';

/** The app's directory, which bin.ts defines for the bundle it runs (read when used, so a suite can set it). */
const appDir = () => process.env.DESK_HUB_APP!;

/**
 * Credentials the commands take: from the environment, or as `NAME=value` lines on stdin (so they reach no process's
 * arguments). A command reads stdin only when it is not a terminal.
 */
export async function readSecrets(): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  for (const name of SECRET_NAMES) out[name] = process.env[name] || undefined;
  if (process.stdin.isTTY) return out;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
    const at = line.indexOf('=');
    const name = line.slice(0, at);
    if (at > 0 && SECRET_NAMES.includes(name) && line.length > at + 1) out[name] = line.slice(at + 1).trim();
  }
  return out;
}

/** The setup token, the hub's service-token API token, and a person's Access token (`cloudflared access token`). */
export const SECRET_NAMES = ['CF_ACCESS_SETUP_TOKEN', 'CF_DESK_HUB_SERVICE_TOKENS', 'DESK_ACCESS_TOKEN'];

/** Runs wrangler from the app's directory; resolves with its stdout, `input` written to its stdin. */
export function wrangler(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = join(dirname(createRequire(join(appDir(), 'package.json')).resolve('wrangler/package.json')), 'bin', 'wrangler.js');
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: appDir(),
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CF_ACCESS_SETUP_TOKEN: '', CF_DESK_HUB_SERVICE_TOKENS: '' },
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stdin.end(input ?? '');
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`wrangler ${args[0]} ${args[1] ?? ''} exited ${code}`))));
  });
}

export type DeployOptions = {
  accessOnly?: boolean;
  putApiToken?: boolean;
  assets?: string;
  /** What the web build is, for the build's name (`smns-erb-web@0fa05392`, say). */
  web?: string;
  /** Appended to the build's name: a redeploy that must be a new version of the code says why. */
  buildSuffix?: string;
  quiet?: boolean;
};

/** The build's name, which every Worker answer carries as `X-Desk-Build`: the hub's commit (`+dirty` when its tree
 * differs from it), and the web build's when one is named. */
export function buildName(options: DeployOptions): string {
  const git = (...args: string[]) => execFileSync('git', ['-C', appDir(), ...args], { encoding: 'utf8' }).trim();
  const dirty = git('status', '--porcelain', '--', '.') !== '';
  return [`hub@${git('rev-parse', '--short=8', 'HEAD')}${dirty ? '+dirty' : ''}`, options.web && `web@${options.web}`, options.buildSuffix].filter(Boolean).join(' ');
}

/** Parses the options every command that deploys shares: the config, the org, the web build. */
export function deployArgs(argv: string[], extra: ParseArgsOptionsConfig = {}) {
  const values = parseArgs({
    args: argv,
    options: {
      config: { type: 'string', default: join(appDir(), 'deploy', 'config.json') },
      'org-id': { type: 'string' },
      'org-name': { type: 'string' },
      assets: { type: 'string' },
      web: { type: 'string' },
      ...extra,
    },
  }).values as Record<string, string | boolean | undefined>;
  const config = readDeployConfig(values.config as string);
  if (values['org-id']) config.org.id = values['org-id'] as string;
  if (values['org-name']) config.org.name = values['org-name'] as string;
  return { config, values };
}

export async function main(argv: string[]): Promise<number> {
  const { config, values } = deployArgs(argv, {
    'access-only': { type: 'boolean', default: false },
    'put-api-token': { type: 'boolean', default: false },
  });
  const secrets = await readSecrets();
  if (!secrets.CF_ACCESS_SETUP_TOKEN || (!values['access-only'] && !secrets.CF_DESK_HUB_SERVICE_TOKENS)) {
    console.error('CF_ACCESS_SETUP_TOKEN and CF_DESK_HUB_SERVICE_TOKENS, in the environment or on stdin (deploy/README.md)');
    return 2;
  }
  await deployHub(config, secrets, {
    accessOnly: values['access-only'] as boolean,
    putApiToken: values['put-api-token'] as boolean,
    assets: values.assets as string | undefined,
    web: values.web as string | undefined,
  });
  return 0;
}

/** Access, then the Worker, then its missing secrets. */
export async function deployHub(config: DeployConfig, secrets: Record<string, string | undefined>, options: DeployOptions = {}): Promise<void> {
  const log = options.quiet ? () => {} : console.log;
  // 1. Access, before anything is deployed behind it.
  const api = cfApi(secrets.CF_ACCESS_SETUP_TOKEN!, config.account);
  const organization = await api.request<{ auth_domain?: string }>('GET', '/access/organizations');
  if (!organization.auth_domain) throw new Error('the account has no Zero Trust organization: finish its onboarding first');
  const issuer = `https://${organization.auth_domain}`;
  const access = await reconcileAccess(
    api,
    accessPlan({ name: config.worker, host: config.host, ownerEmail: config.ownerEmail, sessionDuration: config.sessionDuration }),
  );
  log(`Access: applications ${Object.keys(access.apps).join(', ')} in place; team ${issuer}; AUD ${access.aud}`);
  if (options.accessOnly) return;

  // 2. The Worker, with its variables on the command line (wrangler.jsonc's stay empty), and the web app's build:
  // apps/desk-web/dist as wrangler.jsonc names it, or a build made elsewhere (--assets).
  if (!options.assets) mkdirSync(join(appDir(), '..', 'desk-web', 'dist'), { recursive: true });
  else if (!existsSync(join(options.assets, 'index.html'))) throw new Error(`${options.assets} holds no web build (no index.html)`);
  const vars = deployVars(config, { issuer, aud: access.aud });
  const assets = options.assets ? ['--assets', options.assets] : [];
  const build = buildName(options);
  log(await wrangler(['deploy', ...assets, '--define', `DESK_BUILD:${JSON.stringify(build)}`, ...Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`])]));
  log(`deployed ${config.worker} to https://${config.host} (org ${config.org.id}), build "${build}"`);

  // 3. Its secrets, each put only when missing (CF_API_TOKEN again with --put-api-token, to rotate it).
  const present = new Set((JSON.parse(await wrangler(['secret', 'list', '--format', 'json'])) as Array<{ name: string }>).map((s) => s.name));
  if (!present.has('CF_API_TOKEN') || options.putApiToken) {
    if (!secrets.CF_DESK_HUB_SERVICE_TOKENS) throw new Error('CF_DESK_HUB_SERVICE_TOKENS is needed to put CF_API_TOKEN');
    await wrangler(['secret', 'put', 'CF_API_TOKEN'], secrets.CF_DESK_HUB_SERVICE_TOKENS);
    log('put CF_API_TOKEN');
  }
  if (!present.has('VAPID_KEY')) {
    await wrangler(['secret', 'put', 'VAPID_KEY'], await generateVapidKey());
    log('put VAPID_KEY (generated; never written anywhere else)');
  }
}
