// P3-HD M3c2: the owner's per-server connector rows and actions in main (./owner.ts; docs/doperpowers/plans/
// 2026-10-17-p3-hd-direct-route.md, M3 and Decision Log 19, 21, 22, 29, 30 and 33), over a scripted route D and OAuth
// provider. Rows bind the source each tool actually selects, revalidated at the action; HTTP rows coalesce by saved
// identity with every member discovered, stdio rows stay per source; open HTTP is never pushed into OAuth; actions
// acknowledge at once, run inside their own bounded lifetime and end with a targeted invalidation.
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorGrant } from '@shared/artifacts/connectors';
import { eventChannel } from '@shared/ipc/schema';
import type { ConnectorServers, DirectDiscoverAnswer, DirectSource } from '@shared/ipc/schema/connectors';
import { validateCommandOutput } from '@shared/ipc/validate';
import type { ConnectorOAuthProvider, ConnectorOAuthState } from './oauth-provider';
import type { ConnectorOAuthSaved } from './oauth-store';
import { createConnectorOwner, OWNER_ACTION_DEADLINE_MS, OWNER_QUERY_DEADLINE_MS, type ConnectorOwner, type ConnectorOwnerDeps } from './owner';

const ART = '11111111-1111-4111-8111-111111111111';
const OTHER_ART = '11111111-1111-4111-8111-111111111112';
const SRC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SRC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SRC_S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONN = '33333333-3333-4333-8333-333333333333';
const CONN_OLD = '44444444-4444-4444-8444-444444444444';
const CONN_BAD = '55555555-5555-4555-8555-555555555555';
const URL_SECRET = 'https://notes.example/mcp?key=s3cret';

const http = (sourceId: string, directory: string, over: Partial<DirectSource> = {}): DirectSource => ({
  directory, sourceId, generation: 1, server: 'notes', scope: 'user', transport: 'http', path: '/Users/me/.claude.json', entryPath: ['mcpServers', 'notes'], observedAt: '2026-10-17T00:00:00.000Z', resourceUrl: URL_SECRET, ...over,
});
const stdio = (sourceId: string, directory: string): DirectSource => ({
  directory, sourceId, generation: 1, server: 'files', scope: 'local', transport: 'stdio', path: '/Users/me/.claude.json', entryPath: ['projects', directory, 'mcpServers', 'files'], observedAt: '2026-10-17T00:00:00.000Z',
});
const FP = 'f'.repeat(64);
const known = { fingerprint: FP, readOnly: true };
type Resolved = Awaited<ReturnType<ConnectorOwnerDeps['direct']['resolveSource']>>;

