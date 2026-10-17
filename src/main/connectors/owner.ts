// P3-HD M3c2: the owner's per-server rows and actions in H's Connectors sheet, main's half
// (docs/doperpowers/plans/2026-10-17-p3-hd-direct-route.md, "OAuth custody and owner controls", M3 and Decision Log 19,
// 21, 22, 29, 30 and 33). Trusted owner commands (`connectors.servers`, `.connect`, `.reconnect`, `.disconnect`), never a
// page's: the portable ArtifactHost has no OAuth.
//
// - Rows bind the source each tool actually uses: a tool's own selection (route D's ranking, the grant's source first),
//   else, while no listing knows the tool yet, the server's source alone (`toolMissing`'s fallback, which lets the owner's
//   Connect list the tools). An HTTP row is one saved identity (./oauth-types.ts) with every selected source as a member;
//   a stdio row is one source, since its directory is part of what it launches. A server no tool reaches is a
//   session's alone, with the closed reason. A row crosses to the window as safe fields and an opaque handle.
// - The handle is revalidated at the action: each tool of the row is selected again and only the sources still giving
//   the row's identity are used, never a first-directory substitute; none left is `stale`.
// - Connect makes MAWS's own connection usable and lists the tools on every member (initialize and tools/list, never a
//   tool call). It never pushes open HTTP into OAuth: with no saved MAWS sign-in, a listing without a credential is tried
//   first, and only the server's refusal leads to the provider's flow. A usable saved sign-in is used without a browser;
//   an unusable one is `needsReconnect`, never a new consent. Reconnect is the provider's explicit replacement.
// - Bounds live in the owner operation, not in a window dropping a late answer: a query aborts its resolutions at
//   OWNER_QUERY_DEADLINE_MS and answers with what it has; an action is acknowledged at once and runs under its own
//   controller (its deadline, the host's loss and main's stop abort the provider's flow and the host's discoveries).
//   Its end, and its start, are `connectors.serversChanged {artifactId}` to the windows that read rows: they read again.
// - Disconnect takes a saved connection's id alone (no current source, no decryption). A retirement the host has not
//   confirmed stays visible as its own row, retryable, after the provider has forgotten the record (`disconnecting` is the
//   provider's, separate from `saved`). Forgetting an unreadable record withdraws, for this main's lifetime, every HTTP
//   source without its own MAWS sign-in from automatic use (the provider's rule, Decision Log 33); the answer says so.
import { randomUUID } from 'node:crypto';
import type { ConnectorGrant, ConnectorToolRef } from '@shared/artifacts/connectors';
import { eventChannel } from '@shared/ipc/schema';
import {
  CONNECTOR_OWNER_FAILURES, type ConnectorOwnerAck, type ConnectorOwnerFailure, type ConnectorServerRow, type ConnectorServers, type DirectDiscoverAnswer, type DirectReason, type DirectSource,
} from '@shared/ipc/schema/connectors';
import { validateEventPayload } from '@shared/ipc/validate';
import type { DirectRoute } from './direct-route';
import type { ConnectorOAuthConnectFailure, ConnectorOAuthProvider, ConnectorOAuthState } from './oauth-provider';
import type { ConnectorOAuthSaved } from './oauth-store';
import { oauthIdentityOf, type ConnectorOAuthIdentity } from './oauth-types';

// Every provider and host word an action can end with is a word the window's schema knows.
type Covered<T extends ConnectorOwnerFailure> = T;
export type OwnerFailureCoverage = Covered<ConnectorOAuthConnectFailure | DirectReason>;

export const OWNER_QUERY_DEADLINE_MS = 15_000;
// The provider's flow (120 s from its listener) and a discovery (180 s), with slack.
export const OWNER_ACTION_DEADLINE_MS = 330_000;
export const OWNER_ACTION_LIMIT = 16; // owner actions running at once
const RESOLVE_CONCURRENCY = 8; // route D keeps 64 operations pending; a sheet's query leaves room for the pages
const MEMBER_LIMIT = 16; // sources discovered per row
const HANDLE_LIMIT = 1_024;
const MEMORY_LIMIT = 1_024; // last outcomes and retirements remembered
const VIEWER_ARTIFACT_LIMIT = 64;

