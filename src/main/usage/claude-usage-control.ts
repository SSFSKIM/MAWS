// ClaudeUsage's loopback control API, which the usage popover's actions run through (W6 route executor; charter §19 and
// D-17; the C11 execution document's popover): `GET /claudeusage/state` and the five POSTs on the relay's own port, each
// with `Authorization: Bearer <token>`. The token is `<data dir>/control-token`, read on every use; an absent file means
// this ClaudeUsage has no control route, so nothing is sent. The port is `gateway.json`'s, as C7's reader last read it.
// MAWS writes none of ClaudeUsage's files: an action is ClaudeUsage's to carry out, and its files (C7's reader) follow.
// Every way of not reaching ClaudeUsage answers a reason instead of throwing: no token, no port, a 404 or a refused
// connection is `no_route`; a 401 or an unreadable token `bad_token`; no answer in time `timeout`; a 503 (the relay is up,
// ClaudeUsage's app is not wired to it yet) `starting`; anything else (a 400, a 405, a 5xx, an answer that is not the
// state) `failed`. `MAWS_CLAUDE_USAGE_CONTROL_URL` (the end-to-end harness's stub, through `baseUrl`; honoured only under
// MAWS_E2E=1) replaces `http://127.0.0.1:<port>`. The token only ever goes over plain http to a loopback host: a base
// URL that is anything else is `no_route`, and nothing is sent.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { UsageAction, UsageActionResult, UsageControlReason, UsageControlsAnswer, UsageControlState } from '@shared/ipc/schema';

export const TOKEN_FILE = 'control-token';
export const STATE_TIMEOUT_MS = 1_500;
export const ACTION_TIMEOUT_MS = 5_000; // an action may persist before it answers; the state is a read

export interface ClaudeUsageControlOptions {
  dir: string; // ClaudeUsage's data directory (C7's `claudeUsageDir`)
  port: () => Promise<number | null>; // gateway.json's port, null when the file or the field is absent
  baseUrl?: string | null; // MAWS_CLAUDE_USAGE_CONTROL_URL, through `baseUrlFrom`
  stateTimeoutMs?: number;
  actionTimeoutMs?: number;
  log?: (message: string) => void;
}

// What one request came to: an HTTP answer with its parsed JSON body (null when it had none), or why there was none.
type Reached = { reached: true; status: number; body: unknown } | { reached: false; reason: UsageControlReason; message: string };

const MESSAGES: Record<UsageControlReason, string> = {
  no_route: "ClaudeUsage's control route is not there; use ClaudeUsage's own panel",
  bad_token: "ClaudeUsage's control token could not be read",
  timeout: 'ClaudeUsage did not answer in time',
  starting: 'ClaudeUsage is still starting',
  failed: "ClaudeUsage's control route failed",
};