class Viewer extends EventEmitter {
  readonly sent: unknown[] = [];
  destroyed = false;
  constructor(readonly id: number) {
    super();
  }
  isDestroyed = () => this.destroyed;
  send = (channel: string, payload: unknown) => {
    expect(channel).toBe(eventChannel('connectors.serversChanged'));
    this.sent.push(payload);
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let selections: Map<string, Resolved | ((signal: AbortSignal) => Promise<Resolved>)>;
let discoveries: Map<string, (signal: AbortSignal) => Promise<DirectDiscoverAnswer>>;
let discovered: { sourceId: string; directory: string }[];
let grants: ConnectorGrant[];
let states: Map<string, ConnectorOAuthState>;
let saved: ConnectorOAuthSaved[] | null;
let disconnecting: Map<string, 'pending' | 'unconfirmed'>;
let provider: ConnectorOAuthProvider & { [K in 'connect' | 'reconnect' | 'disconnect' | 'state']: ReturnType<typeof vi.fn> };
let owner: ConnectorOwner;
let viewer: Viewer;

const key = (server: string, tool?: string) => `${server}/${tool ?? ''}`;
const ok = (source: DirectSource, tool?: typeof known): Resolved => ({ ok: true, source, ...(tool && { tool }) });
const listed = (count: number): DirectDiscoverAnswer => ({ ok: true, tools: Array.from({ length: count }, (_, i) => ({ name: `t${i}`, readOnly: true })) });
const settle = async () => {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  selections = new Map();
  discoveries = new Map();
  discovered = [];
  grants = [];
  states = new Map();
  saved = [];
  disconnecting = new Map();
  viewer = new Viewer(1);
  provider = {
    state: vi.fn(async (identity: { requestUrl: string; server: string }) => states.get(identity.server) ?? { state: 'disconnected' }),
    saved: vi.fn(async () => saved),
    connect: vi.fn(async () => ({ ok: true, connectionId: CONN, reused: false })),
    reconnect: vi.fn(async () => ({ ok: true, connectionId: CONN, reused: false })),
    disconnect: vi.fn(async () => ({ local: 'forgotten', host: 'confirmed', revocation: 'revoked' })),
    disconnecting: (connectionId: string) => disconnecting.get(connectionId) ?? null,
    prepare: vi.fn(),
    unauthorized: vi.fn(),
    hostLost: vi.fn(),
    stop: vi.fn(),
  } as never;
  owner = createConnectorOwner({
    direct: {
      resolveSource: async (_artifactId, server, signal, tool) => {
        const scripted = selections.get(key(server, tool));
        if (scripted === undefined) return { ok: false, why: 'unobserved' };
        return typeof scripted === 'function' ? scripted(signal) : scripted;
      },
      discover: async (source, signal) => {
        discovered.push({ sourceId: source.sourceId, directory: source.directory });
        return (discoveries.get(source.sourceId) ?? (async () => listed(2)))(signal);
      },
    },
    oauth: provider,
    grants: async () => grants,
    log: () => {},
  });
});
afterEach(() => {
  owner.stop();
  vi.useRealTimers();
});

async function rows(artifactId = ART, tools = [{ server: 'notes', tool: 'search' }], from: Viewer = viewer): Promise<ConnectorServers> {
  const answer = owner.servers(artifactId, tools, from as never);
  await settle();
  const value = await answer;
  expect(validateCommandOutput('connectors.servers', value).ok, JSON.stringify(value)).toBe(true);
  return value;
}
const handleOf = (answer: ConnectorServers, server: string) => {
  const row = answer.servers.find((entry) => entry.kind === 'source' && entry.server === server);
  if (!row || row.kind !== 'source') throw new Error(`no source row for ${server}`);
  return row.handle;
};

describe('the owner’s server rows', () => {
  it('binds each tool’s selected source: HTTP coalesced by saved identity, stdio per source, refusals named; safe fields only', async () => {
    selections.set(key('notes', 'search'), ok(http(SRC_A, '/repo'), known));
    selections.set(key('notes', 'pages'), ok(http(SRC_B, '/space'), known)); // the same identity, another directory
    selections.set(key('files', 'read'), ok(stdio(SRC_S, '/repo'), known));
    selections.set(key('mail', 'send'), { ok: false, why: 'engineOnly' });
    const answer = await rows(ART, [{ server: 'notes', tool: 'search' }, { server: 'notes', tool: 'pages' }, { server: 'files', tool: 'read' }, { server: 'mail', tool: 'send' }]);
    expect(answer.servers).toEqual([
      { kind: 'source', handle: expect.any(String), server: 'notes', scope: 'user', transport: 'http', path: '/Users/me/.claude.json', tools: ['search', 'pages'], needsDiscovery: false, connection: { state: 'none' } },
      { kind: 'source', handle: expect.any(String), server: 'files', scope: 'local', transport: 'stdio', path: '/Users/me/.claude.json', tools: ['read'], needsDiscovery: false },
      { kind: 'engineOnly', server: 'mail', why: 'engineOnly', tools: ['send'] },
    ]);
    const text = JSON.stringify(answer);
    for (const secret of ['s3cret', 'notes.example', SRC_A, SRC_B, SRC_S]) expect(text).not.toContain(secret);
    expect(answer).toMatchObject({ saved: 'ok', withdrawnUnattributed: false });
  });

  it('unions the durable grants with the declared tools, and falls back to the source alone for a tool not yet listed', async () => {
    grants = [{ server: 'notes', tool: 'archive', fingerprint: FP, mode: 'read', grantedAt: 1 }];
    selections.set(key('notes', 'search'), { ok: false, why: 'toolMissing' });
    selections.set(key('notes', 'archive'), ok(http(SRC_A, '/repo'), { fingerprint: FP, grantBacked: true } as never));
    selections.set(key('notes'), ok(http(SRC_A, '/repo')));
    const answer = await rows();
    expect(answer.servers).toEqual([expect.objectContaining({ kind: 'source', server: 'notes', tools: ['search', 'archive'], needsDiscovery: true })]);
  });

  it('a row for the granted tool connects the source that tool selects, never the first unrelated source (Decision Log 22)', async () => {
    // two directories configure `notes` under different files; the grant matches the second one
    selections.set(key('notes', 'search'), ok(http(SRC_B, '/space', { path: '/Users/me/space/.claude.json' }), { fingerprint: FP, grantBacked: true } as never));
    selections.set(key('notes'), ok(http(SRC_A, '/repo'))); // the source-only answer: the first directory's
    states.set('notes', { state: 'needsConnect' });
    const answer = await rows();
    expect(answer.servers).toMatchObject([{ kind: 'source', path: '/Users/me/space/.claude.json' }]);
    expect(owner.connect(ART, handleOf(answer, 'notes'))).toEqual({ accepted: true });
    await settle();
    expect(provider.connect).toHaveBeenCalledWith(expect.objectContaining({ sourceId: SRC_B }), expect.any(AbortSignal));
    expect(discovered).toEqual([{ sourceId: SRC_B, directory: '/space' }]);
  });

  it('lists saved connections of named servers that no source uses, unreadable ones generically, and says when none can be read', async () => {
    selections.set(key('notes', 'search'), { ok: false, why: 'unobserved' }); // a cold start: no session reported it yet
    saved = [
      { state: 'sealed', connectionId: CONN_OLD, identity: { requestUrl: URL_SECRET, server: 'notes', scope: 'local', configPath: '/Users/me/.claude.json', entryPath: ['projects', '/repo', 'mcpServers', 'notes'] }, issuer: 'https://as.example', resource: URL_SECRET, savedAt: 1, refreshable: true },
      { state: 'sealed', connectionId: CONN, identity: { requestUrl: 'https://other/mcp', server: 'unrelated', scope: 'user', configPath: '/x', entryPath: [] }, issuer: 'https://as', resource: 'https://other/mcp', savedAt: 1, refreshable: true },
      { state: 'unreadable', connectionId: CONN_BAD },
    ];
    const answer = await rows();
    expect(answer.servers).toEqual([
      { kind: 'engineOnly', server: 'notes', why: 'unobserved', tools: ['search'] },
      { kind: 'saved', connectionId: CONN_OLD, server: 'notes', scope: 'local', path: '/Users/me/.claude.json' },
      { kind: 'unreadable', connectionId: CONN_BAD },
    ]);
    expect(JSON.stringify(answer)).not.toContain('as.example');
    saved = null;
    expect((await rows()).saved).toBe('unavailable');
  });

  it('bounds the query in its own lifetime: an unanswered resolution is aborted, and the rows still answer', async () => {
    let seen: AbortSignal | null = null;
    selections.set(key('notes', 'search'), (signal) => {
      seen = signal;
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false, why: 'unavailable' }), { once: true }));
    });
    provider.state.mockImplementation(() => new Promise(() => {}));
    const answer = owner.servers(ART, [{ server: 'notes', tool: 'search' }], viewer as never);
    await settle();
    expect(seen!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(OWNER_QUERY_DEADLINE_MS);
    expect(seen!.aborted).toBe(true);
    expect((await answer).servers).toEqual([{ kind: 'engineOnly', server: 'notes', why: 'unavailable', tools: ['search'] }]);
  });
});