export interface ConnectorOwnerViewer {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
  once(event: 'destroyed', listener: () => void): unknown;
}

export interface ConnectorOwnerDeps {
  direct: Pick<DirectRoute, 'resolveSource' | 'discover'>;
  oauth: Pick<ConnectorOAuthProvider, 'state' | 'saved' | 'connect' | 'reconnect' | 'disconnect' | 'disconnecting'> | null; // null: no OAuth of MAWS's own
  grants(artifactId: string): Promise<ConnectorGrant[]>; // the artifact's durable grants
  log?: (line: string) => void;
}

export interface ConnectorOwner {
  servers(artifactId: string, tools: readonly ConnectorToolRef[], viewer: ConnectorOwnerViewer): Promise<ConnectorServers>;
  connect(artifactId: string, sourceHandle: string): ConnectorOwnerAck;
  reconnect(artifactId: string, sourceHandle: string): ConnectorOwnerAck;
  disconnect(connectionId: string): ConnectorOwnerAck;
  hostLost(): void; // main's attachment to the engine host ended: running actions end, rows are read again
  stop(): void;
}

type Selection = { ok: true; source: DirectSource; known: boolean } | { ok: false; why: Extract<ConnectorServerRow, { kind: 'engineOnly' }>['why'] };
type Last = NonNullable<Extract<ConnectorServerRow, { kind: 'source' }>['last']>;
type Origin = { server: string; scope: 'user' | 'local'; path: string };
interface Handle {
  readonly id: string;
  readonly artifactId: string;
  readonly key: string;
  readonly server: string;
  tools: string[];
}
interface Action {
  readonly kind: 'connect' | 'reconnect';
  readonly controller: AbortController;
}

const identityKey = (identity: ConnectorOAuthIdentity) => JSON.stringify([identity.requestUrl, identity.server, identity.scope, identity.configPath, identity.entryPath]);
// The row a source belongs to: HTTP its saved identity, stdio the source itself.
const rowKeyOf = (source: DirectSource): string => {
  const identity = oauthIdentityOf(source);
  return identity ? `http\0${identityKey(identity)}` : `stdio\0${source.sourceId}`;
};
const failure = (why: string): ConnectorOwnerFailure => ((CONNECTOR_OWNER_FAILURES as readonly string[]).includes(why) ? (why as ConnectorOwnerFailure) : 'failed');
const remember = <K, V>(map: Map<K, V>, key: K, value: V) => {
  map.delete(key);
  map.set(key, value);
  if (map.size > MEMORY_LIMIT) map.delete(map.keys().next().value as K);
};

// `work`'s answer, or `fallback` once `signal` aborts first.
function within<T>(work: Promise<T>, signal: AbortSignal, fallback: T): Promise<T> {
  if (signal.aborted) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    const end = () => resolve(fallback);
    signal.addEventListener('abort', end, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', end);
        resolve(value);
      },
      () => {
        signal.removeEventListener('abort', end);
        resolve(fallback);
      },
    );
  });
}

