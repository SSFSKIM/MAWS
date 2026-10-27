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
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { generateVapidKey } from '../src/push/web-push';
import { accessPlan, cfApi, reconcileAccess } from './access';
import { checkTarget, deployVars, readDeployConfig, type DeployConfig } from './config';

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

/** The setup token, the hub's service-token API token, a person's Access token (`cloudflared access token`), and an
 * enrolled machine's service token (`access-sync` reads the org state as a machine). */
export const SECRET_NAMES = ['CF_ACCESS_SETUP_TOKEN', 'CF_DESK_HUB_SERVICE_TOKENS', 'DESK_ACCESS_TOKEN', 'DESK_MACHINE_CLIENT_ID', 'DESK_MACHINE_CLIENT_SECRET'];

/** A wrangler call: its stdout, `input` written to its stdin, `env` added to its environment. */
export type WranglerRun = (args: string[], input?: string, env?: Record<string, string>) => Promise<string>;

/** What wrangler inherits from the tool's environment: what locates the system, the login and the network. Wrangler
 * reads much else from its environment (wrangler 4.151): WRANGLER_CI_OVERRIDE_NAME renames the Worker outright,
 * CLOUDFLARE_ENV picks a config section, CLOUDFLARE_ACCOUNT_ID / _API_TOKEN / _API_BASE_URL and WRANGLER_API_ENVIRONMENT
 * another account, credential or API, WRANGLER_LOG_* where and how its logs go; none of it is passed on. */
const INHERITED_ENV = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'XDG_CONFIG_HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS'];

/** Wrangler's environment: the allow-listed part of `inherited`, then `set`, then what is never left to either. A
 * `secret put` carries a credential in its request, so logs stay sanitized and none is written to disk. */
export function wranglerEnv(inherited: Record<string, string | undefined>, set: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED_ENV) if (inherited[name] !== undefined) env[name] = inherited[name]!;
  return { ...env, ...set, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_WRITE_LOGS: 'false' };
}

/** Runs wrangler from the app's directory, in `wranglerEnv`. */
export const wrangler: WranglerRun = (args, input, env) => {
  return new Promise((resolve, reject) => {
    const bin = join(dirname(createRequire(join(appDir(), 'package.json')).resolve('wrangler/package.json')), 'bin', 'wrangler.js');
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: appDir(),
      stdio: ['pipe', 'pipe', 'inherit'],
      env: wranglerEnv(process.env, env),
    });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stdin.end(input ?? '');
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`wrangler ${args[0]} ${args[1] ?? ''} exited ${code}`))));
  });
};

/** The flags with which a wrangler call would choose its Worker, configuration or login itself: its name, an
 * environment (which suffixes a secret command's name), another wrangler config, directory or .env file, another auth
 * profile. */
const TARGET_FLAGS = ['--name', '--env', '-e', '--config', '-c', '--cwd', '--env-file', '--profile'];

/** A build tool's redirect, beside wrangler.jsonc, which hands wrangler another configuration. */
const DEPLOY_REDIRECT = join('.wrangler', 'deploy', 'config.json');

/**
 * Wrangler, held to the config's Worker and account. Every call is given `--name <config.worker>`, wrangler.jsonc by
 * path, an empty .env (`--env-file /dev/null`: wrangler otherwise loads .env and .env.local from its directory into
 * its environment) and, through `wranglerEnv`, the config's account and nothing inherited that could name another.
 * Refused, before anything runs:
 * - a config whose Worker is not the one its host names (`<worker>.<subdomain>.workers.dev`), which would deploy one
 *   Worker under another's Access;
 * - an app whose wrangler.jsonc sets another `account_id` (wrangler prefers it to CLOUDFLARE_ACCOUNT_ID) or that holds
 *   a deploy redirect;
 * - a call bringing its own target flag.
 * Without this a staging config pushes its variables onto the Worker wrangler.jsonc names, the production `desk-hub`.
 * Each call prints the target it checked.
 */
