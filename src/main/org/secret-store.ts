// The provisioning code's custody (P5 O8 M4c, docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, M4c's "The
// create transaction" steps 1, 4 and 5, "The destination" and "gcloud"; the refresh's item 14; P5 Decision Log 75 (1)):
// a new delegation's code goes from main straight into Secret Manager, as a new version of the secret the owner named
// (`provisioning-secret.json`, provisioning-secret-store.ts), through this machine's gcloud. It is never displayed, put
// on the clipboard, written to disk, logged or sent to the renderer: it is written to one child's stdin and nowhere else
// (not argv, not the environment, not an error, not this module's log), and it travels inside main as a
// `ProvisioningCode`, whose every printing is a placeholder.
//
// A GUI app's PATH lacks Homebrew, so gcloud is resolved explicitly: the login shell's PATH (the engine's captured
// environment, read asynchronously), then the usual install places. Each call has a timeout, and each answer is one of
// three outcomes: not attempted (gcloud never ran, or nothing it could change was asked), failed (a read-only call that
// didn't succeed, or a `versions add` that never held the whole code or that Secret Manager refused before announcing a
// creation), or may have succeeded (any other `versions add` that didn't name its version and exit 0). The confirmation reads the version's metadata (`versions describe`), never
// its value: nothing here calls `versions access`.
//
// Electron-free: vitest's node project runs it, against a fake `gcloud` first on an injected PATH.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ProvisioningSecretSchema, type ProvisioningSecret } from '@shared/ipc/schema/org';

/**
 * A step's answer: its value, or why not and whether gcloud may have changed anything (refresh item 14). `version`: the
 * version gcloud announced creating before it failed (`addVersion` alone), so a "may have succeeded" can name it.
 */
export type StoreResult<T> = { ok: true; value: T } | { ok: false; outcome: StoreOutcome; detail: string; version?: string };
export type StoreOutcome = 'not-attempted' | 'failed' | 'may-have-succeeded';

/** Where gcloud is, and the PATH its child runs with (gcloud's launcher finds its Python on it). */
export type Gcloud = { path: string; PATH: string };

/** How gcloud is found: the login shell's PATH (null when it has none, or none was captured), then `fallbacks`. */
export type GcloudLookup = { loginPath(): Promise<string | null | undefined>; home: string; fallbacks?: readonly string[] };

/** The SecretStore's dependencies: the resolver (called at each step), a one-line log, and each call's bound. */
export type SecretStoreDeps = { gcloud(): Promise<StoreResult<Gcloud>>; log(line: string): void; timeoutMs?: number };

export interface SecretStore {
  /**
   * The create transaction's step 1: `gcloud auth print-access-token --account <account>` exits 0 (its output, a token,
   * is never read), then `gcloud secrets describe <secret> --project <project> --account <account>` exits 0. A failure
   * names what's missing in one line: gcloud not found, not signed in as that account, no such secret, no permission.
   */
  preflight(dest: ProvisioningSecret, signal?: AbortSignal): Promise<StoreResult<null>>;
  /**
   * Step 4: `gcloud secrets versions add <secret> --project <project> --account <account> --data-file=-`, the code on
   * stdin alone. The version is read from gcloud's own words on stderr (`Created version [N] of the secret [S].`). The
   * code is revealed only as the child starts, straight onto its stdin; a holder dropped before then runs nothing.
   */
  addVersion(dest: ProvisioningSecret, code: ProvisioningCode, signal?: AbortSignal): Promise<StoreResult<{ version: string }>>;
  /**
   * Step 5: `gcloud secrets versions describe <version> --secret <secret> --project <project> --account <account>
   * --format=json`, read for `name`, `state` (it must be `ENABLED`) and `createTime`. It changes nothing, so it never
   * answers "may have succeeded".
   */
  describeVersion(dest: ProvisioningSecret, version: string, signal?: AbortSignal): Promise<StoreResult<VersionMetadata>>;
}
// Every step takes its caller's `signal`: aborted before the step runs gcloud, nothing runs (not attempted); aborted
// while its child runs, the child's process group is killed and its stdin destroyed, and the step answers at once.

