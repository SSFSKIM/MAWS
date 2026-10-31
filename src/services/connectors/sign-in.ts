// P4-AGG M4: signing in to a connector through the engine's own MCP sign-in, so the agents' sessions are signed in
// (docs/doperpowers/specs/2026-10-24-plugin-aggregator-design.md, Design "Signing in", "Which session"; Decision Log 12
// and 14; the spike, spikes/p4-aggregator/findings-m4.txt). An operation main owns: `connectors.signIn` answers a receipt
// at once and the steps arrive as `connectors.signInChanged`, because consent takes as long as the person takes and
// every call into the engine host must answer within the supervisor's 10 s.
//
//   starting         the receipt is issued; the session's status read first (a server it already has connected ends
//                    done at once, its message ALREADY_CONNECTED, no flow started: scalpel-2#3); MAWS's loopback listener (127.0.0.1, an ephemeral port, /callback) comes up
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
//                    session_exited, other_entry (before anything else: the session's engine uses another entry of the
//                    name than the one asked for, by its files or by the server it holds, so it would sign that one in;
//                    ./sign-in-entry.ts, scalpel-2#1, fix-D#4)
//   cancelled        `connectors.signInCancel`, or a second press for the same configured connector from any session
//                    (Decision Log 14: one sign-in per connector at a time, since every session's engine writes the same
//                    credential). A connector is its configuration: name and scope, and the directory for a project or
//                    local one; servers that only share a name are separate connectors. A press for the same server name
//                    in the same session cancels too, whatever its configuration: the engine knows a flow only by its
//                    server name (mcp_authenticate and the callback carry no scope), so a second flow replaces the
//                    first and refuses its callback (findings-m4 3, 4).
//
// The engine's own pending flow is left to lapse; a new `mcp_authenticate` starts a new flow and the engine refuses the
// old flow's callback (findings-m4 3, 4). No event carries the authorization URL, a code or a state. MAWS's own OAuth
// store (./oauth-store.ts) is not involved. `mcp_set_servers` is never used (it drops the session's SDK server).
import { randomUUID } from 'node:crypto';
import { isNoClient, NO_CLIENT_REASON, type ClientPort } from '@shared/client/port';
import type { ClientRef } from '@shared/ipc/client';
import type { CommandInput, CommandName, CommandOutput, CommandResult } from '@shared/ipc/schema';
import { CONNECTOR_ALREADY_CONNECTED, type ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import { entryRefusal } from './sign-in-entry';
import { OAUTH_CALLBACK_HOST, type ListenLoopback, type LoopbackListener, type LoopbackReply, type LoopbackRequest } from './oauth-callback';

export const CALLBACK_MS = 5 * 60_000;
export const POLL_MS = 2_000;
export const SETTLE_MS = 15_000; // after an accepted custom callback: how long the signing session may take to read connected
// A server added a moment ago: the engine reads its global config file again about once a second (2.1.309 polls it with
// fs.watchFile, 1000 ms) and answers "Server not found" until it has; MAWS asks again within this window.
export const CONFIG_MS = 10_000;
const CONFIG_POLL_MS = 1_000;
const NOT_READ_YET = /^Server not found: /;
// scalpel-2#3: the end of a sign-in for a server the session already had connected before anything started: no flow is
// started (no consent page opened), since a connection that was already there is no evidence of one.
export const ALREADY_CONNECTED = CONNECTOR_ALREADY_CONNECTED;
const REPLY_FLUSH_MS = 50; // the browser's page written before the listener closes

type SignInCommand = 'session.mcpAuthenticate' | 'session.mcpOAuthCallback' | 'session.mcpReconnect' | 'session.mcpStatus' | 'customization.serverEndpoints';
export interface SignInHost {
  call<N extends SignInCommand & CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
}

export interface SignInDeps {
  host: SignInHost;
  listen: ListenLoopback;
  port: Pick<ClientPort, 'openExternal'>; // the client port (OX4): the engine's authorization URL, in the asking client's browser
  emit(event: ConnectorSignInChanged): void;
  ready(appSessionId: string): boolean; // the session's process is ready now
  onSessionGone(listener: (appSessionId: string) => void): () => void; // its process left ready
  check(entry: ConnectorConfiguration & { path: string; appSessionId: string }): Promise<string | null>; // why the session's engine does not use this entry, or null
  callbackMs?: number;
  pollMs?: number;
  settleMs?: number;
  configMs?: number;
  configPollMs?: number;
  log?: (line: string) => void;
}

/** A configured connector: its name and scope, and the directory for a project or local one (a user one is the same
 * from every directory). */
export interface ConnectorConfiguration {
  name: string;
  scope: 'user' | 'project' | 'local';
  cwd: string | null;
}
export const connectorKey = ({ name, scope, cwd }: ConnectorConfiguration): string => [scope, scope === 'user' ? '' : (cwd ?? ''), name].join('\u0000');

export interface SignIn {
  start(input: ConnectorConfiguration & { path: string; appSessionId: string }, client: ClientRef | null): { opId: string };
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
  connector: string; // connectorKey
  configuration: ConnectorConfiguration & { path: string }; // the entry asked for
  appSessionId: string;
  client: ClientRef | null; // who asked: the browser the authorization URL opens in
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
  const byConnector = new Map<string, string>(); // a configured connector (connectorKey) → its live opId
  const byFlow = new Map<string, string>(); // the engine's flow (flowKey: the session and the server name) → its live opId
  const flowKey = (op: { appSessionId: string; name: string }) => `${op.appSessionId}\u0000${op.name}`;
  // scalpel-2#2: the engine's mcp_authenticate sets its flow up after discovery and installs it when done, so a call still
  // in flight could replace a later call's flow. Each flow's calls go one after another: a replacement's waits for the
  // cancelled operation's to answer (its answer is then dropped), and a call whose operation ended first is not sent.
  const authTail = new Map<string, Promise<unknown>>(); // flowKey → the last mcp_authenticate sent or queued for it
  const authenticateInOrder = (op: Operation, input: CommandInput<'session.mcpAuthenticate'>) => {
    const key = flowKey(op);
    const call = (authTail.get(key) ?? Promise.resolve()).then(() => (live(op) ? ask(op, 'session.mcpAuthenticate', input) : null));
    const tail = call.catch(() => {});
    authTail.set(key, tail);
    void tail.then(() => authTail.get(key) === tail && authTail.delete(key));
    return call;
  };

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
      if (byConnector.get(op.connector) === op.opId) byConnector.delete(op.connector);
      if (byFlow.get(flowKey(op)) === op.opId) byFlow.delete(flowKey(op));
    }
    deps.emit({ opId: op.opId, name: op.name, state, reason: extra.reason ?? null, message: extra.message ?? null, where: extra.where ?? null });
  };
  const fail = (op: Operation, reason: Reason, message: string | null = null) => move(op, 'failed', { reason, message });
  // A step the operation takes after `ms` if it is still live; the answer clears it sooner.
  const later = (op: Operation, ms: number, run: () => void): (() => void) => {
    const timer = setTimeout(() => {
      op.timers.delete(timer);
      if (live(op)) run();
    }, ms);
    op.timers.add(timer);
    return () => {
      clearTimeout(timer);
      op.timers.delete(timer);
    };
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
    const refusal = await deps.check({ ...op.configuration, appSessionId: op.appSessionId });
    if (!live(op)) return;
    if (refusal !== null) return fail(op, 'other_entry', refusal);
    const before = await serverOf(op); // the baseline: a connection already there is not this flow's
    if (before === undefined || !live(op)) return;
    if (before?.status === 'connected') return move(op, 'done', { where: 'here', message: ALREADY_CONNECTED });
    let expected: string | null = null; // the engine's state, once it answered
    let port = 0;
    let endWait = () => {}; // clears waiting_callback's deadline once the callback is taken
    const handle = (request: LoopbackRequest): LoopbackReply => {
      const url = new URL(request.url, `http://${OAUTH_CALLBACK_HOST}:${port}`);
      if (!live(op) || op.state !== 'waiting_callback' || request.method !== 'GET' || url.pathname !== '/callback' || expected === null || url.searchParams.get('state') !== expected) return { status: 400, body: PAGE.waiting };
      const declined = url.searchParams.has('error');
      const listener = op.listener;
      op.listener = null;
      endWait();
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
    const authenticate = () => authenticateInOrder(op, { appSessionId: op.appSessionId, serverName: op.name, redirectUri: `http://${OAUTH_CALLBACK_HOST}:${port}/callback` });
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
    // Ready for the browser's return before asking the port to open it: the browser can finish before the port answers.
    let waiting: State;
    if (redirectScheme === 'custom' && typeof state === 'string') {
      expected = state;
      move(op, (waiting = 'waiting_callback'));
      endWait = later(op, callbackMs, () => fail(op, 'timeout'));
    } else {
      // the engine's own listener receives the redirect; MAWS's is not needed
      void op.listener?.close();
      op.listener = null;
      move(op, (waiting = 'watching_status'));
      watch(op, Date.now() + callbackMs, false);
    }
    let notOpened: string | null; // why the hand-off failed, an answer's reason or a throw's message; null once opened
    try {
      const opened = await deps.port.openExternal(op.client, { url: authUrl });
      notOpened = isNoClient(opened) ? NO_CLIENT_REASON : opened.opened ? null : opened.reason;
    } catch (error) {
      notOpened = error instanceof Error ? error.message : String(error);
    }
    // only an operation still waiting on that browser fails: a callback, a cancel or an end meanwhile stands
    if (notOpened !== null && live(op) && op.state === waiting) fail(op, 'engine', `the authorization URL was not opened: ${notOpened}`);
  }

  const unsubscribe = deps.onSessionGone((appSessionId) => {
    for (const op of [...operations.values()]) if (op.appSessionId === appSessionId) fail(op, 'session_exited');
  });

  return {
    start({ name, scope, cwd, path, appSessionId }, client) {
      const connector = connectorKey({ name, scope, cwd });
      // the connector's running sign-in, and the one driving this session's engine flow for the name
      for (const previous of new Set([byConnector.get(connector), byFlow.get(flowKey({ appSessionId, name }))])) {
        const op = previous === undefined ? undefined : operations.get(previous);
        if (op) move(op, 'cancelled');
      }
      const op: Operation = { opId: randomUUID(), name, connector, configuration: { name, scope, cwd, path }, appSessionId, client, state: 'starting', listener: null, timers: new Set() };
      operations.set(op.opId, op);
      byConnector.set(connector, op.opId);
      byFlow.set(flowKey(op), op.opId);
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
  onSessionStatus(listener: (payload: { appSessionId: string; status: { process: string; cwd: string } }) => void): () => void;
  onHostLost(listener: () => void): () => void; // the engine host left ready: every session with it
  port: Pick<ClientPort, 'openExternal'>;
  listen: ListenLoopback;
}

// `connectors.signIn` and `connectors.signInCancel`, over the sessions main hears ready from the engine host.
export function startSignIn(deps: SignInServiceDeps): { stop(): void } {
  const ready = new Map<string, string>(); // a ready session → its directory
  const goneListeners = new Set<(appSessionId: string) => void>();
  const gone = (appSessionId: string) => {
    ready.delete(appSessionId);
    for (const listener of goneListeners) listener(appSessionId);
  };
  const offStatus = deps.onSessionStatus(({ appSessionId, status }) => {
    if (status.process === 'ready') ready.set(appSessionId, status.cwd);
    else if (ready.has(appSessionId)) gone(appSessionId);
  });
  const offHost = deps.onHostLost(() => [...ready.keys()].forEach(gone));
  // the entries the session's engine reads, from its own directory, as the inventory reads them (scalpel-2#1), and the
  // server it holds, as its mcp_status reports it (fix-D#4)
  const check: SignInDeps['check'] = async ({ appSessionId, ...requested }) => {
    const cwd = ready.get(appSessionId);
    if (cwd === undefined) return 'that session is not ready';
    const [read, status] = await Promise.all([deps.host.call('customization.serverEndpoints', { cwd }), deps.host.call('session.mcpStatus', { appSessionId })]);
    if (!read.ok) return `that session’s configuration could not be read: ${read.error.message}`;
    if (!status.ok) return `that session’s servers could not be read: ${status.error.message}`;
    return entryRefusal(requested, cwd, read.value.servers, status.value.mcpServers);
  };
  const signIn = createSignIn({
    host: deps.host,
    listen: deps.listen,
    port: deps.port,
    emit: (event) => void deps.emit('connectors.signInChanged', event),
    ready: (appSessionId) => ready.has(appSessionId),
    onSessionGone: (listener) => (goneListeners.add(listener), () => goneListeners.delete(listener)),
    check,
  });
  deps.register('connectors.signIn', ({ name, scope, cwd, path, appSessionId }, { client }) => signIn.start({ name, scope, cwd, path, appSessionId }, client));
  deps.register('connectors.signInCancel', ({ opId }) => ({ cancelled: signIn.cancel(opId) }));
  return {
    stop() {
      offStatus();
      offHost();
      signIn.stop();
    },
  };
}
