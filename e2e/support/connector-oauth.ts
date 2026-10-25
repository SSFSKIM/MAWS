// P3-HD M4a: the scene-side support of the toy OAuth fixture (./connector-oauth-server.mjs, its logic in
// ./connector-oauth-core.mjs). A scene configures the fixture's one MCP URL for its engine and for MAWS alike, and keeps
// the phase discipline of P3-HD Decision Log 23 through this module:
// - the fixture starts, and returns, in the open phase, which advertises no authorization; `assertOpenPhase` before
//   any engine starts or re-observes it;
// - `enterOAuthPhase` only with the pids of every engine that observed it, after their exit: it refuses while any is
//   alive, so no engine sees a 401 or metadata;
// - `enterOpenPhase` before a cold engine re-observation.
// Each control write bumps `seq`, so `summarizeOAuthLog` counts every phase window apart: requests, what was advertised,
// tools/call attempts and answers per token generation, registrations, code exchanges, refreshes and revocations.
// `scanForSecrets` checks texts a scene would retain against what the fixture saw or minted, reporting kinds only; the
// secrets file itself, like the raw open log (./connector-oauth-browser.ts), is never retained.
// P4-AGG M1 (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md): an engine mode, for the engine's own
// sign-in. `startOAuthFixture({ mode: 'engine' })` starts in the OAuth phase with no engine-PID gate, since the engine is
// what signs in, and registers the engine's callbacks (`http://localhost:<port>/callback` and the `127.0.0.1` one).
// `engineKeychainCustody` owns the one Keychain item the engine's secure storage writes for the scene's scratch
// configuration directory. The MAWS mode above keeps every safeguard it has.
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  OPEN_CONTROL, parseOAuthControl,
  type OAuthFixtureMode, type OAuthAdvertise, type OAuthControl, type OAuthLogEntry, type OAuthPhase, type OAuthRoute, type OAuthSecret, type OAuthSecretKind,
} from './connector-oauth-core.mjs';
import { isAlive } from './processes';
import { assertEngineKeychainEnv, assertNoKeychainPrompt, SECURITY_MS, securityAgentRunning, type PromptProbe } from './keychain-guard';

export const OAUTH_SERVER = join(__dirname, 'connector-oauth-server.mjs');

export interface OAuthFixturePaths {
  id: string;
  log: string;
  control: string;
  secrets: string; // 0600; never retained
}

export function oauthFixturePaths(root: string, id: string): OAuthFixturePaths {
  return { id, log: join(root, `oauth-${id}.jsonl`), control: join(root, `oauth-${id}-control.json`), secrets: join(root, `oauth-${id}-secrets.jsonl`) };
}

export interface OAuthFixture extends OAuthFixturePaths {
  mode: OAuthFixtureMode; // P4-AGG M1
  origin: string; // http://127.0.0.1:<port>, also the issuer
  resourceUrl: string; // <origin>/mcp: the URL a scene configures
  pid: number;
  close(): Promise<void>;
}

// The fixture process, in the open phase (engine mode: the OAuth phase); it lives until `close`, so its grants outlast
// an app relaunch.
export async function startOAuthFixture(options: { root: string; id: string; tools?: readonly string[]; mode?: OAuthFixtureMode }): Promise<OAuthFixture> {
  const mode = options.mode ?? 'maws'; // P4-AGG M1
  const paths = oauthFixturePaths(options.root, options.id);
  if (mode === 'engine') writeControl(paths, { ...OPEN_CONTROL, seq: existsSync(paths.control) ? readControl(paths).seq + 1 : 0, phase: 'oauth' }); // P4-AGG M1: the engine signs in, so no gate
  else if (existsSync(paths.control)) enterOpenPhase(paths); // a restart in the same scene opens a new window
  else writeControl(paths, OPEN_CONTROL);
  const child = spawn(process.execPath, [OAUTH_SERVER, '--id', paths.id, '--log', paths.log, '--control', paths.control, '--secrets', paths.secrets, '--tools', JSON.stringify(options.tools ?? ['read_series']), '--mode', mode], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const port = await new Promise<number>((resolve, reject) => {
    child.stdout!.once('data', (chunk: Buffer) => resolve((JSON.parse(chunk.toString('utf8').split('\n')[0]!) as { port: number }).port));
    child.once('exit', (code) => reject(new Error(`the OAuth fixture ${paths.id} exited (${code})`)));
  });
  const origin = `http://127.0.0.1:${port}`;
  return {
    ...paths,
    mode,
    origin,
    resourceUrl: `${origin}/mcp`,
    pid: child.pid!,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
      await exited;
      clearTimeout(timer);
    },
  };
}