export type VersionMetadata = { name: string; state: 'ENABLED'; createTime: string };

/** What every printing of a `ProvisioningCode` shows. */
const WITHHELD = '[provisioning code withheld]';

/**
 * The code, held so a stray log, template, JSON or inspect prints a placeholder: only `reveal()` gives the code, which
 * `addVersion` writes to the child's stdin. Its owner `drop()`s it when the code is no longer needed (its run ended, or
 * the write answered): the holder lets go of the code, and `reveal()` throws from then on.
 */
export class ProvisioningCode {
  #code: string | null;
  constructor(code: string) {
    this.#code = code;
  }
  reveal(): string {
    if (this.#code === null) throw new Error('the provisioning code was dropped');
    return this.#code;
  }
  drop(): void {
    this.#code = null;
  }
  get dropped(): boolean {
    return this.#code === null;
  }
  toString(): string {
    return WITHHELD;
  }
  toJSON(): string {
    return WITHHELD;
  }
  [Symbol.toPrimitive](): string {
    return WITHHELD;
  }
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return WITHHELD;
  }
}

/** Where gcloud lives when the login shell's PATH doesn't name it: Homebrew on Apple silicon, on Intel, Google's installer. */
export const gcloudFallbacks = (home: string): string[] => ['/opt/homebrew/bin', '/usr/local/bin', join(home, 'google-cloud-sdk', 'bin')];

const NOT_FOUND = 'secret-store: gcloud not found';
/** A step whose caller ended (its signal aborted, or the code's holder dropped) before gcloud ran. */
const ENDED = 'secret-store: its caller ended before gcloud ran';
/** Each call's bound, unless the deps say otherwise. */
const TIMEOUT_MS = 60_000;
/**
 * Every child's environment over the inherited one: prompts off, so nothing it asks reads the code as an answer; HTTP
 * logging and file logging off, so neither a machine's `core/log_http` nor its log files can keep the request body
 * that carries the code. Environment variables override `gcloud config set` values (gcloud's "Managing properties").
 */
const GCLOUD_ENV = { CLOUDSDK_CORE_DISABLE_PROMPTS: '1', CLOUDSDK_CORE_LOG_HTTP: 'false', CLOUDSDK_CORE_DISABLE_FILE_LOGGING: 'true' } as const;
/**
 * A refusal Secret Manager answers before it stores anything, as gcloud prints it (`ERROR: (gcloud.…) CODE: …`).
 */
const REFUSED_BEFORE_WRITE = /^ERROR: \(gcloud[^)]*\) (NOT_FOUND|PERMISSION_DENIED|INVALID_ARGUMENT|FAILED_PRECONDITION|UNAUTHENTICATED):/m;
/** How long after gcloud's exit its streams may stay open (a helper it left behind holding them) before it answers. */
const LINGER_MS = 1_000;
/** The shortest run of the code that marks a line as holding it (the code is base64url, so a run this long is its). */
const CODE_RUN = 16;
/** The most of a stream kept, for the version name and an error line. */
const STREAM_CAP = 64 * 1024;
/** The most characters an error line carries out. */
const LINE_MAX = 200;
/** A version's id as Secret Manager numbers it. */
const VERSION = /^[1-9][0-9]{0,18}$/;

async function executable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK);
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * gcloud, found first in the login shell's PATH (the child then runs with that PATH), else in `fallbacks` (default
 * `gcloudFallbacks(home)`) in order, its directory put first on the login PATH, or on this process's when there is none.
 * None found: `secret-store: gcloud not found`, not attempted.
 */
export async function resolveGcloud(lookup: GcloudLookup): Promise<StoreResult<Gcloud>> {
  const loginPath = (await lookup.loginPath()) || null;
  for (const dir of (loginPath ?? '').split(':')) {
    if (dir !== '' && (await executable(join(dir, 'gcloud')))) return { ok: true, value: { path: join(dir, 'gcloud'), PATH: loginPath! } };
  }
  for (const dir of lookup.fallbacks ?? gcloudFallbacks(lookup.home)) {
    if (await executable(join(dir, 'gcloud'))) return { ok: true, value: { path: join(dir, 'gcloud'), PATH: `${dir}:${loginPath ?? process.env.PATH ?? '/usr/bin:/bin'}` } };
  }
  return { ok: false, outcome: 'not-attempted', detail: NOT_FOUND };
}

