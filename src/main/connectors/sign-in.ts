// P4-AGG M4: signing in to a connector through the engine's own MCP sign-in, so the agents' sessions are signed in
// (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Signing in", "Which session"; Decision Log 12
// and 14; the spike, spikes/p4-aggregator/findings-m4.txt). An operation main owns: `connectors.signIn` answers a receipt
// at once and the steps arrive as `connectors.signInChanged`, because consent takes as long as the person takes and
// every call into the engine host must answer within the supervisor's 10 s.
//
//   starting         the receipt is issued; MAWS's loopback listener (127.0.0.1, an ephemeral port, /callback) comes up
//                    and the engine is asked `mcp_authenticate` with it as the redirect URI (again, for up to CONFIG_MS,
//                    while it answers "Server not found" for a server added before its config poll read it)
//   waiting_browser  the engine answered an authorization URL; MAWS opens it in the system browser
//   waiting_callback the engine took MAWS's redirect ('custom'): the one request whose `state` is the engine's →
//                    submitting; any other request is answered 400 and the wait goes on; CALLBACK_MS → failed (timeout)
//   watching_status  the engine holds its own `localhost:<callbackPort>` listener ('localhost'), or the custom callback
//                    was accepted and a reconnect sent: the session's mcp_status is read every POLL_MS
//   submitting       `mcp_oauth_callback_url` with the callback URL; the engine does not reconnect a server whose
//                    callback came this way, so MAWS sends `mcp_reconnect` and watches (findings-m4 1)
//   done             connected in the signing session (`where: 'here'`), or, once the custom callback was accepted, the
//                    credential stored for every session started from now when this one does not report the server
//                    connected within SETTLE_MS (`'new_sessions'`: a server added after the session started is never in
//                    its mcp_status, findings-m4 5; Decision Log 14)
//   failed           with a reason: no_session, timeout, denied (the callback carried `error`), engine (its words),
//                    session_exited
//   cancelled        `connectors.signInCancel`, or a second press for the same server (one operation per server)
//
// The engine's own pending flow is left to lapse; a new `mcp_authenticate` starts a new flow and the engine refuses the
// old flow's callback (findings-m4 3, 4). No event carries the authorization URL, a code or a state. MAWS's own OAuth
// store (./oauth-store.ts) is not involved. `mcp_set_servers` is never used (it drops the session's SDK server).
import { randomUUID } from 'node:crypto';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import { OAUTH_CALLBACK_HOST, type ListenLoopback, type LoopbackListener, type LoopbackReply, type LoopbackRequest } from './oauth-callback';

export const CALLBACK_MS = 5 * 60_000;
export const POLL_MS = 2_000;
export const SETTLE_MS = 15_000; // after an accepted custom callback: how long the signing session may take to read connected
// A server added a moment ago: the engine reads its global config file again about once a second (2.1.309 polls it with
// fs.watchFile, 1000 ms) and answers "Server not found" until it has; MAWS asks again within this window.
export const CONFIG_MS = 10_000;
const CONFIG_POLL_MS = 1_000;
const NOT_READ_YET = /^Server not found: /;
const REPLY_FLUSH_MS = 50; // the browser's page written before the listener closes

type SignInCommand = 'session.mcpAuthenticate' | 'session.mcpOAuthCallback' | 'session.mcpReconnect' | 'session.mcpStatus';
export interface SignInHost {
  call<N extends SignInCommand & CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
}

export interface SignInDeps {
  host: SignInHost;
  listen: ListenLoopback;
  open(url: string): boolean; // the one scheme-checked browser seam (`openExternalUrl`)
  emit(event: ConnectorSignInChanged): void;
  ready(appSessionId: string): boolean; // the session's process is ready now
  onSessionGone(listener: (appSessionId: string) => void): () => void; // its process left ready
  callbackMs?: number;
  pollMs?: number;
  settleMs?: number;
  configMs?: number;
  configPollMs?: number;
  log?: (line: string) => void;
}

export interface SignIn {
  start(input: { name: string; appSessionId: string }): { opId: string };
  cancel(opId: string): boolean;
  stop(): void;
}

type State = ConnectorSignInChanged['state'];
type Reason = NonNullable<ConnectorSignInChanged['reason']>;
const TERMINAL: ReadonlySet<State> = new Set(['done', 'failed', 'cancelled']);

const PAGE = {
  signedIn: 'MAWS received the sign-in. You can close this tab and return to MAWS.',
  declined: 'The sign-in was declined. You can close this tab and return to MAWS.',
  waiting: 'This is not the sign-in MAWS is waiting for.',
};

interface Operation {
  opId: string;
  name: string;
  appSessionId: string;
  state: State;
  listener: LoopbackListener | null;
  timers: Set<NodeJS.Timeout>;
}