export function readControl(paths: Pick<OAuthFixturePaths, 'control'>): OAuthControl {
  return parseOAuthControl(existsSync(paths.control) ? readFileSync(paths.control, 'utf8') : null);
}

// Whole-file replacement, so the fixture never reads a partial control (which it would take as the open phase).
function writeControl(paths: Pick<OAuthFixturePaths, 'control'>, control: OAuthControl): OAuthControl {
  const text = JSON.stringify(control);
  const parsed = parseOAuthControl(text);
  const same = (Object.keys(OPEN_CONTROL) as (keyof OAuthControl)[]).every((key) => parsed[key] === control[key]) && JSON.stringify(parsed.advertise) === JSON.stringify(control.advertise);
  if (!same) throw new Error(`not a valid OAuth fixture control: ${text}`);
  const temporary = `${paths.control}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, paths.control);
  return control;
}

const next = (paths: Pick<OAuthFixturePaths, 'control'>, change: Partial<Omit<OAuthControl, 'seq'>>) => {
  const current = readControl(paths);
  return writeControl(paths, { ...current, ...change, seq: current.seq + 1 });
};

export interface OAuthPhaseOptions {
  alive?: (pid: number) => boolean;
  accessTtlSeconds?: number;
  revocation?: OAuthControl['revocation'];
  advertise?: OAuthAdvertise; // P3-HD panel correction: the trust-binding scene's overrides
}

// The OAuth phase, for MAWS alone: every engine that observed the fixture must be named, and gone.
export function enterOAuthPhase(paths: Pick<OAuthFixturePaths, 'control'>, proof: { enginePids: readonly number[] }, options: OAuthPhaseOptions = {}): OAuthControl {
  const alive = options.alive ?? isAlive;
  if (proof.enginePids.length === 0) throw new Error('enterOAuthPhase: no engine was named; the OAuth phase follows a confirmed engine exit (P3-HD Decision Log 23)');
  for (const pid of proof.enginePids) if (alive(pid)) throw new Error(`enterOAuthPhase: engine ${pid} is still alive; no engine may see the OAuth phase (P3-HD Decision Log 23)`);
  return next(paths, { phase: 'oauth', ...(options.accessTtlSeconds !== undefined && { accessTtlSeconds: options.accessTtlSeconds }), ...(options.revocation !== undefined && { revocation: options.revocation }), ...(options.advertise !== undefined && { advertise: options.advertise }) });
}

export function enterOpenPhase(paths: Pick<OAuthFixturePaths, 'control'>): OAuthControl {
  return next(paths, { phase: 'open' });
}

// The access-token lifetime (stamped at issuance) and revocation availability, in whichever phase is current.
export function updateOAuthControl(paths: Pick<OAuthFixturePaths, 'control'>, change: Partial<Pick<OAuthControl, 'accessTtlSeconds' | 'revocation'>>): OAuthControl {
  return next(paths, change);
}

// Before an engine starts or observes the fixture.
export function assertOpenPhase(paths: Pick<OAuthFixturePaths, 'control'>): void {
  const control = readControl(paths);
  if (control.phase !== 'open') throw new Error(`the OAuth fixture is in its OAuth phase (window ${control.seq}); return it to the open phase before an engine observes it (P3-HD Decision Log 23)`);
}

export type OAuthLogLine = OAuthLogEntry & { at: string; pid: number };

// Complete lines only: a line the fixture is still appending is left for the next read.
function jsonLines(path: string): unknown[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').slice(0, -1).filter(Boolean).map((line) => JSON.parse(line) as unknown);
}

// This fixture's request entries, from its own log or one it shares with other servers.
export function readOAuthLog(paths: Pick<OAuthFixturePaths, 'id' | 'log'>): OAuthLogLine[] {
  return jsonLines(paths.log).filter((line): line is OAuthLogLine => (line as OAuthLogLine).event === 'http' && (line as OAuthLogLine).server === paths.id);
}

export interface OAuthCounts {
  requests: number;
  byRoute: Partial<Record<OAuthRoute, number>>;
  advertised: number; // answers that advertised authorization: 401s and metadata documents
  unauthorized: number; // 401s
  authRoutes: number; // requests to any authorization route, answered or not
  authorizationHeaders: number; // MCP requests presenting an Authorization header
  mcp: Record<string, number>; // JSON-RPC methods answered (200/202)
  toolCallAttempts: number; // tools/call requests received, answered or refused
  toolCalls: number; // tools/call requests answered
  toolCallsByToken: Record<string, number>; // answered, by the access token's hash
  toolCallsByGeneration: Record<string, number>; // answered, by `<family>.<generation>`
  rejectedBearers: Partial<Record<OAuthLogEntry['bearer'], number>>; // what a 401 answered
  presentedBearers: string[]; // hashes of every Bearer value MCP requests presented, each once: issued here or not
  registrations: number;
  authorizations: number; // codes issued
  codeExchanges: number;
  refreshes: number;
  revocations: number;
  revocationsUnavailable: number;
  refusals: Record<string, number>; // by the fixture's reason
  issued: NonNullable<OAuthLogEntry['issued']>[];
}
export interface OAuthWindow extends OAuthCounts {
  seq: number;
  phase: OAuthPhase;
}
export interface OAuthSummary {
  windows: OAuthWindow[]; // one per control write the fixture served under, in order
  open: OAuthCounts;
  oauth: OAuthCounts;
}

const AUTH_ROUTES = new Set<OAuthRoute>(['resourceMetadata', 'serverMetadata', 'register', 'authorize', 'token', 'revoke']);

function counts(): OAuthCounts {
  return {
    requests: 0, byRoute: {}, advertised: 0, unauthorized: 0, authRoutes: 0, authorizationHeaders: 0, mcp: {}, toolCallAttempts: 0, toolCalls: 0, toolCallsByToken: {}, toolCallsByGeneration: {},
    rejectedBearers: {}, presentedBearers: [], registrations: 0, authorizations: 0, codeExchanges: 0, refreshes: 0, revocations: 0, revocationsUnavailable: 0, refusals: {}, issued: [],
  };
}

const bump = <K extends string>(record: Partial<Record<K, number>>, key: K) => { record[key] = (record[key] ?? 0) + 1; };

function add(into: OAuthCounts, entry: OAuthLogEntry): void {
  into.requests += 1;
  bump(into.byRoute, entry.route);
  if (entry.advertised) into.advertised += 1;
  if (entry.status === 401) into.unauthorized += 1;
  if (AUTH_ROUTES.has(entry.route)) into.authRoutes += 1;
  if (entry.error !== undefined) bump(into.refusals, entry.error);
  if (entry.issued !== undefined) into.issued.push(entry.issued);
  if (entry.route === 'mcp') {
    if (entry.bearer !== 'none') into.authorizationHeaders += 1;
    if (entry.bearerHash !== undefined && !into.presentedBearers.includes(entry.bearerHash)) into.presentedBearers.push(entry.bearerHash);
    if (entry.status === 401) bump(into.rejectedBearers, entry.bearer);
    const answered = entry.status === 200 || entry.status === 202;
    if (answered && entry.method !== null) bump(into.mcp, entry.method);
    if (entry.method === 'tools/call') {
      into.toolCallAttempts += 1;
      if (entry.status === 200) {
        into.toolCalls += 1;
        if (entry.token !== undefined) {
          bump(into.toolCallsByToken, entry.token.hash);
          bump(into.toolCallsByGeneration, `${entry.token.family}.${entry.token.generation}`);
        }
      }
    }
  }
  if (entry.route === 'register' && entry.status === 201) into.registrations += 1;
  if (entry.route === 'authorize' && entry.status === 302 && entry.error === undefined) into.authorizations += 1;
  if (entry.route === 'token' && entry.status === 200) {
    if (entry.grant === 'authorization_code') into.codeExchanges += 1;
    else into.refreshes += 1;
  }
  if (entry.route === 'revoke' && entry.revoked !== undefined) into.revocations += 1;
  if (entry.route === 'revoke' && entry.status === 503) into.revocationsUnavailable += 1;
}

export function summarizeOAuthLog(entries: readonly OAuthLogEntry[]): OAuthSummary {
  const windows: OAuthWindow[] = [];
  const byPhase = { open: counts(), oauth: counts() };
  for (const entry of entries) {
    let window = windows.at(-1);
    if (window === undefined || window.seq !== entry.seq) {
      window = { seq: entry.seq, phase: entry.phase, ...counts() };
      windows.push(window);
    }
    add(window, entry);
    add(byPhase[entry.phase], entry);
  }
  return { windows, ...byPhase };
}

export interface SecretScan {
  clean: boolean;
  found: Partial<Record<OAuthSecretKind, number>>; // how many texts carry a secret of each kind; never a value
}

// Every state, PKCE challenge and verifier, code and token the fixture saw or minted, checked against each text as written
// and URL-encoded.
export function scanForSecrets(paths: Pick<OAuthFixturePaths, 'secrets'>, texts: readonly string[]): SecretScan {
  if (!existsSync(paths.secrets)) throw new Error('scanForSecrets: the fixture recorded no secrets yet, so a scan could not fail');
  const secrets = (jsonLines(paths.secrets) as OAuthSecret[]).filter((secret) => secret.value.length > 0);
  const found: SecretScan['found'] = {};
  for (const text of texts) {
    const kinds = new Set(secrets.filter((secret) => text.includes(secret.value) || text.includes(encodeURIComponent(secret.value))).map((secret) => secret.kind));
    for (const kind of kinds) bump(found, kind);
  }
  return { clean: Object.keys(found).length === 0, found };
}

// ---- P4-AGG M1: the engine's Keychain item ------------------------------------------------------------------------

// The service name of the one Keychain item the engine's secure storage uses for `configDir` (the spec's fact 2,
// confirmed against 2.1.309: cli.pretty.js 318187 to 318190, `Claude Code${OAUTH_FILE_SUFFIX}-credentials-` and the
// first 8 hex of sha256 of the config directory, which 1245553 takes from CLAUDE_CONFIG_DIR as given, NFC-normalised).
// `engineEnv` is the engine's environment: the two variables that would make it name another item are refused.
export function engineKeychainService(configDir: string, engineEnv: Record<string, string | undefined> = {}): string {
  return `Claude Code-credentials-${engineKeychainSuffix(configDir, engineEnv)}`;
}

// fixB (b): the engine's other item for the same directory, its API key (`vj()` without a suffix: 447233, 827443), which
// it looks up too; claimed absent alongside, so the engine reads no item that existed before the run.
export function engineApiKeyService(configDir: string, engineEnv: Record<string, string | undefined> = {}): string {
  return `Claude Code-${engineKeychainSuffix(configDir, engineEnv)}`;
}

function engineKeychainSuffix(configDir: string, engineEnv: Record<string, string | undefined>): string {
  if (configDir === '') throw new Error('engineKeychainService: no configuration directory');
  for (const name of ['CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_CODE_CUSTOM_OAUTH_URL']) {
    if (engineEnv[name] !== undefined) throw new Error(`engineKeychainService: the engine runs with ${name}, under which it names another item`);
  }
  return createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8);
}

// fixB (a): the only names a custody may ever pass to `security`: an item derived from a scratch directory, never the
// owner's bare credentials item nor any other.
const DERIVED = /^Claude Code(-credentials)?-[0-9a-f]{8}$/;

// `security <verb> -s <service>`'s exit status: 0 found (or deleted), 44 (errSecItemNotFound) not found, anything else
// a failure that establishes nothing. Bounded (fixB (c)): a dialog would hold the call, so it is cut short and fails.
export type SecurityCommand = (args: readonly string[]) => number;
const systemSecurity: SecurityCommand = (args) => {
  try {
    execFileSync('/usr/bin/security', [...args], { stdio: 'ignore', timeout: SECURITY_MS });
    return 0;
  } catch (error) {
    const status = (error as { status?: number | null }).status;
    if (typeof status === 'number') return status;
    throw error;
  }
};

const ITEM_NOT_FOUND = 44; // `security`'s exit status for errSecItemNotFound

export interface EngineKeychainCustody {
  readonly service: string; // the credential item
  readonly services: readonly string[]; // every item the engine names for the directory: the credential, the API key
  // Before the engine can store anything: every item must be absent, so whatever is there later is this run's.
  claim(): void;
  // After every engine that ran under the directory has exited (their pids; none when none ran): deletes exactly the
  // claimed items that are there and verifies them gone. Nothing else is ever looked up or removed.
  release(proof: { enginePids: readonly number[] }): { service: string; found: boolean; deleted: boolean };
}

export interface EngineKeychainCustodyOptions {
  scratchRoot: string; // fixB (a): the run's own scratch directory, which `configDir` must lie inside
  engineEnv: Record<string, string | undefined>; // the engine's environment: it must name `configDir` and nothing else
  security?: SecurityCommand;
  alive?: (pid: number) => boolean;
  promptPending?: PromptProbe; // fixB (c): SecurityAgent by default
}

export function engineKeychainCustody(configDir: string, options: EngineKeychainCustodyOptions): EngineKeychainCustody {
  const root = resolve(options.scratchRoot);
  const inside = relative(root, resolve(configDir));
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) throw new Error(`engineKeychainCustody: ${configDir} is not inside the run's scratch ${options.scratchRoot}`);
  if (resolve(configDir) === resolve(homedir(), '.claude') || root === resolve(homedir())) throw new Error(`engineKeychainCustody: ${configDir} is the owner's configuration, not a scratch one`);
  assertEngineKeychainEnv(options.engineEnv, configDir, 'engineKeychainCustody');
  const service = engineKeychainService(configDir, options.engineEnv);
  const services = [service, engineApiKeyService(configDir, options.engineEnv)];
  const run = options.security ?? systemSecurity;
  const alive = options.alive ?? isAlive;
  const probe = options.promptPending ?? securityAgentRunning;
  // fixB (a)(b): every call names one of this directory's derived items, by `-s` alone: an existence lookup (no `-w`, no
  // `-g`: no password or attribute is printed) or the deletion of a claimed item. (c): no prompt before or after it.
  const security = (verb: 'find-generic-password' | 'delete-generic-password', name: string) => {
    if (!services.includes(name) || !DERIVED.test(name)) throw new Error(`engineKeychainCustody: refusing to name "${name}" to security`);
    assertNoKeychainPrompt(`before security ${verb}`, probe);
    const status = run([verb, '-s', name]);
    assertNoKeychainPrompt(`after security ${verb}`, probe);
    return status;
  };
  // Fail closed: only the item-not-found status means absent; any other lookup failure throws.
  const present = (name: string) => {
    const status = security('find-generic-password', name);
    if (status === 0) return true;
    if (status === ITEM_NOT_FOUND) return false;
    throw new Error(`could not look up the Keychain item "${name}" (security exited ${status})`);
  };
  const remove = (name: string) => {
    if (!present(name)) return false;
    const status = security('delete-generic-password', name);
    if (status !== 0) throw new Error(`could not delete the Keychain item "${name}" (security exited ${status})`);
    if (present(name)) throw new Error(`the Keychain item "${name}" is still in the Keychain after its deletion`);
    return true;
  };
  let claimed = false;
  return {
    service,
    services,
    claim() {
      for (const name of services) if (present(name)) throw new Error(`the Keychain item "${name}" exists before the run; it is not this run's to delete`);
      claimed = true;
    },
    release({ enginePids }) {
      if (!claimed) throw new Error(`the Keychain item "${service}" was never claimed by this run`);
      for (const pid of enginePids) if (alive(pid)) throw new Error(`engine ${pid} is still alive; the Keychain item "${service}" is released only after every engine has exited`);
      const deleted = remove(service);
      remove(services[1]!);
      return { service, found: deleted, deleted };
    },
  };
}