/** A child's ending: it never started, or it ended (by its own exit, a signal, or this module's timeout). */
type Ran =
  | { started: false; detail: string }
  | { started: true; code: number | null; signal: NodeJS.Signals | null; timedOut: boolean; aborted: boolean; stdinClosed: boolean; stdout: string; stderr: string };

/**
 * gcloud with `args`, `stdin()` written and closed (an empty stdin closed at once; it is called as the child starts, and
 * its answer is kept nowhere else), under `GCLOUD_ENV` (prompts and gcloud's own logging off). Its process group is
 * killed at `timeoutMs`, or once `signal` aborts (which answers at once, the child's streams destroyed). `keepStdout:
 * false` drains stdout unread (an access token).
 */
function run(gcloud: Gcloud, args: string[], options: { stdin?: () => string; keepStdout: boolean; timeoutMs: number; signal?: AbortSignal }): Promise<Ran> {
  return new Promise((resolve) => {
    if (options.signal?.aborted === true) {
      resolve({ started: false, detail: ENDED });
      return;
    }
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(gcloud.path, args, { env: { ...process.env, PATH: gcloud.PATH, ...GCLOUD_ENV }, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    } catch (error) {
      resolve({ started: false, detail: (error as Error).message });
      return;
    }
    let [stdout, stderr, timedOut, aborted, stdinClosed, settled] = ['', '', false, false, false, false];
    const keep = (sofar: string, chunk: Buffer) => (sofar.length >= STREAM_CAP ? sofar : (sofar + chunk.toString('utf8')).slice(0, STREAM_CAP));
    child.stdout!.on('data', (chunk: Buffer) => void (options.keepStdout && (stdout = keep(stdout, chunk))));
    child.stderr!.on('data', (chunk: Buffer) => void (stderr = keep(stderr, chunk)));
    // A child that exits before reading stdin breaks the pipe: that is its exit's to report, and its stdin never closed
    // whole (`end`'s callback is also its error's).
    child.stdin!.on('error', () => {});
    child.stdin!.end(options.stdin?.() ?? '', (error?: Error | null) => void (stdinClosed = error == null));
    const killGroup = () => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, options.timeoutMs);
    let lingering: NodeJS.Timeout | undefined;
    const finish = (ran: () => Ran) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(lingering);
      options.signal?.removeEventListener('abort', abort);
      resolve(ran());
    };
    const ended = (code: number | null, signal: NodeJS.Signals | null) => () => ({ started: true as const, code, signal, timedOut, aborted, stdinClosed, stdout, stderr });
    // The caller's run ended: the child goes now, its stdin's buffer (the code, for an add) destroyed with its streams.
    function abort() {
      aborted = true;
      killGroup();
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        stream?.removeAllListeners('data');
        stream?.destroy();
      }
      finish(ended(null, 'SIGKILL'));
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => finish(() => ({ started: false, detail: error.message })));
    // `close`, once both streams are drained, so the version name and the metadata are read whole; but a helper gcloud
    // left behind holding the pipes must not hold the answer, so its exit answers `LINGER_MS` later in any case. That
    // answer ends what's left: the streams destroyed (stdin's buffer, the code, with them), their handlers dropped, and
    // the process group killed, so nothing of the call outlives it.
    child.on('close', (code, signal) => finish(ended(code, signal)));
    child.on('exit', (code, signal) => {
      lingering = setTimeout(() => {
        finish(ended(code, signal));
        for (const stream of [child.stdin, child.stdout, child.stderr]) {
          stream?.removeAllListeners('data');
          stream?.destroy();
        }
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          // the group is gone already
        }
      }, LINGER_MS);
    });
  });
}

