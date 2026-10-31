// Send to Google Drive's driver of the owner's own Google Workspace CLI (`gws`, npm @googleworkspace/cli 0.22.5). The
// rule it keeps: MAWS holds no Google credential and stores nothing of its own. The CLI signs in, keeps and refreshes
// its own state; this module finds it on the owner's PATH, reads `gws auth status`, runs `gws auth login` (opening only
// the accounts.google.com URL the CLI prints) and `gws drive files create` for one file, under exactly the environment
// it is given. No shell, stdin closed (so the login never shows its terminal scope picker), each run leading its own
// process group: the npm package's shim runs the native binary as its child, so a cancel or a deadline signals the
// whole group, and a call that stopped a run settles only once the group is gone.
//
// Status mapping (auth_commands.rs `handle_status`): a `token_env_var` source is ready whatever else is saved; no saved
// sign-in (`auth_method` none) is needsSetup without a client (`credential_source` none) and signedOut with one; a saved
// sign-in the token endpoint refused (`token_valid` false) is expired; otherwise ready, or noDrive when the granted
// `scopes` are known and none is drive or drive.file. With the token endpoint or tokeninfo unreachable the status
// carries no `token_valid` or no `scopes`: ready, and the upload speaks for itself.
//
// Upload only from a `ready` state: past its own sign-in the CLI's credential chain (auth.rs) falls through to gcloud's
// application-default credentials, which `auth status` never reports, so a signed-out upload can succeed as another
// identity (a service account's own Drive) instead of failing with `auth`. P4-B5: so the upload's environment also names
// a GOOGLE_APPLICATION_CREDENTIALS file that does not exist (NO_ADC), which the chain treats as a hard error (auth.rs 4a)
// rather than reaching the well-known file: an upload goes as the CLI's own sign-in or not at all, even when that
// sign-in vanishes between the state's read and the upload. It names no credential. A saved sign-in the CLI cannot
// decrypt (`encryption_valid` false) is `expired`: its next API call would delete it and fall through the same way.
// P4-B5 review: the chain's first file step, GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE (a plaintext file, a service account
// allowed), outranks the CLI's own sign-in and `auth status` never names its identity, so every run here is given the
// environment without it (`ownSignIn`): the state read, the login and the upload all speak of the CLI's own sign-in.
import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access, realpath, stat } from 'node:fs/promises';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { setTimeout as sleep } from 'node:timers/promises';

export type GwsState =
  | { state: 'absent' } // no executable gws on the PATH
  | { state: 'needsSetup' } // no OAuth client configured: credential_source 'none' and no saved sign-in
  | { state: 'signedOut' } // a client configured, no saved sign-in (auth_method 'none')
  | { state: 'expired'; message?: string } // a saved sign-in the token endpoint refused (token_valid false)
  | { state: 'noDrive'; user?: string; scopes: string[] } // signed in, but no granted scope covers Drive (drive or drive.file)
  | { state: 'ready'; user?: string; scopes?: string[] } // signed in (or token_env_var), Drive covered or scopes unknown
  | { state: 'failed'; why: 'timeout' | 'unreadable' | 'spawn'; message?: string }; // the status could not be read

export type GwsLoginResult = { ok: true; account?: string } | { ok: false; why: 'refused' | 'cancelled' | 'timeout' | 'failed'; message?: string };

export type GwsUploadResult =
  | { ok: true; id: string; name: string; link?: string }
  | { ok: false; why: 'auth' | 'notFound' | 'forbidden' | 'api' | 'discovery' | 'invalid' | 'cancelled' | 'timeout' | 'failed'; message?: string };