// Runs `each` over `items`, `limit` at a time, in order of the answers' places.
async function pooled<T, R>(items: readonly T[], limit: number, each: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      out[at] = await each(items[at]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function connectionOf(state: ConnectorOAuthState): NonNullable<Extract<ConnectorServerRow, { kind: 'source' }>['connection']> {
  switch (state.state) {
    case 'disconnected':
      return { state: 'none' };
    case 'connecting':
    case 'connected':
    case 'needsReconnect':
      return { state: state.state, connectionId: state.connectionId };
    case 'unavailable':
      return { state: 'unavailable', why: state.why };
    default:
      return { state: state.state };
  }
}

export function createConnectorOwner(deps: ConnectorOwnerDeps): ConnectorOwner {
  const { direct, oauth } = deps;
  const log = deps.log ?? ((line: string) => console.warn(`[connectors] ${line}`));
  const handles = new Map<string, Handle>(); // by id
  const handleIds = new Map<string, string>(); // `${artifactId}\0${key}` → id
  const actions = new Map<string, Action>(); // by row key
  const lastByKey = new Map<string, Last>();
  const lastByConnection = new Map<string, Last>();
  const labels = new Map<string, Origin | 'unreadable'>(); // what a listing last showed for a connection id
  const retiring = new Map<string, Origin | null>(); // connections the owner disconnected, by id
  const disconnects = new Set<string>(); // in flight
  const viewers = new Map<number, { viewer: ConnectorOwnerViewer; artifacts: Set<string> }>();
  const queries = new Set<AbortController>();
  let withdrawnUnattributed = false;
  let stopped = false;

  // ── invalidation, to the windows that read rows ──

  function listen(viewer: ConnectorOwnerViewer, artifactId: string): void {
    let entry = viewers.get(viewer.id);
    if (!entry) {
      if (viewer.isDestroyed()) return;
      entry = { viewer, artifacts: new Set() };
      viewers.set(viewer.id, entry);
      viewer.once('destroyed', () => viewers.delete(viewer.id));
    }
    entry.artifacts.delete(artifactId);
    entry.artifacts.add(artifactId);
    if (entry.artifacts.size > VIEWER_ARTIFACT_LIMIT) entry.artifacts.delete(entry.artifacts.values().next().value as string);
  }

  // A saved connection is one identity shared by every artifact naming it, so any change reaches every row read.
  function changed(): void {
    for (const [id, { viewer, artifacts }] of viewers) {
      if (viewer.isDestroyed()) {
        viewers.delete(id);
        continue;
      }
      for (const artifactId of artifacts) {
        const checked = validateEventPayload('connectors.serversChanged', { artifactId });
        if (checked.ok) viewer.send(eventChannel('connectors.serversChanged'), checked.value);
      }
    }
  }

  function handleFor(artifactId: string, key: string, server: string, tools: string[]): string {
    const at = `${artifactId}\0${key}`;
    const known = handleIds.get(at);
    const held = known === undefined ? undefined : handles.get(known);
    if (held) {
      held.tools = tools;
      return held.id;
    }
    const handle: Handle = { id: randomUUID(), artifactId, key, server, tools };
    handles.set(handle.id, handle);
    handleIds.set(at, handle.id);
    if (handles.size > HANDLE_LIMIT) {
      const oldest = handles.values().next().value as Handle;
      handles.delete(oldest.id);
      handleIds.delete(`${oldest.artifactId}\0${oldest.key}`);
    }
    return handle.id;
  }

  // ── selection: the source a tool uses ──

  function selector(artifactId: string, signal: AbortSignal) {
    const alone = new Map<string, Promise<Selection>>(); // the server's source alone, once per pass
    const sourceOnly = (server: string) => {
      let answer = alone.get(server);
      if (!answer) {
        answer = direct.resolveSource(artifactId, server, signal).then((found): Selection => (found.ok ? { ok: true, source: found.source, known: false } : { ok: false, why: found.why }));
        alone.set(server, answer);
      }
      return answer;
    };
    return async (tool: ConnectorToolRef): Promise<Selection> => {
      try {
        const found = await direct.resolveSource(artifactId, tool.server, signal, tool.tool);
        if (found.ok) return { ok: true, source: found.source, known: found.tool !== undefined };
        if (found.why === 'toolMissing') return await sourceOnly(tool.server);
        return { ok: false, why: found.why };
      } catch {
        return { ok: false, why: 'unavailable' };
      }
    };
  }

  // ── the rows ──

  async function servers(artifactId: string, asked: readonly ConnectorToolRef[], viewer: ConnectorOwnerViewer): Promise<ConnectorServers> {
    if (stopped) throw new Error('the connector service has stopped');
    listen(viewer, artifactId);
    const query = new AbortController();
    queries.add(query);
    const deadline = setTimeout(() => query.abort(), OWNER_QUERY_DEADLINE_MS);
    try {
      return await read(artifactId, asked, query.signal);
    } finally {
      clearTimeout(deadline);
      queries.delete(query);
    }
  }

  async function read(artifactId: string, asked: readonly ConnectorToolRef[], signal: AbortSignal): Promise<ConnectorServers> {
    const tools = new Map<string, ConnectorToolRef>();
    for (const tool of [...asked, ...(await within(deps.grants(artifactId), signal, []))]) {
      const at = JSON.stringify([tool.server, tool.tool]);
      if (!tools.has(at) && tools.size < 256) tools.set(at, { server: tool.server, tool: tool.tool });
    }
    const select = selector(artifactId, signal);
    const selected = await pooled([...tools.values()], RESOLVE_CONCURRENCY, async (tool) => ({ tool, selection: await select(tool) }));

    // group by the row each selection belongs to, in the tools' order
    interface Group { key: string; source: DirectSource; tools: string[]; needsDiscovery: boolean }
    const groups = new Map<string, Group>();
    const refused = new Map<string, { server: string; why: Extract<Selection, { ok: false }>['why']; tools: string[] }>();
    for (const { tool, selection } of selected) {
      if (!selection.ok) {
        const at = `${tool.server}\0${selection.why}`;
        const entry = refused.get(at) ?? { server: tool.server, why: selection.why, tools: [] };
        entry.tools.push(tool.tool);
        refused.set(at, entry);
        continue;
      }
      const key = rowKeyOf(selection.source);
      const group = groups.get(key) ?? { key, source: selection.source, tools: [], needsDiscovery: false };
      group.tools.push(tool.tool);
      if (!selection.known) group.needsDiscovery = true;
      groups.set(key, group);
    }

    const rows: ConnectorServerRow[] = [];
    const shown = new Set<string>(); // connection ids a row already names
    for (const group of groups.values()) {
      const { source } = group;
      const origin: Origin = { server: source.server, scope: source.scope, path: source.path };
      const identity = oauthIdentityOf(source);
      let connection: Extract<ConnectorServerRow, { kind: 'source' }>['connection'];
      if (identity && oauth) {
        connection = connectionOf(await within(oauth.state(identity), signal, { state: 'unavailable', why: 'store' } as ConnectorOAuthState));
        if (connection.connectionId !== undefined) {
          labels.set(connection.connectionId, origin);
          shown.add(connection.connectionId);
          const leaving = oauth.disconnecting(connection.connectionId);
          if (leaving) connection = { ...connection, disconnecting: leaving };
        }
      }
      const action = actions.get(group.key);
      const last = lastByKey.get(group.key);
      rows.push({
        kind: 'source', handle: handleFor(artifactId, group.key, source.server, group.tools), ...origin, transport: source.transport, tools: group.tools, needsDiscovery: group.needsDiscovery,
        ...(connection && { connection }), ...(action && { action: action.kind === 'connect' ? 'connecting' : 'reconnecting' }), ...(last && { last }),
      });
    }
    for (const entry of refused.values()) rows.push({ kind: 'engineOnly', ...entry });

    // MAWS's saved connections of the named servers that no row uses, and those that cannot be read
    let saved: ConnectorServers['saved'] = 'ok';
    if (oauth) {
      const listed = await within<ConnectorOAuthSaved[] | null>(oauth.saved(), signal, null);
      if (listed === null) saved = 'unavailable';
      const named = new Set([...tools.values()].map((tool) => tool.server));
      const used = new Set([...groups.keys()]);
      for (const entry of listed ?? []) {
        if (shown.has(entry.connectionId)) continue;
        const disconnecting = oauth.disconnecting(entry.connectionId);
        const last = lastByConnection.get(entry.connectionId);
        const extra = { ...(disconnecting && { disconnecting }), ...(last && { last }) };
        if (entry.state === 'unreadable') {
          labels.set(entry.connectionId, 'unreadable');
          rows.push({ kind: 'unreadable', connectionId: entry.connectionId, ...extra });
        } else if (named.has(entry.identity.server) && !used.has(`http\0${identityKey(entry.identity)}`)) {
          const origin: Origin = { server: entry.identity.server, scope: entry.identity.scope, path: entry.identity.configPath };
          labels.set(entry.connectionId, origin);
          rows.push({ kind: 'saved', connectionId: entry.connectionId, ...origin, ...extra });
        } else {
          continue;
        }
        shown.add(entry.connectionId);
      }
      // forgotten connections whose withdrawal is still unconfirmed
      for (const [connectionId, origin] of [...retiring]) {
        const disconnecting = oauth.disconnecting(connectionId);
        if (disconnecting === null) {
          if (!disconnects.has(connectionId)) retiring.delete(connectionId);
          continue;
        }
        if (shown.has(connectionId)) continue;
        const last = lastByConnection.get(connectionId);
        rows.push({ kind: 'retiring', connectionId, ...(origin ?? {}), disconnecting, ...(last && { last }) });
      }
    }
    return { servers: rows.slice(0, 1_024), saved, withdrawnUnattributed };
  }

  // ── actions ──

  function start(kind: Action['kind'], artifactId: string, sourceHandle: string): ConnectorOwnerAck {
    if (stopped) return { accepted: false, why: 'stopped' };
    const handle = handles.get(sourceHandle);
    if (!handle || handle.artifactId !== artifactId) return { accepted: false, why: 'stale' };
    if (actions.has(handle.key)) return { accepted: false, why: 'busy' };
    if (actions.size >= OWNER_ACTION_LIMIT) return { accepted: false, why: 'capacity' };
    const controller = new AbortController();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, OWNER_ACTION_DEADLINE_MS);
    const action: Action = { kind, controller };
    actions.set(handle.key, action);
    const release = () => {
      if (actions.get(handle.key) === action) actions.delete(handle.key); // the row is free the moment its action ends
    };
    controller.signal.addEventListener('abort', release, { once: true });
    changed();
    const tools = [...handle.tools];
    // the action ends when its lifetime does, whether or not what it awaits has answered (told by the same signal)
    const cancelled: Last = { action: kind, ok: false, why: 'cancelled' };
    const work = run(kind, artifactId, handle.key, handle.server, tools, controller.signal).catch((): Last => ({ action: kind, ok: false, why: 'failed' }));
    void within(work, controller.signal, cancelled)
      .then((last) => {
        const ended: Last = controller.signal.aborted ? { action: kind, ok: false, why: timedOut ? 'timeout' : 'cancelled' } : last;
        remember(lastByKey, handle.key, ended);
      })
      .finally(() => {
        clearTimeout(deadline);
        controller.signal.removeEventListener('abort', release);
        release();
        if (!stopped) changed();
      });
    return { accepted: true };
  }

  // The row's current members: each of its tools selected again, keeping the sources still giving the row's identity.
  async function members(artifactId: string, key: string, tools: string[], server: string, signal: AbortSignal): Promise<DirectSource[]> {
    const select = selector(artifactId, signal);
    const found = await pooled(tools, RESOLVE_CONCURRENCY, (tool) => select({ server, tool }));
    const unique = new Map<string, DirectSource>();
    for (const selection of found) {
      if (selection.ok && rowKeyOf(selection.source) === key) unique.set(`${selection.source.directory}\0${selection.source.sourceId}\0${selection.source.generation}`, selection.source);
    }
    return [...unique.values()].slice(0, MEMBER_LIMIT);
  }

  // Every member's tools listed; the first refusal names the outcome.
  async function discoverAll(kind: Action['kind'], sources: DirectSource[], signal: AbortSignal, credential: 'none' | 'maws'): Promise<{ last: Last; unauthorized: boolean }> {
    const answers: DirectDiscoverAnswer[] = await Promise.all(sources.map((source) => direct.discover(source, signal).catch((): DirectDiscoverAnswer => ({ ok: false, failure: 'failed', reason: 'connection' }))));
    const refused = answers.find((answer) => !answer.ok);
    if (refused && !refused.ok) return { last: { action: kind, ok: false, why: failure(refused.reason) }, unauthorized: answers.some((answer) => !answer.ok && answer.reason === 'unauthorized') };
    const names = new Set(answers.flatMap((answer) => (answer.ok ? answer.tools.map((tool) => tool.name) : [])));
    return { last: { action: kind, ok: true, tools: Math.min(names.size, 1_024), credential }, unauthorized: false };
  }

  async function run(kind: Action['kind'], artifactId: string, key: string, server: string, tools: string[], signal: AbortSignal): Promise<Last> {
    const fail = (why: ConnectorOwnerFailure): Last => ({ action: kind, ok: false, why });
    const sources = await members(artifactId, key, tools, server, signal);
    if (signal.aborted) return fail('cancelled');
    if (sources.length === 0) return fail('stale');
    const [first] = sources as [DirectSource];
    const identity = oauthIdentityOf(first);
    if (!identity || !oauth) return (await discoverAll(kind, sources, signal, 'none')).last;
    if (kind === 'reconnect') {
      const replaced = await oauth.reconnect(first, signal);
      if (!replaced.ok) return fail(failure(replaced.why));
      return (await discoverAll(kind, sources, signal, 'maws')).last;
    }
    const state = await within(oauth.state(identity), signal, { state: 'unavailable', why: 'store' } as ConnectorOAuthState);
    if (signal.aborted) return fail('cancelled');
    switch (state.state) {
      case 'connected':
        return (await discoverAll(kind, sources, signal, 'maws')).last;
      case 'needsReconnect':
        return fail('needsReconnect');
      case 'connecting':
        return fail('busy');
      case 'unavailable':
        return fail('unavailable');
      case 'disconnected': {
        // no MAWS sign-in saved: the server may be open, and is never pushed into OAuth unless it refuses
        const open = await discoverAll(kind, sources, signal, 'none');
        if (!open.unauthorized || signal.aborted) return open.last;
        break;
      }
      default: // needsConnect, withdrawn: the owner's explicit Connect
        break;
    }
    const connected = await oauth.connect(first, signal);
    if (!connected.ok) return fail(failure(connected.why));
    return (await discoverAll(kind, sources, signal, 'maws')).last;
  }

  // ── Disconnect ──

  function disconnect(connectionId: string): ConnectorOwnerAck {
    if (stopped) return { accepted: false, why: 'stopped' };
    if (!oauth) return { accepted: false, why: 'stale' };
    if (disconnects.has(connectionId)) return { accepted: false, why: 'busy' };
    const label = labels.get(connectionId);
    if (label === 'unreadable') withdrawnUnattributed = true; // whose it was is unknown: the provider withdraws (Decision Log 33)
    remember(retiring, connectionId, label === undefined || label === 'unreadable' ? null : label);
    disconnects.add(connectionId);
    changed();
    void oauth
      .disconnect(connectionId)
      .then((result) => remember(lastByConnection, connectionId, { action: 'disconnect', ...result }))
      .catch(() => log('connectors: a MAWS connection could not be disconnected'))
      .finally(() => {
        disconnects.delete(connectionId);
        if (!stopped) changed();
      });
    return { accepted: true };
  }

  return {
    servers,
    connect: (artifactId, sourceHandle) => start('connect', artifactId, sourceHandle),
    reconnect: (artifactId, sourceHandle) => start('reconnect', artifactId, sourceHandle),
    disconnect,
    hostLost() {
      for (const action of actions.values()) action.controller.abort();
      changed();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const action of actions.values()) action.controller.abort();
      for (const query of queries) query.abort();
      viewers.clear();
    },
  };
}
