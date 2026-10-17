// P3-HD M4a: a fake browser for the toy OAuth fixture, for scenes only (P3-HD Decision Log 28). The product opens an
// owner's Connect in the system browser through the scheme-checked openExternalUrl; under MAWS_E2E with
// MAWS_E2E_OPEN_LOG set it appends `openExternal <url>` to that scratch log instead and opens nothing
// (src/main/open-external.ts). This reads the next such line and follows it only when it is the fixture's exact
// `/authorize` on its 127.0.0.1 origin, whose `redirect_uri` is an exact `http://127.0.0.1:<port>/callback`, and then
// only the redirect to exactly that callback, with redirects never followed automatically. Anything else is refused
// before any request. One deadline bounds the whole follow: the wait for the open, both requests and both bodies; at it
// the outstanding request is aborted, a body cancelled, and the refusal is `timeout`. The callback body is read to a
// byte bound and the rest cancelled. It returns statuses and the callback's port, never the URL, state or code; the open
// log holds them, so a scene never retains it.
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

export const CALLBACK_PATH = '/callback'; // MAWS's loopback callback (src/main/connectors/oauth-flow.ts OAUTH_CALLBACK_PATH)
const PREFIX = 'openExternal ';
const BODY_LIMIT = 512; // bytes of the callback's reply kept; the rest is cancelled unread

export type FakeBrowserRefusalReason = 'timeout' | 'notFixtureAuthorization' | 'redirectUri' | 'authorizeStatus' | 'location';
export class FakeBrowserRefusal extends Error {
  constructor(readonly reason: FakeBrowserRefusalReason) {
    super(`the fake browser refused: ${reason}`); // a fixed word: no URL, state or code
    this.name = 'FakeBrowserRefusal';
  }
}

export interface Deadline {
  readonly signal: AbortSignal; // aborts when the budget is spent
  clear(): void;
}
export interface FakeBrowserDeps {
  fetch(url: string, init: RequestInit): Promise<Response>;
  readOpenLog(path: string): string;
  sleep(ms: number): Promise<void>;
  now(): number;
  deadline(ms: number): Deadline;
}
const realDeps: FakeBrowserDeps = {
  fetch: (url, init) => fetch(url, init),
  readOpenLog: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : ''),
  sleep: (ms) => sleep(ms),
  now: Date.now,
  deadline(ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
  },
};

// `work`, unless the deadline comes first: then the refusal is `timeout`, whatever `work` does later.
function within<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => {});
    return Promise.reject(new FakeBrowserRefusal('timeout'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new FakeBrowserRefusal('timeout'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(signal.aborted ? new FakeBrowserRefusal('timeout') : error); },
    );
  });
}

// At most `limit` bytes of a body, the rest cancelled; a stall past the deadline cancels it too.
async function boundedText(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < limit) {
      const { done, value } = await within(reader.read(), signal);
      if (done) return new TextDecoder().decode(concat(chunks, length));
      const take = value.subarray(0, limit - length);
      chunks.push(take);
      length += take.byteLength;
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  }
  void reader.cancel().catch(() => {});
  return new TextDecoder().decode(concat(chunks, length));
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function openExternalUrls(logText: string): string[] {
  return logText.split('\n').filter((line) => line.startsWith(PREFIX)).map((line) => line.slice(PREFIX.length));
}

// The fixture's exact authorization endpoint, or null.
function authorizationOf(url: string, origin: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const exact = parsed.protocol === 'http:' && parsed.username === '' && parsed.password === '' && parsed.origin === origin && parsed.pathname === '/authorize' && url.startsWith(`${origin}/authorize?`);
  return exact ? parsed : null;
}

// Browser opens of the fixture's authorization endpoint: one per Connect or Reconnect that reached consent.
export function countAuthorizationOpens(logText: string, origin: string): number {
  return openExternalUrls(logText).filter((url) => authorizationOf(url, origin) !== null).length;
}

// An exact `http://127.0.0.1:<port><callbackPath>` other than the fixture's own origin, written as the URL parser writes it.
function redirectUriOf(authorize: URL, callbackPath: string): { uri: string; port: number } {
  const values = authorize.searchParams.getAll('redirect_uri');
  if (values.length !== 1) throw new FakeBrowserRefusal('redirectUri');
  const raw = values[0]!;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new FakeBrowserRefusal('redirectUri');
  }
  const exact = parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port !== '' && parsed.username === '' && parsed.password === '' && parsed.pathname === callbackPath && parsed.search === '' && parsed.hash === '' && raw === `${parsed.origin}${parsed.pathname}` && parsed.origin !== authorize.origin;
  if (!exact) throw new FakeBrowserRefusal('redirectUri');
  return { uri: raw, port: Number(parsed.port) };
}

export interface FollowedAuthorization {
  authorizeStatus: number;
  outcome: 'code' | 'error'; // what the redirect carried to the callback
  callbackPort: number;
  callbackStatus: number;
  callbackBody: string; // MAWS's fixed reply, bounded
}

export interface FollowOptions {
  openLog: string; // the scene's MAWS_E2E_OPEN_LOG
  afterOpens: number; // openExternal lines already in the log before the owner's Connect
  origin: string; // the fixture's origin
  callbackPath?: string;
  timeoutMs?: number;
}

export async function followAuthorization(options: FollowOptions, deps: FakeBrowserDeps = realDeps): Promise<FollowedAuthorization> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const end = deps.now() + timeoutMs;
  const deadline = deps.deadline(timeoutMs);
  try {
    return await follow(options, deps, deadline.signal, () => deadline.signal.aborted || deps.now() >= end);
  } finally {
    deadline.clear();
  }
}

async function follow(options: FollowOptions, deps: FakeBrowserDeps, signal: AbortSignal, spent: () => boolean): Promise<FollowedAuthorization> {
  const inTime = () => {
    if (spent()) throw new FakeBrowserRefusal('timeout');
  };
  let url: string | undefined;
  for (;;) {
    url = openExternalUrls(deps.readOpenLog(options.openLog))[options.afterOpens];
    inTime();
    if (url !== undefined) break;
    await deps.sleep(100);
  }
  const authorize = authorizationOf(url, options.origin);
  if (authorize === null) throw new FakeBrowserRefusal('notFixtureAuthorization');
  const redirect = redirectUriOf(authorize, options.callbackPath ?? CALLBACK_PATH);

  const answer = await within(deps.fetch(authorize.href, { redirect: 'manual', signal }), signal);
  if (answer.body !== null) await within(answer.body.cancel(), signal);
  inTime();
  if (answer.status !== 302 && answer.status !== 303) throw new FakeBrowserRefusal('authorizeStatus');
  const location = answer.headers.get('location');
  if (location === null || !location.startsWith(`${redirect.uri}?`)) throw new FakeBrowserRefusal('location');
  const callback = new URL(location);
  if (`${callback.origin}${callback.pathname}` !== redirect.uri || callback.hash !== '' || callback.username !== '') throw new FakeBrowserRefusal('location');

  const reply = await within(deps.fetch(callback.href, { redirect: 'manual', signal }), signal);
  const body = await boundedText(reply, BODY_LIMIT, signal);
  return { authorizeStatus: answer.status, outcome: callback.searchParams.has('code') ? 'code' : 'error', callbackPort: redirect.port, callbackStatus: reply.status, callbackBody: body };
}