export const GWS_STATUS_TIMEOUT_MS = 30_000; // `auth status` refreshes the token and may ask gcloud for the project's APIs
export const GWS_LOGIN_DEADLINE_MS = 5 * 60_000; // a refused consent never ends the 0.22.5 login on its own
export const GWS_UPLOAD_TIMEOUT_MS = 10 * 60_000;
const KILL_GRACE_MS = 2_000; // SIGTERM to SIGKILL
const GONE_WAIT_MS = 3_000; // after SIGKILL, for the group to leave the process table
const OUTPUT_CAP_BYTES = 1024 * 1024; // per stream
const MESSAGE_CHARS = 300;
// P4-B5: a credentials path that never exists, so the CLI's chain stops at its own sign-in (the header above)
export const NO_ADC = '/nonexistent/maws-uses-gws-sign-in-only.json';
const DRIVE_SCOPES = new Set(['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file']);
const EXIT = { api: 1, auth: 2, validation: 3, discovery: 4 } as const; // google-workspace error.rs
const GOOGLE_URL = /(?<!\S)https:\/\/accounts\.google\.com\/[^\s"'<>\\\p{Cc}]*/gu; // a whole token, never one inside another URL

export async function findGws(env: Readonly<Record<string, string>>): Promise<string | null> {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!isAbsolute(dir)) continue; // an empty or relative entry names a working directory, not an install
    const candidate = join(dir, 'gws');
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // absent or not executable here
    }
  }
  return null;
}