/**
 * gcloud's one error line: its first `ERROR:` line, else its last non-empty one, printable and bounded. `withhold`, the
 * code, is never carried out: a line holding it, or any run of it `CODE_RUN` long, is replaced.
 */
function errorLine(stderr: string, withhold?: string): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const line = lines.find((l) => l.startsWith('ERROR:')) ?? lines.at(-1) ?? 'no error text';
  if (withhold !== undefined && holdsCode(line, withhold.trim())) return '(its words held the code, so they are withheld)';
  const printable = line.replace(/[^\x20-\x7e]/g, '?');
  return printable.length > LINE_MAX ? `${printable.slice(0, LINE_MAX)}…` : printable;
}

function holdsCode(line: string, code: string): boolean {
  if (code.length <= CODE_RUN) return code !== '' && line.includes(code);
  for (let at = 0; at + CODE_RUN <= code.length; at++) if (line.includes(code.slice(at, at + CODE_RUN))) return true;
  return false;
}

const seconds = (ms: number) => `${Math.round(ms / 100) / 10} s`;

export function secretStore(deps: SecretStoreDeps): SecretStore {
  const timeoutMs = deps.timeoutMs ?? TIMEOUT_MS;

  /** The destination in its grammar and gcloud found, or why nothing ran. */
  async function ready(dest: ProvisioningSecret): Promise<StoreResult<Gcloud>> {
    if (!ProvisioningSecretSchema.safeParse(dest).success) return { ok: false, outcome: 'not-attempted', detail: 'secret-store: the destination is not a project, a secret and an account in their grammar' };
    return deps.gcloud();
  }

  /** A refusal, logged in its one line (which never holds the code or a token). */
  function refuse<T>(outcome: StoreOutcome, detail: string): StoreResult<T> {
    deps.log(`${detail} (${outcome})`);
    return { ok: false, outcome, detail };
  }

  /** A read-only call's failure: it never started (not attempted), or ended without an answer (failed). */
  function unanswered<T>(ran: Ran, what: string): StoreResult<T> | null {
    if (!ran.started) return refuse('not-attempted', `secret-store: gcloud could not start: ${ran.detail}`);
    if (ran.aborted) return refuse('failed', `secret-store: ${what} was stopped: its caller ended`);
    if (ran.timedOut) return refuse('failed', `secret-store: ${what} did not answer in ${seconds(timeoutMs)}`);
    if (ran.code === null) return refuse('failed', `secret-store: ${what} ended by ${ran.signal}`);
    return null;
  }

  return {
    async preflight(dest, signal) {
      const found = await ready(dest);
      if (!found.ok) return found;
      if (signal?.aborted === true) return refuse('not-attempted', ENDED);
      const { project, secret, account } = dest;
      const token = await run(found.value, ['auth', 'print-access-token', '--account', account], { keepStdout: false, timeoutMs, signal });
      const tokenFailure = unanswered<null>(token, 'gcloud auth print-access-token');
      if (tokenFailure !== null) return tokenFailure;
      if (token.started && token.code !== 0) return refuse('failed', `secret-store: gcloud is not signed in as ${account} (gcloud auth login ${account})`);
      const described = await run(found.value, ['secrets', 'describe', secret, '--project', project, '--account', account], { keepStdout: false, timeoutMs, signal });
      const describeFailure = unanswered<null>(described, 'gcloud secrets describe');
      if (describeFailure !== null) return describeFailure;
      if (described.started && described.code !== 0) {
        if (described.stderr.includes('NOT_FOUND')) return refuse('failed', `secret-store: no secret ${secret} in project ${project}`);
        if (described.stderr.includes('PERMISSION_DENIED')) return refuse('failed', `secret-store: ${account} may not read secret ${secret} in project ${project}`);
        return refuse('failed', `secret-store: gcloud secrets describe failed: ${errorLine(described.stderr)}`);
      }
      deps.log(`secret-store: ${account} is signed in and secret ${secret} exists in project ${project}`);
      return { ok: true, value: null };
    },

    async addVersion(dest, code, signal) {
      const found = await ready(dest);
      if (!found.ok) return found;
      if (code.dropped || signal?.aborted === true) return refuse('not-attempted', ENDED);
      const { project, secret, account } = dest;
      const ran = await run(found.value, ['secrets', 'versions', 'add', secret, '--project', project, '--account', account, '--data-file=-'], { stdin: () => code.reveal(), keepStdout: true, timeoutMs, signal });
      if (!ran.started) return refuse('not-attempted', `secret-store: gcloud could not start: ${ran.detail}`);
      // Its error line is held against the code while the holder still holds it; once dropped, its words are withheld.
      const plain = code.dropped ? null : code.reveal();
      const named = /Created version \[([^\]\s]+)\] of the secret \[([^\]\s]+)\]/.exec(`${ran.stderr}\n${ran.stdout}`);
      const announced = named !== null && VERSION.test(named[1]) ? named[1] : null;
      if (ran.code !== 0 || ran.timedOut) {
        // Failed only when nothing could have been stored: gcloud never held the whole code, or Secret Manager refused it
        // before any creation was announced. Any other ending (a timeout, a signal, an error after the request went out,
        // gcloud's "created, but the checksum could not be confirmed") may have stored it, with the version if announced.
        const refusedFirst = announced === null && REFUSED_BEFORE_WRITE.test(ran.stderr);
        const outcome = !ran.stdinClosed || refusedFirst ? 'failed' : 'may-have-succeeded';
        const why = ran.aborted
          ? 'was stopped: its caller ended'
          : ran.timedOut
            ? `did not answer in ${seconds(timeoutMs)}`
            : ran.code === null
              ? `ended by ${ran.signal}`
              : `failed: ${plain === null ? '(its words withheld: the code was dropped)' : errorLine(ran.stderr, plain)}`;
        const answer = refuse<{ version: string }>(outcome, `secret-store: gcloud secrets versions add ${why}${announced === null ? '' : ` (it announced version ${announced})`}`);
        return !answer.ok && announced !== null && outcome === 'may-have-succeeded' ? { ...answer, version: announced } : answer;
      }
      if (announced === null) return refuse('may-have-succeeded', 'secret-store: gcloud secrets versions add exited 0 but named no version');
      deps.log(`secret-store: version ${announced} of secret ${secret} added in project ${project}`);
      return { ok: true, value: { version: announced } };
    },

    async describeVersion(dest, version, signal) {
      if (!VERSION.test(version)) return refuse('not-attempted', 'secret-store: the version is not a version number');
      const found = await ready(dest);
      if (!found.ok) return found;
      if (signal?.aborted === true) return refuse('not-attempted', ENDED);
      const { project, secret, account } = dest;
      const ran = await run(found.value, ['secrets', 'versions', 'describe', version, '--secret', secret, '--project', project, '--account', account, '--format=json'], { keepStdout: true, timeoutMs, signal });
      const failure = unanswered<VersionMetadata>(ran, 'gcloud secrets versions describe');
      if (failure !== null) return failure;
      if (ran.started && ran.code !== 0) return refuse('failed', `secret-store: gcloud secrets versions describe failed: ${errorLine(ran.stderr)}`);
      let meta: unknown;
      try {
        meta = JSON.parse(ran.started ? ran.stdout : '');
      } catch {
        meta = null;
      }
      const { name, state, createTime } = (typeof meta === 'object' && meta !== null ? meta : {}) as Record<string, unknown>;
      if (typeof name !== 'string' || !name.endsWith(`/secrets/${secret}/versions/${version}`) || typeof state !== 'string' || typeof createTime !== 'string') {
        return refuse('failed', `secret-store: gcloud secrets versions describe answered no metadata for version ${version} of secret ${secret}`);
      }
      if (state !== 'ENABLED') return refuse('failed', `secret-store: version ${version} of secret ${secret} is ${errorLine(state)}, not ENABLED`);
      deps.log(`secret-store: version ${version} of secret ${secret} is ENABLED, created ${errorLine(createTime)}`);
      return { ok: true, value: { name, state, createTime } };
    },
  };
}