describe('the owner’s Connect', () => {
  it('stdio: acknowledges at once, lists the tools of the source without OAuth, then invalidates the viewer’s rows', async () => {
    selections.set(key('files', 'read'), { ok: false, why: 'toolMissing' });
    selections.set(key('files'), ok(stdio(SRC_S, '/repo')));
    const listing = deferred<DirectDiscoverAnswer>();
    discoveries.set(SRC_S, () => listing.promise);
    const answer = await rows(ART, [{ server: 'files', tool: 'read' }]);
    expect(owner.connect(ART, handleOf(answer, 'files'))).toEqual({ accepted: true });
    await settle();
    expect(viewer.sent).toEqual([{ artifactId: ART }]); // started
    expect(discovered).toEqual([{ sourceId: SRC_S, directory: '/repo' }]);
    expect(provider.connect).not.toHaveBeenCalled();
    listing.resolve(listed(3));
    await settle();
    expect(viewer.sent).toEqual([{ artifactId: ART }, { artifactId: ART }]); // ended
    expect((await rows(ART, [{ server: 'files', tool: 'read' }])).servers[0]).toMatchObject({ last: { action: 'connect', ok: true, tools: 3, credential: 'none' } });
  });

  it('revalidates the handle at the action: a tool that now selects another source makes it stale, and nothing is discovered', async () => {
    selections.set(key('files', 'read'), ok(stdio(SRC_S, '/repo'), known));
    const answer = await rows(ART, [{ server: 'files', tool: 'read' }]);
    selections.set(key('files', 'read'), ok(stdio(SRC_A, '/other'), known));
    owner.connect(ART, handleOf(answer, 'files'));
    await settle();
    expect(discovered).toEqual([]);
    expect(owner.connect(OTHER_ART, handleOf(answer, 'files'))).toEqual({ accepted: false, why: 'stale' }); // another artifact's handle
    expect((await rows(ART, [{ server: 'files', tool: 'read' }])).servers[0]).not.toHaveProperty('last'); // the new source's row, no outcome of its own
  });

  it('open HTTP: a listing without credentials succeeds, so no OAuth flow ever starts', async () => {
    selections.set(key('notes', 'search'), ok(http(SRC_A, '/repo')));
    const answer = await rows();
    owner.connect(ART, handleOf(answer, 'notes'));
    await settle();
    expect(discovered).toEqual([{ sourceId: SRC_A, directory: '/repo' }]);
    expect(provider.connect).not.toHaveBeenCalled();
    expect((await rows()).servers[0]).toMatchObject({ connection: { state: 'none' }, last: { action: 'connect', ok: true, credential: 'none' } });
  });

  it('protected HTTP: an unauthorized listing leads to MAWS’s own sign-in, then every member is listed with it', async () => {
    selections.set(key('notes', 'search'), ok(http(SRC_A, '/repo')));
    selections.set(key('notes', 'pages'), ok(http(SRC_B, '/space')));
    let signedIn = false;
    for (const id of [SRC_A, SRC_B]) discoveries.set(id, async () => (signedIn ? listed(4) : { ok: false, failure: 'unavailable', reason: 'unauthorized' }));
    provider.connect.mockImplementation(async () => {
      signedIn = true;
      return { ok: true, connectionId: CONN, reused: false };
    });
    const answer = await rows(ART, [{ server: 'notes', tool: 'search' }, { server: 'notes', tool: 'pages' }]);
    owner.connect(ART, handleOf(answer, 'notes'));
    await settle();
    expect(provider.connect).toHaveBeenCalledTimes(1);
    expect(discovered.map((entry) => entry.sourceId).sort()).toEqual([SRC_A, SRC_A, SRC_B, SRC_B].sort());
    states.set('notes', { state: 'connected', connectionId: CONN, refreshable: true });
    expect((await rows(ART, [{ server: 'notes', tool: 'search' }, { server: 'notes', tool: 'pages' }])).servers[0]).toMatchObject({
      connection: { state: 'connected', connectionId: CONN }, last: { action: 'connect', ok: true, tools: 4, credential: 'maws' },
    });
  });

  it('a usable saved sign-in is used without a browser; a parked or withdrawn one asks the provider’s Connect', async () => {
    selections.set(key('notes', 'search'), ok(http(SRC_A, '/repo')));
    states.set('notes', { state: 'connected', connectionId: CONN, refreshable: true });
    owner.connect(ART, handleOf(await rows(), 'notes'));
    await settle();
    expect(provider.connect).not.toHaveBeenCalled();
    expect(discovered).toHaveLength(1);
    for (const state of [{ state: 'needsConnect' }, { state: 'withdrawn' }] as const) {
      states.set('notes', state);
      provider.connect.mockClear();
      owner.connect(ART, handleOf(await rows(), 'notes'));
      await settle();
      expect(provider.connect, state.state).toHaveBeenCalledTimes(1);
    }
  });

  it('an unusable saved sign-in asks for Reconnect rather than starting a new consent; Reconnect replaces it explicitly', async () => {
    selections.set(key('notes', 'search'), ok(http(SRC_A, '/repo')));
    states.set('notes', { state: 'needsReconnect', connectionId: CONN });
    owner.connect(ART, handleOf(await rows(), 'notes'));
    await settle();
    expect(provider.connect).not.toHaveBeenCalled();
    expect((await rows()).servers[0]).toMatchObject({ connection: { state: 'needsReconnect' }, last: { action: 'connect', ok: false, why: 'needsReconnect' } });
    expect(owner.reconnect(ART, handleOf(await rows(), 'notes'))).toEqual({ accepted: true });
    await settle();
    expect(provider.reconnect).toHaveBeenCalledWith(expect.objectContaining({ sourceId: SRC_A }), expect.any(AbortSignal));
    expect(discovered).toHaveLength(1);
  });

  it('keeps a failed listing honest beside a made connection', async () => {
    selections.set(key('notes', 'search'), ok(http(SRC_A, '/repo')));
    states.set('notes', { state: 'needsConnect' });
    discoveries.set(SRC_A, async () => ({ ok: false, failure: 'unavailable', reason: 'connection' }));
    owner.connect(ART, handleOf(await rows(), 'notes'));
    await settle();
    states.set('notes', { state: 'connected', connectionId: CONN, refreshable: true });
    expect((await rows()).servers[0]).toMatchObject({ connection: { state: 'connected' }, last: { action: 'connect', ok: false, why: 'connection' } });
  });

  it('one action per row at a time, shown while it runs', async () => {
    selections.set(key('notes', 'search'), ok(http(SRC_A, '/repo')));
    states.set('notes', { state: 'needsConnect' });
    provider.connect.mockImplementation(() => new Promise(() => {}));
    const handle = handleOf(await rows(), 'notes');
    expect(owner.connect(ART, handle)).toEqual({ accepted: true });
    await settle();
    expect(owner.reconnect(ART, handle)).toEqual({ accepted: false, why: 'busy' });
    expect((await rows()).servers[0]).toMatchObject({ action: 'connecting' });
  });

  it('the action’s own deadline aborts the provider’s flow and ends it as a timeout', async () => {
    selections.set(key('notes', 'search'), ok(http(SRC_A, '/repo')));
    states.set('notes', { state: 'needsConnect' });
    let signal: AbortSignal | null = null;
    provider.connect.mockImplementation((_source: DirectSource, given: AbortSignal) => {
      signal = given;
      return new Promise((resolve) => given.addEventListener('abort', () => resolve({ ok: false, why: 'cancelled' }), { once: true }));
    });
    owner.connect(ART, handleOf(await rows(), 'notes'));
    await settle();
    await vi.advanceTimersByTimeAsync(OWNER_ACTION_DEADLINE_MS);
    expect(signal!.aborted).toBe(true);
    expect((await rows()).servers[0]).toMatchObject({ last: { action: 'connect', ok: false, why: 'timeout' } });
    expect(owner.connect(ART, handleOf(await rows(), 'notes'))).toEqual({ accepted: true }); // the row is free again
  });

  it('the host’s loss and main’s stop end running actions; after stop nothing is accepted', async () => {
    selections.set(key('notes', 'search'), ok(http(SRC_A, '/repo')));
    states.set('notes', { state: 'needsConnect' });
    const signals: AbortSignal[] = [];
    provider.connect.mockImplementation((_source: DirectSource, given: AbortSignal) => {
      signals.push(given);
      return new Promise(() => {});
    });
    const handle = handleOf(await rows(), 'notes');
    owner.connect(ART, handle);
    await settle();
    viewer.sent.length = 0;
    owner.hostLost();
    expect(signals[0]!.aborted).toBe(true);
    expect(viewer.sent).toContainEqual({ artifactId: ART });
    owner.connect(ART, handle);
    await settle();
    owner.stop();
    expect(signals[1]!.aborted).toBe(true);
    expect(owner.connect(ART, handle)).toEqual({ accepted: false, why: 'stopped' });
    expect(owner.disconnect(CONN)).toEqual({ accepted: false, why: 'stopped' });
  });
});