// Rejects with the signal's reason when `signal` aborts (the state union has no cancelled member).
export async function readGwsState(
  bin: string,
  env: Readonly<Record<string, string>>,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<GwsState> {
  opts.signal?.throwIfAborted();
  const run = await runGws(bin, ['auth', 'status'], env, { signal: opts.signal, timeoutMs: opts.timeoutMs ?? GWS_STATUS_TIMEOUT_MS });
  switch (run.end.kind) {
    case 'spawn':
      return { state: 'failed', why: 'spawn', message: bounded(run.end.message) };
    case 'timeout':
      return { state: 'failed', why: 'timeout' };
    case 'abort':
      opts.signal?.throwIfAborted();
      throw new Error('gws auth status was stopped');
    case 'stopped':
      return { state: 'failed', why: 'unreadable', message: run.end.message };
    case 'exit':
      if (run.end.code !== 0) return { state: 'failed', why: 'unreadable', message: cliMessage(run) };
      return gwsStateFromStatus(run.stdout);
  }
}

// `gws auth status`'s stdout to a state; the object may follow noise lines.
export function gwsStateFromStatus(stdout: string): GwsState {
  const status = outermostObject(stdout);
  if (status === null) return { state: 'failed', why: 'unreadable', message: 'gws auth status printed no JSON object' };
  const method = status.auth_method;
  const source = status.credential_source;
  if (typeof method !== 'string' || typeof source !== 'string') {
    return { state: 'failed', why: 'unreadable', message: 'gws auth status named no auth_method or credential_source' };
  }
  if (source === 'token_env_var') return { state: 'ready' }; // GOOGLE_WORKSPACE_CLI_TOKEN outranks any saved sign-in
  if (method === 'none') return source === 'none' ? { state: 'needsSetup' } : { state: 'signedOut' };
  if (method !== 'oauth2') return { state: 'failed', why: 'unreadable', message: bounded(`gws auth status named an unknown auth_method "${method}"`) };
  if (status.encryption_valid === false) return { state: 'expired', message: bounded(typeof status.encryption_error === 'string' ? status.encryption_error : 'gws could not decrypt its saved sign-in') }; // P4-B5
  if (status.token_valid === false) {
    return typeof status.token_error === 'string' && status.token_error.trim() !== ''
      ? { state: 'expired', message: bounded(status.token_error) }
      : { state: 'expired' };
  }
  const user = typeof status.user === 'string' && status.user !== '' ? { user: status.user } : {};
  if (!Array.isArray(status.scopes)) return { state: 'ready', ...user };
  const scopes = status.scopes.filter((scope): scope is string => typeof scope === 'string');
  return scopes.some((scope) => DRIVE_SCOPES.has(scope)) ? { state: 'ready', ...user, scopes } : { state: 'noDrive', ...user, scopes };
}

export async function gwsLogin(
  bin: string,
  env: Readonly<Record<string, string>>,
  opts: { scopes?: readonly string[]; openUrl(url: string): void | Promise<void>; signal: AbortSignal; deadlineMs?: number },
): Promise<GwsLoginResult> {
  if (opts.signal.aborted) return { ok: false, why: 'cancelled' };
  const args = ['auth', 'login', ...(opts.scopes === undefined ? ['-s', 'drive'] : ['--scopes', opts.scopes.join(',')])];
  let opened = false;
  const run = await runGws(bin, args, env, {
    signal: opts.signal,
    timeoutMs: opts.deadlineMs ?? GWS_LOGIN_DEADLINE_MS,
    // Complete lines only, so a URL split across two writes is never opened cut short.
    lines(text, stop) {
      if (opened) return;
      const url = googleUrl(text);
      if (url === null) return;
      opened = true;
      // a throw or a rejection alike: the page did not open, and the login stops saying so
      void Promise.resolve()
        .then(() => opts.openUrl(url))
        .catch((error: unknown) => stop(bounded(`could not open the sign-in page: ${messageOf(error)}`)));
    },
  });
  switch (run.end.kind) {
    case 'spawn':
      return { ok: false, why: 'failed', message: bounded(run.end.message) };
    case 'abort':
      return { ok: false, why: 'cancelled' };
    case 'timeout':
      return { ok: false, why: 'timeout' };
    case 'stopped':
      return { ok: false, why: 'failed', message: run.end.message };
    case 'exit': {
      if (run.end.code === 0) {
        const done = outermostObject(run.stdout);
        if (done?.status !== 'success') return { ok: false, why: 'failed', message: 'gws auth login ended without reporting a sign-in' };
        // 0.22.5 answers "(unknown)" when the userinfo lookup after the exchange fails
        return typeof done.account === 'string' && done.account !== '' && done.account !== '(unknown)' ? { ok: true, account: done.account } : { ok: true };
      }
      const auth = run.end.code === EXIT.auth || cliError(run.stdout)?.reason === 'authError';
      return { ok: false, why: opened && auth ? 'refused' : 'failed', message: cliMessage(run) };
    }
  }
}

export async function gwsUpload(
  bin: string,
  env: Readonly<Record<string, string>>,
  opts: { file: string; name: string; mime: string; parent?: string; signal: AbortSignal; timeoutMs?: number },
): Promise<GwsUploadResult> {
  if (opts.signal.aborted) return { ok: false, why: 'cancelled' };
  if (!isAbsolute(opts.file)) return { ok: false, why: 'invalid', message: 'the file to upload is not an absolute path' };
  let file: string; // the CLI resolves links before its containment check, so the real file's directory is the one
  try {
    file = await realpath(opts.file);
    if (!(await stat(file)).isFile()) return { ok: false, why: 'invalid', message: 'the file to upload is not a regular file' };
  } catch (error) {
    return { ok: false, why: 'invalid', message: bounded(`the file to upload cannot be read: ${messageOf(error)}`) };
  }
  const metadata = { name: opts.name, ...(opts.parent === undefined ? {} : { parents: [opts.parent] }) };
  const params = { fields: 'id,name,webViewLink', supportsAllDrives: true };
  // The CLI refuses an --upload path that resolves outside its working directory: run it in the file's directory.
  const args = ['drive', 'files', 'create', '--json', JSON.stringify(metadata), '--upload', basename(file), '--upload-content-type', opts.mime, '--params', JSON.stringify(params)];
  const run = await runGws(bin, args, { ...env, GOOGLE_APPLICATION_CREDENTIALS: NO_ADC }, { cwd: dirname(file), signal: opts.signal, timeoutMs: opts.timeoutMs ?? GWS_UPLOAD_TIMEOUT_MS }); // P4-B5: NO_ADC
  switch (run.end.kind) {
    case 'spawn':
      return { ok: false, why: 'failed', message: bounded(run.end.message) };
    case 'abort':
      return { ok: false, why: 'cancelled' };
    case 'timeout':
      return { ok: false, why: 'timeout' };
    case 'stopped':
      return { ok: false, why: 'failed', message: run.end.message };
    case 'exit': {
      if (run.end.code === 0) {
        const file = outermostObject(run.stdout);
        if (typeof file?.id !== 'string' || file.id === '' || typeof file.name !== 'string') {
          return { ok: false, why: 'failed', message: 'gws printed no file resource' };
        }
        return { ok: true, id: file.id, name: file.name, ...(typeof file.webViewLink === 'string' ? { link: file.webViewLink } : {}) };
      }
      return { ok: false, why: uploadFailure(run.end.code, cliError(run.stdout)?.code), message: cliMessage(run) };
    }
  }
}

function uploadFailure(exit: number | null, code: unknown): Exclude<GwsUploadResult, { ok: true }>['why'] {
  switch (exit) {
    case EXIT.auth:
      return 'auth';
    case EXIT.validation:
      return 'invalid';
    case EXIT.discovery:
      return 'discovery';
    case EXIT.api:
      // a 401 with a token sent is an API error to the CLI, but a sign-in to the owner
      return code === 401 ? 'auth' : code === 404 ? 'notFound' : code === 403 ? 'forbidden' : 'api';
    default:
      return 'failed';
  }
}

function googleUrl(text: string): string | null {
  for (const [candidate] of text.matchAll(GOOGLE_URL)) {
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && url.hostname === 'accounts.google.com' && url.port === '' && url.username === '' && url.password === '') return url.href;
    } catch {
      // not a URL after all
    }
  }
  return null;
}