// The base URL override: the end-to-end harness's stub, and nothing outside it, since it would carry the owner's token.
export function baseUrlFrom(env: NodeJS.ProcessEnv): string | null {
  return env.MAWS_E2E === '1' ? env.MAWS_CLAUDE_USAGE_CONTROL_URL || null : null;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class ClaudeUsageControl {
  private checking: Promise<UsageControlsAnswer> | null = null;
  private readonly log: (message: string) => void;

  constructor(private readonly opts: ClaudeUsageControlOptions) {
    this.log = opts.log ?? ((message) => console.warn(`[claude-usage-control] ${message}`));
  }

  // settings.usageControls: one check at a time; a caller while one runs gets its answer.
  controls(): Promise<UsageControlsAnswer> {
    this.checking ??= this.check().finally(() => (this.checking = null));
    return this.checking;
  }

  // settings.usageAction: ClaudeUsage's answer, a 409 with its own reason and message.
  async act(action: UsageAction): Promise<UsageActionResult> {
    const [path, body] = requestOf(action);
    const answer = await this.request('POST', path, body, this.opts.actionTimeoutMs ?? ACTION_TIMEOUT_MS);
    if (!answer.reached) return { ok: false, reason: answer.reason, message: answer.message };
    if (answer.status >= 200 && answer.status < 300) {
      const manual = field(answer.body, 'drainTargetIsManual');
      const shown = field(answer.body, 'shown');
      return action.action === 'route'
        ? { ok: true, drainTarget: str(field(answer.body, 'drainTarget')) ?? action.uuid, drainTargetIsManual: typeof manual === 'boolean' ? manual : true, shown: null } // a route ClaudeUsage was asked for is manual
        : { ok: true, drainTarget: null, drainTargetIsManual: false, shown: action.action === 'panel' && typeof shown === 'boolean' ? shown : null };
    }
    if (answer.status === 409) {
      const reason = str(field(answer.body, 'reason')) ?? 'refused';
      return { ok: false, reason, message: str(field(answer.body, 'message')) ?? `ClaudeUsage refused this (${reason})` };
    }
    const reason = reasonOf(answer.status);
    return { ok: false, reason, message: reason === 'failed' ? `${MESSAGES.failed} (HTTP ${answer.status})` : MESSAGES[reason] };
  }

  private async check(): Promise<UsageControlsAnswer> {
    const answer = await this.request('GET', '/claudeusage/state', undefined, this.opts.stateTimeoutMs ?? STATE_TIMEOUT_MS);
    if (!answer.reached) return { available: false, reason: answer.reason, state: null };
    if (answer.status !== 200) return { available: false, reason: reasonOf(answer.status), state: null };
    const state = parseState(answer.body);
    if (state === null) this.log('GET /claudeusage/state answered something that is not the state');
    return state === null ? { available: false, reason: 'failed', state: null } : { available: true, reason: null, state };
  }

  private async request(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number): Promise<Reached> {
    const token = await this.token();
    if (typeof token !== 'string') return token;
    const base = await this.base();
    if (base === null) return { reached: false, reason: 'no_route', message: MESSAGES.no_route };
    try {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', // the token goes to ClaudeUsage's own listener and nowhere else
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { reached: true, status: response.status, body: json(await response.text()) };
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') return { reached: false, reason: 'timeout', message: MESSAGES.timeout };
      if (causeCodes(error).includes('ECONNREFUSED')) return { reached: false, reason: 'no_route', message: MESSAGES.no_route };
      this.log(`${method} ${path}: ${messageOf(error)}`);
      return { reached: false, reason: 'failed', message: `${MESSAGES.failed}: ${messageOf(error)}` };
    }
  }

  // The token, read on every use: absent is no route; unreadable, empty or not a header value is a bad token.
  private async token(): Promise<string | Reached> {
    let text: string;
    try {
      text = await readFile(join(this.opts.dir, TOKEN_FILE), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { reached: false, reason: 'no_route', message: MESSAGES.no_route };
      this.log(`${TOKEN_FILE} unreadable: ${messageOf(error)}`);
      return { reached: false, reason: 'bad_token', message: MESSAGES.bad_token };
    }
    const token = text.trim();
    return /^[\x21-\x7e]+$/.test(token) ? token : { reached: false, reason: 'bad_token', message: MESSAGES.bad_token };
  }

  private async base(): Promise<string | null> {
    if (this.opts.baseUrl) {
      const url = URL.parse(this.opts.baseUrl);
      if (url?.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) {
        this.log('MAWS_CLAUDE_USAGE_CONTROL_URL is not plain http to a loopback host; nothing is sent');
        return null;
      }
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    }
    const port = await this.opts.port();
    return port !== null && Number.isInteger(port) && port > 0 && port < 65536 ? `http://127.0.0.1:${port}` : null;
  }
}

function requestOf(action: UsageAction): [path: string, body: unknown] {
  switch (action.action) {
    case 'route':
      return ['/claudeusage/route', { uuid: action.uuid }];
    case 'add':
      return ['/claudeusage/accounts/add', { email: action.email ?? null }];
    case 'reconnect':
      return ['/claudeusage/accounts/reconnect', { uuid: action.uuid }];
    case 'remove':
      return ['/claudeusage/accounts/remove', { uuid: action.uuid, confirm: action.confirm }];
    case 'panel':
      return ['/claudeusage/panel', {}];
  }
}

const reasonOf = (status: number): UsageControlReason => (status === 401 ? 'bad_token' : status === 404 ? 'no_route' : status === 503 ? 'starting' : 'failed');

// The state as MAWS uses it, read leniently: fields ClaudeUsage adds are ignored and a missing one takes its empty value;
// only an answer without the version, the routing object and the accounts list is not the state.
export function parseState(value: unknown): UsageControlState | null {
  if (!isObject(value) || typeof value.version !== 'number' || !isObject(value.routing) || !Array.isArray(value.accounts)) return null;
  const routing = value.routing;
  return {
    updatedAt: str(value.updatedAt),
    routing: {
      enabled: routing.enabled === true,
      ready: routing.ready === true,
      port: typeof routing.port === 'number' && Number.isInteger(routing.port) ? routing.port : null,
      drainTarget: str(routing.drainTarget),
      drainTargetIsManual: routing.drainTargetIsManual === true,
    },
    accounts: value.accounts.filter(isObject).flatMap((a) =>
      typeof a.uuid === 'string'
        ? [{ uuid: a.uuid, email: str(a.email) ?? '', status: str(a.status) ?? '', isRoutingHere: a.isRoutingHere === true, canRoute: bool(a.canRoute), canReconnect: bool(a.canReconnect), canRemove: bool(a.canRemove) }]
        : [],
    ),
    codex: (Array.isArray(value.codex) ? value.codex : []).filter(isObject).flatMap((c) => (typeof c.id === 'string' ? [{ id: c.id, label: str(c.label) ?? '', isDrainTarget: c.isDrainTarget === true }] : [])),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const field = (body: unknown, key: string): unknown => (isObject(body) ? body[key] : undefined);

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The error codes under a fetch failure: undici puts the socket's error in `cause`, an AggregateError's in `errors`.
function causeCodes(error: unknown): string[] {
  const codes: string[] = [];
  const visit = (e: unknown, depth: number) => {
    if (typeof e !== 'object' || e === null || depth > 4) return;
    const { code, cause, errors } = e as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof code === 'string') codes.push(code);
    visit(cause, depth + 1);
    if (Array.isArray(errors)) for (const inner of errors) visit(inner, depth + 1);
  };
  visit(error, 0);
  return codes;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