export function workerWrangler(config: DeployConfig, run: WranglerRun = wrangler, print: (line: string) => void = console.log) {
  checkTarget(config, 'deploy');
  const wranglerConfig = join(appDir(), 'wrangler.jsonc');
  const { account_id: account } = JSON.parse(readFileSync(wranglerConfig, 'utf8').replace(/^\s*\/\/.*$/gm, '')) as { account_id?: string };
  if (account !== undefined && account !== config.account) throw new Error(`wrangler.jsonc sets account_id ${account}, not ${config.account}: refusing to deploy`);
  if (existsSync(join(appDir(), DEPLOY_REDIRECT))) throw new Error(`${join(appDir(), DEPLOY_REDIRECT)} would redirect wrangler to another configuration: refusing to deploy`);
  return (args: string[], input?: string): Promise<string> => {
    const chooser = args.find((arg) => TARGET_FLAGS.includes(arg.split('=')[0]));
    if (chooser) return Promise.reject(new Error(`wrangler ${args[0]}: ${chooser} would choose the Worker; the config names it (${config.worker})`));
    const named = [...args, '--name', config.worker, '--config', wranglerConfig, '--env-file', '/dev/null'];
    const target = named[named.lastIndexOf('--name') + 1];
    if (target !== config.worker) return Promise.reject(new Error(`wrangler ${args[0]} would act on ${target}, not ${config.worker}`));
    print(`wrangler target ${target} (config worker ${config.worker}, account ${config.account}): ${args.slice(0, args[0] === 'secret' ? 3 : 1).join(' ')}`);
    return run(named, input, { CLOUDFLARE_ACCOUNT_ID: config.account });
  };
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
  const parsed = parseArgs({
    args: argv,
    options: {
      config: { type: 'string', multiple: true, default: [join(appDir(), 'deploy', 'config.json')] },
      'org-id': { type: 'string' },
      'org-name': { type: 'string' },
      assets: { type: 'string' },
      web: { type: 'string' },
      ...extra,
    },
  }).values as Record<string, string | string[] | boolean | undefined>;
  // parseArgs keeps the last of a repeated option; a deploy names its deployment once.
  const configs = parsed.config as string[];
  if (configs.length > 1) throw new Error(`--config given ${configs.length} times (${configs.join(', ')}): name one deployment`);
  const values = { ...parsed, config: configs[0] } as Record<string, string | boolean | undefined>;
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

/** What `deployHub` reaches the account through: wrangler and Cloudflare's API (suites pass fakes). */
export type DeployIo = { wrangler: WranglerRun; fetch: typeof fetch };

/** The target check, then Access, then the Worker, then its missing secrets. */
export async function deployHub(
  config: DeployConfig,
  secrets: Record<string, string | undefined>,
  options: DeployOptions = {},
  io: DeployIo = { wrangler, fetch },
): Promise<void> {
  const log = options.quiet ? () => {} : console.log;
  // 0. The Worker every wrangler call will act on, checked before anything is changed.
  const worker = workerWrangler(config, io.wrangler);
  // 1. Access, before anything is deployed behind it.
  const api = cfApi(secrets.CF_ACCESS_SETUP_TOKEN!, config.account, io.fetch);
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
  log(await worker(['deploy', ...assets, '--define', `DESK_BUILD:${JSON.stringify(build)}`, ...Object.entries(vars).flatMap(([name, value]) => ['--var', `${name}:${value}`])]));
  log(`deployed ${config.worker} to https://${config.host} (org ${config.org.id}), build "${build}"`);

  // 3. Its secrets, each put only when missing (CF_API_TOKEN again with --put-api-token, to rotate it).
  const present = new Set((JSON.parse(await worker(['secret', 'list', '--format', 'json'])) as Array<{ name: string }>).map((s) => s.name));
  if (!present.has('CF_API_TOKEN') || options.putApiToken) {
    if (!secrets.CF_DESK_HUB_SERVICE_TOKENS) throw new Error('CF_DESK_HUB_SERVICE_TOKENS is needed to put CF_API_TOKEN');
    await worker(['secret', 'put', 'CF_API_TOKEN'], secrets.CF_DESK_HUB_SERVICE_TOKENS);
    log('put CF_API_TOKEN');
  }
  if (!present.has('VAPID_KEY')) {
    await worker(['secret', 'put', 'VAPID_KEY'], await generateVapidKey());
    log('put VAPID_KEY (generated; never written anywhere else)');
  }
}