export function createSignIn(deps: SignInDeps): SignIn {
  const callbackMs = deps.callbackMs ?? CALLBACK_MS;
  const pollMs = deps.pollMs ?? POLL_MS;
  const settleMs = deps.settleMs ?? SETTLE_MS;
  const configMs = deps.configMs ?? CONFIG_MS;
  const configPollMs = deps.configPollMs ?? CONFIG_POLL_MS;
  const log = deps.log ?? ((line: string) => console.warn(`[connectors] ${line}`));
  const operations = new Map<string, Operation>(); // live ones, by opId
  const byServer = new Map<string, string>(); // server name → its live opId

  const live = (op: Operation) => !TERMINAL.has(op.state);
  const move = (op: Operation, state: State, extra: { reason?: Reason; message?: string | null; where?: 'here' | 'new_sessions' } = {}) => {
    if (!live(op)) return;
    op.state = state;
    if (TERMINAL.has(state)) {
      for (const timer of op.timers) clearTimeout(timer);
      op.timers.clear();
      void op.listener?.close();
      op.listener = null;
      operations.delete(op.opId);
      if (byServer.get(op.name) === op.opId) byServer.delete(op.name);
    }
    deps.emit({ opId: op.opId, name: op.name, state, reason: extra.reason ?? null, message: extra.message ?? null, where: extra.where ?? null });
  };
  const fail = (op: Operation, reason: Reason, message: string | null = null) => move(op, 'failed', { reason, message });
  const later = (op: Operation, ms: number, run: () => void) => {
    const timer = setTimeout(() => {
      op.timers.delete(timer);
      if (live(op)) run();
    }, ms);
    op.timers.add(timer);
  };

  // A host call that answered: its value, or null after failing the operation (a session gone is `session_exited`).
  async function ask<N extends SignInCommand>(op: Operation, name: N, input: CommandInput<N>): Promise<CommandOutput<N> | null> {
    let result: CommandResult<N>;
    try {
      result = await deps.host.call(name, input);
    } catch (error) {
      result = { ok: false, error: { code: 'internal', message: error instanceof Error ? error.message : String(error) } } as CommandResult<N>;
    }
    if (!live(op)) return null;
    if (result.ok) return result.value as CommandOutput<N>;
    if (!deps.ready(op.appSessionId)) fail(op, 'session_exited');
    else fail(op, 'engine', result.error.message);
    return null;
  }

  type Server = { name: string; status: string; error?: unknown };
  const serverOf = async (op: Operation): Promise<Server | null | undefined> => {
    const status = await ask(op, 'session.mcpStatus', { appSessionId: op.appSessionId });
    if (status === null) return undefined; // the operation failed
    return ((status.mcpServers as Server[]).find((server) => server.name === op.name) ?? null);
  };

  // watching_status. `until`: when to give up; `settled`: what the end then is (the custom callback was accepted, so the
  // credential is stored: done for new sessions), else a timeout.
  function watch(op: Operation, until: number, settled: boolean): void {
    const poll = async () => {
      const server = await serverOf(op);
      if (server === undefined || !live(op)) return;
      if (server?.status === 'connected') return move(op, 'done', { where: 'here' });
      if (server?.status === 'failed' && !settled) return fail(op, 'engine', typeof server.error === 'string' ? server.error : null);
      if (Date.now() >= until) return settled ? move(op, 'done', { where: 'new_sessions' }) : fail(op, 'timeout');
      later(op, pollMs, () => void poll());
    };
    void poll();
  }

  async function submit(op: Operation, callbackUrl: string, declined: boolean): Promise<void> {
    if (!live(op)) return;
    const answer = await ask(op, 'session.mcpOAuthCallback', { appSessionId: op.appSessionId, serverName: op.name, callbackUrl });
    if (answer === null) return;
    if (!answer.ok) return fail(op, declined ? 'denied' : 'engine', answer.message);
    // accepted: the token is stored; the engine reconnects nothing itself after a callback that came this way
    const reconnect = await ask(op, 'session.mcpReconnect', { appSessionId: op.appSessionId, serverName: op.name });
    if (reconnect === null) return;
    move(op, 'watching_status');
    watch(op, Date.now() + settleMs, true);
  }

  async function run(op: Operation): Promise<void> {
    if (!deps.ready(op.appSessionId)) return fail(op, 'no_session');
    let expected: string | null = null; // the engine's state, once it answered
    let port = 0;
    const handle = (request: LoopbackRequest): LoopbackReply => {
      const url = new URL(request.url, `http://${OAUTH_CALLBACK_HOST}:${port}`);
      if (!live(op) || op.state !== 'waiting_callback' || request.method !== 'GET' || url.pathname !== '/callback' || expected === null || url.searchParams.get('state') !== expected) return { status: 400, body: PAGE.waiting };
      const declined = url.searchParams.has('error');
      const listener = op.listener;
      op.listener = null;
      move(op, 'submitting');
      // the page is answered first; the listener closes once it is written (it takes no second request), then MAWS submits
      setTimeout(() => void (listener?.close() ?? Promise.resolve()).then(() => submit(op, `http://${OAUTH_CALLBACK_HOST}:${port}${request.url}`, declined)), REPLY_FLUSH_MS);
      return { status: 200, body: declined ? PAGE.declined : PAGE.signedIn };
    };
    try {
      op.listener = await deps.listen(handle);
    } catch (error) {
      return fail(op, 'engine', `MAWS could not listen for the sign-in's return: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!live(op)) return void op.listener?.close();
    port = op.listener.port;
    const authenticate = () => ask(op, 'session.mcpAuthenticate', { appSessionId: op.appSessionId, serverName: op.name, redirectUri: `http://${OAUTH_CALLBACK_HOST}:${port}/callback` });
    const notReadBy = Date.now() + configMs;
    let auth = await authenticate();
    while (auth !== null && !auth.ok && NOT_READ_YET.test(auth.message) && Date.now() < notReadBy) {
      await new Promise((resolve) => setTimeout(resolve, configPollMs));
      if (!live(op)) return;
      auth = await authenticate();
    }
    if (auth === null) return;
    if (!auth.ok) return fail(op, 'engine', auth.message);
    const { authUrl, requiresUserAction, redirectScheme, state } = auth.answer;
    if (authUrl === undefined || requiresUserAction === false) return move(op, 'done', { where: 'here' });
    move(op, 'waiting_browser');
    if (!deps.open(authUrl)) return fail(op, 'engine', 'the engine answered an authorization URL the browser seam refused');
    if (redirectScheme === 'custom' && typeof state === 'string') {
      expected = state;
      move(op, 'waiting_callback');
      later(op, callbackMs, () => fail(op, 'timeout'));
      return;
    }
    // the engine's own listener receives the redirect; MAWS's is not needed
    void op.listener?.close();
    op.listener = null;
    move(op, 'watching_status');
    watch(op, Date.now() + callbackMs, false);
  }

  const unsubscribe = deps.onSessionGone((appSessionId) => {
    for (const op of [...operations.values()]) if (op.appSessionId === appSessionId) fail(op, 'session_exited');
  });

  return {
    start({ name, appSessionId }) {
      const previous = byServer.get(name);
      if (previous !== undefined) {
        const op = operations.get(previous);
        if (op) move(op, 'cancelled');
      }
      const op: Operation = { opId: randomUUID(), name, appSessionId, state: 'starting', listener: null, timers: new Set() };
      operations.set(op.opId, op);
      byServer.set(name, op.opId);
      deps.emit({ opId: op.opId, name, state: 'starting', reason: null, message: null, where: null });
      queueMicrotask(() => void run(op).catch((error: unknown) => {
        log(`sign-in to ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
        fail(op, 'engine', error instanceof Error ? error.message : String(error));
      }));
      return { opId: op.opId };
    },
    cancel(opId) {
      const op = operations.get(opId);
      if (!op) return false;
      move(op, 'cancelled');
      return true;
    },
    stop() {
      unsubscribe();
      for (const op of [...operations.values()]) move(op, 'cancelled');
    },
  };
}

// ---- main's wiring ------------------------------------------------------------------------------------------------

export interface SignInServiceDeps {
  register: typeof import('../ipc/router').registerMainHandler;
  emit(name: 'connectors.signInChanged', payload: ConnectorSignInChanged): unknown;
  host: SignInHost;
  onSessionStatus(listener: (payload: { appSessionId: string; status: { process: string } }) => void): () => void;
  onHostLost(listener: () => void): () => void; // the engine host left ready: every session with it
  open(url: string): boolean;
  listen: ListenLoopback;
}

// `connectors.signIn` and `connectors.signInCancel`, over the sessions main hears ready from the engine host.
export function startSignIn(deps: SignInServiceDeps): { stop(): void } {
  const ready = new Set<string>();
  const goneListeners = new Set<(appSessionId: string) => void>();
  const gone = (appSessionId: string) => {
    ready.delete(appSessionId);
    for (const listener of goneListeners) listener(appSessionId);
  };
  const offStatus = deps.onSessionStatus(({ appSessionId, status }) => {
    if (status.process === 'ready') ready.add(appSessionId);
    else if (ready.has(appSessionId)) gone(appSessionId);
  });
  const offHost = deps.onHostLost(() => [...ready].forEach(gone));
  const signIn = createSignIn({
    host: deps.host,
    listen: deps.listen,
    open: deps.open,
    emit: (event) => void deps.emit('connectors.signInChanged', event),
    ready: (appSessionId) => ready.has(appSessionId),
    onSessionGone: (listener) => (goneListeners.add(listener), () => goneListeners.delete(listener)),
  });
  deps.register('connectors.signIn', ({ name, appSessionId }) => signIn.start({ name, appSessionId }));
  deps.register('connectors.signInCancel', ({ opId }) => ({ cancelled: signIn.cancel(opId) }));
  return {
    stop() {
      offStatus();
      offHost();
      signIn.stop();
    },
  };
}