describe('the owner’s Disconnect', () => {
  it('acknowledges at once, keeps an unconfirmed retirement visible and retryable after the record is forgotten', async () => {
    selections.set(key('notes', 'search'), ok(http(SRC_A, '/repo')));
    states.set('notes', { state: 'connected', connectionId: CONN, refreshable: true });
    await rows();
    const done = deferred<{ local: 'forgotten'; host: 'unconfirmed'; revocation: 'revoked' }>();
    provider.disconnect.mockImplementation(() => done.promise);
    disconnecting.set(CONN, 'pending');
    expect(owner.disconnect(CONN)).toEqual({ accepted: true });
    expect(owner.disconnect(CONN)).toEqual({ accepted: false, why: 'busy' });
    states.set('notes', { state: 'withdrawn' });
    let answer = await rows();
    expect(answer.servers).toEqual([
      expect.objectContaining({ kind: 'source', connection: { state: 'withdrawn' } }),
      { kind: 'retiring', connectionId: CONN, server: 'notes', scope: 'user', path: '/Users/me/.claude.json', disconnecting: 'pending' },
    ]);
    viewer.sent.length = 0;
    disconnecting.set(CONN, 'unconfirmed');
    done.resolve({ local: 'forgotten', host: 'unconfirmed', revocation: 'revoked' });
    await settle();
    expect(viewer.sent).toEqual([{ artifactId: ART }]);
    answer = await rows();
    expect(answer.servers[1]).toEqual({ kind: 'retiring', connectionId: CONN, server: 'notes', scope: 'user', path: '/Users/me/.claude.json', disconnecting: 'unconfirmed', last: { action: 'disconnect', local: 'forgotten', host: 'unconfirmed', revocation: 'revoked' } });
    provider.disconnect.mockImplementation(async () => ({ local: 'absent', host: 'confirmed', revocation: 'none' }));
    expect(owner.disconnect(CONN)).toEqual({ accepted: true }); // Retry
    disconnecting.delete(CONN);
    await settle();
    expect((await rows()).servers).toHaveLength(1); // confirmed: the retirement row goes
  });

  it('forgetting an unreadable saved connection needs no source, and its withdrawal is explained until relaunch (Decision Log 33)', async () => {
    saved = [{ state: 'unreadable', connectionId: CONN_BAD }];
    expect((await rows(ART, [{ server: 'notes', tool: 'search' }])).servers).toContainEqual({ kind: 'unreadable', connectionId: CONN_BAD });
    owner.disconnect(CONN_BAD);
    await settle();
    expect(provider.disconnect).toHaveBeenCalledWith(CONN_BAD);
    saved = [];
    expect((await rows()).withdrawnUnattributed).toBe(true);
  });

  it('invalidates only the windows that read rows, every artifact they read, and forgets a closed window', async () => {
    const other = new Viewer(2);
    const silent = new Viewer(3);
    await rows(ART, [{ server: 'notes', tool: 'search' }], viewer);
    await rows(OTHER_ART, [{ server: 'notes', tool: 'search' }], other);
    owner.disconnect(CONN);
    await settle();
    expect(viewer.sent).toContainEqual({ artifactId: ART });
    expect(other.sent).toContainEqual({ artifactId: OTHER_ART });
    expect(other.sent).not.toContainEqual({ artifactId: ART });
    expect(silent.sent).toEqual([]);
    other.destroyed = true;
    other.emit('destroyed');
    other.sent.length = 0;
    owner.disconnect(CONN_OLD);
    await settle();
    expect(other.sent).toEqual([]);
  });
});