type Ended =
  | { kind: 'exit'; code: number | null; signal: NodeJS.Signals | null }
  | { kind: 'spawn'; message: string }
  | { kind: 'timeout' }
  | { kind: 'abort' }
  | { kind: 'stopped'; message: string };
interface Run {
  end: Ended;
  stdout: string;
  stderr: string;
}
interface RunOptions {
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs: number;
  lines?(text: string, stop: (message: string) => void): void;
}

// One stream, kept to its first OUTPUT_CAP_BYTES and read on to the end so the child never blocks on a full pipe.
class Capture {
  text = '';
  private bytes = 0;
  private scanned = 0;
  private readonly decoder = new StringDecoder('utf8');

  push(chunk: Buffer): void {
    if (this.bytes >= OUTPUT_CAP_BYTES) return;
    const kept = chunk.subarray(0, OUTPUT_CAP_BYTES - this.bytes);
    this.bytes += kept.length;
    this.text += this.decoder.write(kept);
  }

  // The complete lines not yet taken.
  takeLines(): string | null {
    const end = this.text.lastIndexOf('\n');
    if (end < this.scanned) return null;
    const lines = this.text.slice(this.scanned, end);
    this.scanned = end + 1;
    return lines;
  }

  end(): void {
    this.text += this.decoder.end();
  }
}

// P4-B5 review: the environment without the credentials-file override (the header above).
export const CREDENTIALS_FILE_VARIABLE = 'GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE';
const ownSignIn = (env: Readonly<Record<string, string>>): Record<string, string> => Object.fromEntries(Object.entries(env).filter(([key]) => key !== CREDENTIALS_FILE_VARIABLE));

function runGws(bin: string, args: readonly string[], given: Readonly<Record<string, string>>, opts: RunOptions): Promise<Run> {
  const env = ownSignIn(given);
  return new Promise((resolve) => {
    const out = new Capture();
    const err = new Capture();
    let child: ChildProcess;
    try {
      child = spawn(bin, args, { cwd: opts.cwd, env: { ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (error) {
      resolve({ end: { kind: 'spawn', message: messageOf(error) }, stdout: '', stderr: '' });
      return;
    }
    let stopped: Ended | null = null;
    let settled = false;
    let killer: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: Ended) => {
      if (stopped !== null || settled) return;
      stopped = reason;
      clearTimeout(timer);
      signalGroup(child.pid, 'SIGTERM');
      killer = setTimeout(() => signalGroup(child.pid, 'SIGKILL'), KILL_GRACE_MS);
    };
    const timer = setTimeout(() => stop({ kind: 'timeout' }), opts.timeoutMs);
    const onAbort = () => stop({ kind: 'abort' });
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (end: Ended) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killer); // the group is gone: a later SIGKILL could only reach a reused id
      opts.signal?.removeEventListener('abort', onAbort);
      out.end();
      err.end();
      resolve({ end, stdout: out.text, stderr: err.text });
    };
    const feed = (capture: Capture) => (chunk: Buffer) => {
      capture.push(chunk);
      if (opts.lines === undefined || stopped !== null) return;
      const lines = capture.takeLines();
      if (lines !== null) opts.lines(lines, (message) => stop({ kind: 'stopped', message }));
    };
    child.stdout?.on('data', feed(out));
    child.stderr?.on('data', feed(err));
    child.on('error', (error) => {
      if (child.pid === undefined) finish({ kind: 'spawn', message: error.message });
    });
    child.on('close', (code, signal) => {
      const reason = stopped;
      if (reason === null) finish({ kind: 'exit', code, signal });
      else void groupGone(child.pid).then(() => finish(reason));
    });
    if (opts.signal?.aborted) stop({ kind: 'abort' });
  });
}

function signalGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: the group is already gone
  }
}

// Every member of the group has left the process table (bounded: past the SIGKILL there is nothing more to send).
async function groupGone(pid: number | undefined): Promise<void> {
  if (pid === undefined) return;
  const until = Date.now() + KILL_GRACE_MS + GONE_WAIT_MS;
  while (Date.now() < until) {
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
    }
    await sleep(25);
  }
}

// The first object in `text` that parses whole, starting at a line's first non-blank character (the CLI prints its
// JSON with `println!`, pretty and from a line's start); a brace inside a JSON string does not count.
function outermostObject(text: string): Record<string, unknown> | null {
  let tries = 0;
  for (const start of text.matchAll(/^[ \t]*\{/gm)) {
    if (++tries > 64) break; // each try may scan to the end: a pathological stream must not stall the main process
    const from = start.index + start[0].length - 1;
    const to = objectEnd(text, from);
    if (to === -1) continue;
    try {
      const value: unknown = JSON.parse(text.slice(from, to + 1));
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // balanced but not JSON: noise
    }
  }
  return null;
}

function objectEnd(text: string, from: number): number {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return c === '}' ? i : -1;
    }
  }
  return -1;
}

function cliError(stdout: string): { code?: unknown; message?: unknown; reason?: unknown } | null {
  const error = outermostObject(stdout)?.error;
  return error !== null && typeof error === 'object' && !Array.isArray(error) ? (error as { code?: unknown; message?: unknown; reason?: unknown }) : null;
}

// The CLI's own words for a failed run: its error JSON's message, else its last stderr line, else how it ended.
function cliMessage(run: Run): string | undefined {
  const message = cliError(run.stdout)?.message;
  if (typeof message === 'string' && message.trim() !== '') return bounded(message);
  const line = run.stderr.split('\n').map(plain).filter((l) => l !== '').pop();
  if (line !== undefined) return bounded(line);
  if (run.end.kind === 'exit') return run.end.signal !== null ? `gws ended on ${run.end.signal}` : `gws exited with code ${run.end.code}`;
  return undefined;
}

// Terminal colour sequences and control characters out, whitespace runs to one space.
function plain(text: string): string {
  return text
    .replace(/\p{Cc}\[[0-9;]*[A-Za-z]/gu, '')
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim();
}

function bounded(text: string): string {
  const line = plain(text);
  return line.length > MESSAGE_CHARS ? `${line.slice(0, MESSAGE_CHARS - 1)}…` : line;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
