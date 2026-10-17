// P3-H H3b: route E's engine leg in the host (docs/doperpowers/plans/2026-10-12-p3-co-work.md, P3-H and Decision Log
// 24, 82, 83 and 85). A real artifact store (its grants, its commit barrier driven by hand where a race needs it) and a
// scripted engine behind a real ControlClient: what reaches the engine's stdin is the evidence, so "no mcp_call" means
// no mcp_call frame was written.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@shared/artifacts/actor';
import type { ConnectorGrantMode, ConnectorGrantRequest } from '@shared/artifacts/connectors';
import type { StdinFrame } from '@shared/wire/frames';
import type { JournalRow } from '@shared/wire/journal';
import { DocumentService } from '../documents/service';
import { SqliteDocumentStorage } from '../documents/storage';
import { ArtifactStore } from '../documents/store';
import { ControlClient } from '../rpc';
import type { EngineTransport } from '../transport';
import { ConnectorCalls, type ConnectorSessionView, type ConnectorStart } from './calls';

const human: Actor = { kind: 'human' };
const page = (text: string) => ({ bytes: new TextEncoder().encode(text) });
const SESSION = 'app-1';

// ── the scripted engine ──

type Request = Record<string, unknown> & { subtype: string };
type Envelope = { subtype: 'success'; response: unknown } | { subtype: 'error'; error: string };
interface Server {
  name: string;
  status: string;
  scope: string;
  config: Record<string, unknown>;
  tools?: { name: string; annotations?: Record<string, unknown> }[];
}
const fixtureServer = (): Server => ({
  name: 'fixture',
  status: 'connected',
  scope: 'project',
  config: { type: 'http', url: 'http://127.0.0.1:47831/mcp', headers: { Authorization: 'Bearer sentinel-header' } },
  tools: [{ name: 'rows', annotations: { readOnly: true } }, { name: 'send_document', annotations: {} }],
});

// The engine's stdin as the production transport serialises it (src/engine-host/transport.ts `write`): each frame waits
// its turn behind the writes ahead of it, and one whose signal aborted before its turn starts never reaches stdin.
// `stall` holds the writes ahead of the tool's own call (a large frame still draining, say) until released.
function scriptedEngine() {
  const writes: StdinFrame[] = []; // what reached stdin
  const queued: StdinFrame[] = []; // what was handed to the transport
  const state = {
    servers: [fixtureServer()] as Server[],
    // the engine's answer to an mcp_call; null leaves it running
    call: ((): Envelope | null => ({ subtype: 'success', response: { content: [{ type: 'text', text: 'rows 107 110' }], structuredContent: { rows: [107, 110] } } })) as (request: Request) => Envelope | null,
  };
  let stalled: Promise<void> | null = null;
  let chain: Promise<void> = Promise.resolve();
  const answer = (frame: StdinFrame) => {
    if (frame.type !== 'control_request') return;
    const request = frame.request as Request;
    const envelope: Envelope | null = request.subtype === 'mcp_status' ? { subtype: 'success', response: { mcpServers: structuredClone(state.servers) } } : request.subtype === 'mcp_call' ? state.call(request) : null;
    if (envelope) queueMicrotask(() => client.observe({ type: 'control_response', response: { ...envelope, request_id: frame.request_id } } as never));
  };
  const isToolCall = (frame: StdinFrame) => frame.type === 'control_request' && (frame.request as Request).subtype === 'mcp_call' && !String((frame.request as Request).tool).startsWith('mcp__maws_probe_');
  const transport: EngineTransport = {
    pid: null,
    frames: (async function* () {})(),
    stderr: (async function* () {})(),
    write: (frame, signal) =>
      new Promise<void>((resolve, reject) => {
        queued.push(frame);
        const onAbort = () => reject(new Error('write aborted'));
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort, { once: true });
        const ahead = isToolCall(frame) ? stalled : null;
        const turn = chain.then(async () => {
          await ahead; // the writes ahead of it, still draining
          if (signal?.aborted) return; // production's check as its turn starts: the frame never reaches stdin
          writes.push(frame);
          answer(frame);
        });
        chain = turn.catch(() => {});
        void turn.then(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, reject);
      }),
    endInput: () => {},
    kill: () => {},
    exited: new Promise(() => {}),
  };
  const rows: JournalRow[] = [];
  const client = new ControlClient(transport, { row: (direction, frame) => { const row = { seq: rows.length + 1, direction, at: '', frame }; rows.push(row); return row; } }, 'L1', { warn: () => {} });
  const calls = () => writes.filter((frame) => frame.type === 'control_request' && (frame.request as Request).subtype === 'mcp_call').map((frame) => (frame as { request: Request }).request);
  const cancels = () => writes.filter((frame) => frame.type === 'control_cancel_request');
  const queuedCalls = () => queued.filter(isToolCall);
  // Holds the tool's next call behind the stdin until the returned release runs.
  const stall = () => {
    let release!: () => void;
    stalled = new Promise((resolve) => (release = resolve));
    return () => {
      stalled = null;
      release();
    };
  };
  return { client, writes, state, calls, cancels, queuedCalls, stall };
}

// ── the store and the session ──

let dir: string;
let storage: SqliteDocumentStorage;
let service: DocumentService;
let store: ArtifactStore;
let turns: (() => void)[] | null;
let engine: ReturnType<typeof scriptedEngine>;
let session: { lifecycle: string; control: ControlClient | null; launchId: string; cwd: string };
let completed: string[];
let calls: ConnectorCalls;
let artifactId: string;
let fingerprint: string;

function make(options: { manual?: boolean } = {}): void {
  turns = options.manual ? [] : null;
  const defer = turns ? (run: () => void) => turns!.push(run) : undefined;
  storage = SqliteDocumentStorage.open(join(dir, 'store.sqlite'), { log: () => {} });
  service = new DocumentService(storage, { now: () => Date.now(), log: () => {}, kindOf: (id) => storage.kindOf(id), defer });
  store = new ArtifactStore(service, storage, { root: dir, log: () => {} });
}
const tick = () => {
  while (turns && turns.length > 0) turns.shift()!();
};
const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const view = (): ConnectorSessionView => ({ lifecycle: session.lifecycle, control: session.control, status: () => ({ launchId: session.launchId, cwd: session.cwd }) });
function makeCalls(options: Partial<ConstructorParameters<typeof ConnectorCalls>[0]> = {}): ConnectorCalls {
  return new ConnectorCalls({
    session: (id) => (id === SESSION ? view() : undefined),
    store: () => store,
    completed: (operationId) => completed.push(operationId),
    probe: async () => 'supported',
    log: () => {},
    ...options,
  });
}
let nextOp = 0;
const opId = () => `00000000-0000-4000-8000-${String(++nextOp).padStart(12, '0')}`;
const startOf = (patch: Partial<ConnectorStart> = {}): ConnectorStart => ({
  operationId: opId(),
  artifactId,
  appSessionId: SESSION,
  launchId: 'L1',
  cwd: '/work/project',
  server: 'fixture',
  tool: 'rows',
  arguments: { series: 'revenue' },
  fingerprint,
  mode: 'read',
  ...patch,
});
// The operation's end as main would see it: the completion event, then `take`.
async function ended(operationId: string) {
  await vi.waitFor(() => expect(completed).toContain(operationId));
  return calls.take(operationId);
}
const printOf = async (tool: string) => ((await calls.resolve({ appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool })) as { fingerprint: string }).fingerprint;
// The store reopened with its commits driven by hand (`tick`), its grants kept.
function reopenManual(): void {
  store.close();
  service.close();
  storage.close();
  make({ manual: true });
}
async function grant(request: Omit<ConnectorGrantRequest, 'fingerprint'> & { fingerprint?: string }) {
  const granting = store.grantConnectorTool(artifactId, { fingerprint, ...request });
  tick();
  return granting;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'maws-connector-calls-'));
  engine = scriptedEngine();
  session = { lifecycle: 'ready', control: engine.client, launchId: 'L1', cwd: '/work/project' };
  completed = [];
  make();
  artifactId = (await store.create({ kind: 'html', title: 'Live page', content: page('<p>a</p>') }, human)).id;
  calls = makeCalls();
  const resolved = await calls.resolve({ appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows' });
  if (!resolved.ready) throw new Error('the fixture server is not ready');
  fingerprint = resolved.fingerprint;
});
afterEach(() => {
  calls?.close();
  store?.close();
  service?.close();
  storage?.close();
  rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe('ConnectorCalls.resolve: a live session’s server and tool, read now', () => {
  it('answers the fingerprint and the read-only annotation, and the server’s configuration never leaves the host', async () => {
    const rows = await calls.resolve({ appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows' });
    expect(rows).toEqual({ ready: true, fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/), readOnly: true });
    expect(JSON.stringify(rows)).not.toContain('sentinel-header');
    expect(await calls.resolve({ appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'send_document' })).toMatchObject({ ready: true, readOnly: false });
    expect(await calls.resolve({ appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'other', tool: 'rows' })).toEqual({ ready: false, why: 'absent' });
  });

  it('is not live for another launch, another directory, a session not ready, or none; never acquiring one', async () => {
    const ask = (patch: Partial<{ appSessionId: string; launchId: string; cwd: string }>) => calls.resolve({ appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows', ...patch });
    expect(await ask({ launchId: 'L0' })).toEqual({ ready: false, why: 'notLive' });
    expect(await ask({ cwd: '/work/project/.claude/worktrees/b' })).toEqual({ ready: false, why: 'notLive' });
    expect(await ask({ appSessionId: 'app-2' })).toEqual({ ready: false, why: 'notLive' });
    session.lifecycle = 'exited';
    expect(await ask({})).toEqual({ ready: false, why: 'notLive' });
    session.lifecycle = 'ready';
    session.control = null;
    expect(await ask({})).toEqual({ ready: false, why: 'notLive' });
  });

  it('probes mcp_call once per live client, refusing an engine without it and asking again after an unknown answer', async () => {
    const probe = vi.fn(async () => 'unsupported' as const);
    calls.close();
    calls = makeCalls({ probe });
    const ask = () => calls.resolve({ appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows' });
    expect(await ask()).toEqual({ ready: false, why: 'unsupported' });
    expect(await ask()).toEqual({ ready: false, why: 'unsupported' });
    expect(probe).toHaveBeenCalledTimes(1);
    const unknown = vi.fn(async () => 'unknown' as const);
    calls.close();
    calls = makeCalls({ probe: unknown });
    expect(await ask()).toEqual({ ready: false, why: 'unknown' });
    expect(await ask()).toEqual({ ready: false, why: 'unknown' });
    expect(unknown).toHaveBeenCalledTimes(2);
    expect(engine.calls(), 'no tool call, and no model turn').toEqual([]);
  });

  it('with the real probe: an engine that refuses the subtype is unsupported, and nothing configured is called', async () => {
    calls.close();
    calls = makeCalls({ probe: undefined });
    engine.state.call = () => ({ subtype: 'error', error: 'Unsupported control request subtype: mcp_call' });
    expect(await calls.resolve({ appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'rows' })).toEqual({ ready: false, why: 'unsupported' });
    expect(engine.calls().map((request) => request.tool)).toEqual([expect.stringMatching(/^mcp__maws_probe_[0-9a-f]{32}__probe$/)]);
  });
});

describe('ConnectorCalls: an operation’s life', () => {
  it('acknowledges at once, says only the id when it ends, and hands its result to one take', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const start = startOf();
    expect(calls.start(start)).toEqual({ operationId: start.operationId });
    expect(completed).toEqual([]);
    expect(await ended(start.operationId)).toEqual({ ok: true, result: { content: [{ type: 'text', text: 'rows 107 110' }], structuredContent: { rows: [107, 110] } } });
    expect(completed).toEqual([start.operationId]);
    expect(calls.take(start.operationId)).toBeNull(); // taken once
    expect(engine.calls()).toEqual([{ subtype: 'mcp_call', tool: 'mcp__fixture__rows', arguments: { series: 'revenue' } }]);
  });

  it('refuses at once what cannot run, still through the completion: no session, no store, a duplicate id', async () => {
    const gone = startOf({ appSessionId: 'app-2' });
    calls.start(gone);
    expect(await ended(gone.operationId)).toMatchObject({ ok: false, failure: 'unavailable' });
    const storeless = makeCalls({ store: () => null });
    const noStore = startOf();
    storeless.start(noStore);
    await vi.waitFor(() => expect(completed).toContain(noStore.operationId));
    expect(storeless.take(noStore.operationId)).toMatchObject({ ok: false, failure: 'failed' });
    storeless.close();
    const first = startOf();
    calls.start(first);
    expect(() => calls.start(first)).toThrow();
    expect(engine.calls()).toEqual([]);
  });

  it('maps the engine’s refusals: a server gone is unavailable, the tool’s own error failed, both with words for main alone', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    engine.state.call = () => ({ subtype: 'error', error: 'MCP server not connected: fixture' });
    const gone = startOf();
    calls.start(gone);
    expect(await ended(gone.operationId)).toEqual({ ok: false, failure: 'unavailable', message: expect.stringContaining('not connected') });
    engine.state.call = () => ({ subtype: 'error', error: 'tool rows failed: sentinel detail' });
    const broke = startOf();
    calls.start(broke);
    expect(await ended(broke.operationId)).toEqual({ ok: false, failure: 'failed', message: expect.stringContaining('sentinel detail') });
  });

  it('refuses a result over the artifact bound without holding it', async () => {
    calls.close();
    calls = makeCalls({ maxResultBytes: 64 });
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    engine.state.call = () => ({ subtype: 'success', response: { content: 'x'.repeat(200) } });
    const big = startOf();
    calls.start(big);
    expect(await ended(big.operationId)).toMatchObject({ ok: false, failure: 'tooLarge' });
  });

  it('cancelled before the write, writes nothing and says nothing; after it, asks the engine to cancel and says nothing', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const early = startOf();
    calls.start(early);
    expect(calls.cancel(early.operationId)).toBe(true);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(engine.calls()).toEqual([]);
    expect(completed).toEqual([]);
    expect(calls.take(early.operationId)).toBeNull();

    engine.state.call = () => null; // the tool runs on
    const late = startOf();
    calls.start(late);
    await vi.waitFor(() => expect(engine.calls()).toHaveLength(1));
    const cancelled = engine.cancels().length; // the early one's mcp_status read, withdrawn
    expect(calls.cancel(late.operationId)).toBe(true);
    await vi.waitFor(() => expect(engine.cancels()).toHaveLength(cancelled + 1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(completed).toEqual([]);
    expect(calls.cancel(late.operationId)).toBe(false);
  });

  it('keeps an untaken outcome only for its bound, and drops everything when main goes', async () => {
    calls.close();
    calls = makeCalls({ resultTtlMs: 20 });
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const untaken = startOf();
    calls.start(untaken);
    await vi.waitFor(() => expect(completed).toContain(untaken.operationId));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(calls.take(untaken.operationId)).toBeNull();

    engine.state.call = () => null;
    const running = startOf();
    calls.start(running);
    await vi.waitFor(() => expect(engine.calls()).toHaveLength(2));
    calls.close(); // the client gone, or the host shutting down
    await vi.waitFor(() => expect(engine.cancels()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(completed).toEqual([untaken.operationId]);
    expect(calls.take(running.operationId)).toBeNull();
  });
});

// P3 Decision Log 91 (H's whole-branch review): a completed outcome main has not taken yet is still the grant's work. Its
// fence stays held until the outcome is taken, cancelled, expired or dropped with main, so a revoke, a replacing grant or
// the artifact's deletion before the take withdraws it, an Allow once whose row the call already consumed included.
describe('ConnectorCalls: a completed outcome awaiting its take', () => {
  const fences = () => (store as unknown as { fences: Map<string, Set<unknown>> }).fences;
  const held = () => [...fences().values()].reduce((sum, set) => sum + set.size, 0);

  for (const [what, tool, mode] of [
    ['an Allow once (its row consumed by the call)', 'send_document', 'once'],
    ['a read grant', 'rows', 'read'],
  ] as const) {
    it(`under ${what}: the artifact deleted after the call ended and before the take, the take answers revoked, never the result`, async () => {
      const print = await printOf(tool);
      await grant({ server: 'fixture', tool, fingerprint: print, mode });
      const start = startOf({ tool, fingerprint: print, mode });
      calls.start(start);
      await vi.waitFor(() => expect(completed).toContain(start.operationId));
      expect(engine.calls(), 'the call ran').toHaveLength(1);
      if (mode === 'once') expect(await store.connectorGrants(artifactId), 'no grant row survives the consumed Allow once').toEqual([]);
      expect(held(), 'the fence held while the outcome waits').toBe(1);
      await store.delete(artifactId);
      expect(calls.take(start.operationId)).toMatchObject({ ok: false, failure: 'refused', refusal: 'revoked' });
      expect(held(), 'released').toBe(0);
      expect(calls.take(start.operationId)).toBeNull();
    });
  }

  it('a revoke or a grant replacing it under another mode, after the end and before the take, withdraws the result', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const revokedOne = startOf();
    calls.start(revokedOne);
    await vi.waitFor(() => expect(completed).toContain(revokedOne.operationId));
    await store.revokeConnectorTool(artifactId, { server: 'fixture', tool: 'rows' });
    expect(calls.take(revokedOne.operationId)).toMatchObject({ ok: false, failure: 'refused', refusal: 'revoked' });

    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const replacedOne = startOf();
    calls.start(replacedOne);
    await vi.waitFor(() => expect(completed).toContain(replacedOne.operationId));
    await grant({ server: 'fixture', tool: 'rows', mode: 'once' });
    expect(calls.take(replacedOne.operationId)).toMatchObject({ ok: false, failure: 'refused', refusal: 'revoked' });
    expect(held()).toBe(0);
  });

  it('the same grant given again after the end leaves the result to its take', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const start = startOf();
    calls.start(start);
    await vi.waitFor(() => expect(completed).toContain(start.operationId));
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    expect(calls.take(start.operationId)).toMatchObject({ ok: true, result: { structuredContent: { rows: [107, 110] } } });
    expect(held()).toBe(0);
  });

  it('a deletion of another artifact leaves it alone; the take hands over the result and lets go of the fence', async () => {
    const otherId = (await store.create({ kind: 'html', title: 'Other page', content: page('<p>b</p>') }, human)).id;
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const start = startOf();
    calls.start(start);
    await vi.waitFor(() => expect(completed).toContain(start.operationId));
    await store.delete(otherId);
    expect(calls.take(start.operationId)).toMatchObject({ ok: true });
    expect(held()).toBe(0);
    expect(fences().size, 'no empty entry kept').toBe(0);
  });

  it('a cancel, the outcome’s expiry or main going lets go of its fence, and nothing is retained', async () => {
    calls.close();
    calls = makeCalls({ resultTtlMs: 250 });
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const cancelled = startOf();
    calls.start(cancelled);
    await vi.waitFor(() => expect(completed).toContain(cancelled.operationId));
    expect(held()).toBe(1);
    expect(calls.cancel(cancelled.operationId)).toBe(true);
    expect(held(), 'cancelled').toBe(0);

    const expired = startOf();
    calls.start(expired);
    await vi.waitFor(() => expect(completed).toContain(expired.operationId));
    expect(held()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(held(), 'expired').toBe(0);
    expect(calls.take(expired.operationId)).toBeNull();

    const closed = startOf();
    calls.start(closed);
    await vi.waitFor(() => expect(completed).toContain(closed.operationId));
    expect(held()).toBe(1);
    calls.close();
    expect(held(), 'main gone').toBe(0);
    expect(fences().size).toBe(0);
  });

  // The boundary between the first status check answering (the operation not cancelled yet) and `execute` going on
  // past its await: main's cancel, or main going, lands exactly there. No fence may be taken for an operation already
  // dropped (nothing would let go of it), the Allow once stays unused and nothing reaches the engine.
  for (const ending of ['cancel', 'close'] as const) {
    it(`main’s ${ending} between the first status check’s answer and the operation going on takes no fence, uses no grant and calls nothing`, async () => {
      const print = await printOf('send_document');
      await grant({ server: 'fixture', tool: 'send_document', fingerprint: print, mode: 'once' });
      const start = startOf({ tool: 'send_document', fingerprint: print, mode: 'once' });
      const internals = calls as unknown as { admitted: (...args: unknown[]) => Promise<unknown> };
      const admitted = internals.admitted.bind(calls);
      let checks = 0;
      const answered: unknown[] = [];
      vi.spyOn(internals, 'admitted').mockImplementation(async (...args: unknown[]) => {
        const answer = await admitted(...args);
        if (++checks === 1) {
          answered.push(answer); // it found the operation live: null, its signal not aborted
          if (ending === 'cancel') expect(calls.cancel(start.operationId)).toBe(true);
          else calls.close();
        }
        return answer;
      });
      calls.start(start);
      await vi.waitFor(() => expect(checks).toBeGreaterThanOrEqual(1));
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(answered, 'the check answered admitted before the operation ended').toEqual([null]);
      expect(held(), 'no fence left behind').toBe(0);
      expect(fences().size).toBe(0);
      expect(engine.calls(), 'nothing reached the engine').toEqual([]);
      expect(await store.connectorGrants(artifactId), 'the Allow once unused').toEqual([expect.objectContaining({ tool: 'send_document', mode: 'once' })]);
      expect(completed).toEqual([]);
      expect(calls.take(start.operationId)).toBeNull();
    });
  }
});

// The host's last word: main's check consumed nothing and may be stale by the write, so the host compares the grant
// with what main admitted (before an Allow once is consumed) and fences the write itself.
describe('ConnectorCalls: the final fence before mcp_call', () => {
  // A batch is open (another tool's grant, not yet committed) when the operation's authorization reads the grant, so its
  // answer waits for that commit; `between` runs then, its writes joining the same batch, and the batch commits.
  async function raceAuthorization(start: ConnectorStart, between: () => unknown) {
    store.close();
    service.close();
    storage.close();
    make({ manual: true });
    const reached: unknown[] = [];
    const authorize = store.authorizeConnectorCall.bind(store);
    vi.spyOn(store, 'authorizeConnectorCall').mockImplementation((...args) => {
      const answer = authorize(...args);
      reached.push(args);
      return answer;
    });
    const opening = store.grantConnectorTool(artifactId, { server: 'fixture', tool: 'other', fingerprint: 'x', mode: 'read' });
    calls.start(start);
    await vi.waitFor(() => expect(reached).toHaveLength(1));
    const effect = between();
    tick();
    await Promise.all([opening, effect]);
    tick();
    return ended(start.operationId);
  }

  it('authorize → revoke while the batch is pending → commit: no mcp_call is written', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const start = startOf();
    expect(await raceAuthorization(start, () => store.revokeConnectorTool(artifactId, { server: 'fixture', tool: 'rows' }))).toMatchObject({ ok: false, failure: 'refused', refusal: 'revoked' });
    expect(engine.calls()).toEqual([]);
  });

  it('authorize → the artifact deleted while the batch is pending → commit: no mcp_call is written', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const start = startOf();
    expect(await raceAuthorization(start, () => store.delete(artifactId))).toMatchObject({ ok: false, failure: 'refused', refusal: 'revoked' });
    expect(engine.calls()).toEqual([]);
  });

  it('a read grant swapped for Allow once before the watch’s dispatch neither consumes it nor calls', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'once' }); // main's check saw `read`; the owner changed it since
    const start = startOf({ mode: 'read' });
    calls.start(start);
    expect(await ended(start.operationId)).toMatchObject({ ok: false, failure: 'refused', refusal: 'wrongMode' });
    expect(engine.calls()).toEqual([]);
    expect(await store.connectorGrants(artifactId)).toEqual([expect.objectContaining({ tool: 'rows', mode: 'once' })]); // still there
  });

  it('of concurrent calls under one Allow once, exactly one is written', async () => {
    const { fingerprint: sendPrint } = (await calls.resolve({ appSessionId: SESSION, launchId: 'L1', cwd: '/work/project', server: 'fixture', tool: 'send_document' })) as { fingerprint: string };
    await grant({ server: 'fixture', tool: 'send_document', fingerprint: sendPrint, mode: 'once' });
    const fixed = [1, 2, 3].map(() => startOf({ tool: 'send_document', fingerprint: sendPrint, mode: 'once' }));
    for (const start of fixed) calls.start(start);
    const outcomes = await Promise.all(fixed.map((start) => ended(start.operationId)));
    expect(outcomes.filter((outcome) => outcome?.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome?.ok)).toEqual([expect.objectContaining({ refusal: 'notGranted' }), expect.objectContaining({ refusal: 'notGranted' })]);
    expect(engine.calls()).toHaveLength(1);
  });

  it('refuses when the session exits, relaunches or moves before the write', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    for (const change of [() => (session.lifecycle = 'exited'), () => (session.launchId = 'L2'), () => (session.cwd = '/elsewhere')]) {
      const start = startOf();
      expect(await raceAuthorization(start, change)).toMatchObject({ ok: false, failure: 'unavailable' });
      session = { lifecycle: 'ready', control: engine.client, launchId: 'L1', cwd: '/work/project' };
    }
    expect(engine.calls()).toEqual([]);
  });

  it('refuses when the server’s identity, its tool’s annotation or its name’s uniqueness changed by the write', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const moved = startOf();
    expect(await raceAuthorization(moved, () => (engine.state.servers[0]!.config.url = 'http://127.0.0.1:1/mcp'))).toMatchObject({ ok: false, failure: 'refused', refusal: 'fingerprintChanged' });
    engine.state.servers = [fixtureServer()];
    const writes = startOf();
    expect(await raceAuthorization(writes, () => (engine.state.servers[0]!.tools![0]!.annotations = {}))).toMatchObject({ ok: false, failure: 'refused', refusal: 'wrongMode' });
    engine.state.servers = [fixtureServer()];
    const twin = startOf();
    expect(await raceAuthorization(twin, () => engine.state.servers.push({ ...fixtureServer(), scope: 'user' }))).toMatchObject({ ok: false, failure: 'unavailable' });
    expect(engine.calls()).toEqual([]);
  });

  // The request is queued for the engine's stdin, which may be busy: what was checked before the queue must still hold
  // when the frame's turn comes, so a revoke or delete asked for in between (not yet committed) stops it there.
  for (const [what, ask] of [
    ['a revoke', () => store.revokeConnectorTool(artifactId, { server: 'fixture', tool: 'rows' })],
    ['a delete', () => store.delete(artifactId)],
  ] as const) {
    it(`a call queued behind a busy stdin never reaches it after ${what} is asked for, even uncommitted`, async () => {
      await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
      store.close();
      service.close();
      storage.close();
      make({ manual: true });
      const release = engine.stall();
      const start = startOf();
      calls.start(start);
      await vi.waitFor(() => expect(engine.queuedCalls()).toHaveLength(1)); // past the final mcp_status and the fence
      const asked = ask(); // its rows in the open batch, nothing committed
      release();
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(engine.calls(), 'no mcp_call reached stdin').toEqual([]);
      tick();
      await asked;
      expect(await ended(start.operationId)).toMatchObject({ ok: false, failure: 'refused', refusal: 'revoked' });
      expect((store as unknown as { fences: Map<string, unknown> }).fences.size, 'the fence released').toBe(0);
    });
  }

  // The same for a re-grant that changes the permission the call was admitted under (its fingerprint, the mode main's
  // check saw), an Allow once's included though its own use already took its row: the queued call is never written, and
  // the replacement grant is left unused for the call it was given for.
  const OTHER_PRINT = 'f'.repeat(64);
  for (const [what, tool, mode, replacement] of [
    ['a read grant replaced by Allow once', 'rows', 'read', { mode: 'once' }],
    ['a read grant replaced under another fingerprint', 'rows', 'read', { fingerprint: OTHER_PRINT }],
    ['an Allow once, used, re-granted under another fingerprint', 'send_document', 'once', { fingerprint: OTHER_PRINT }],
    ['an Allow once, used, replaced by a read grant', 'rows', 'once', { mode: 'read' }],
  ] as [string, string, ConnectorGrantMode, Partial<ConnectorGrantRequest>][]) {
    it(`a call queued behind a busy stdin never reaches it after ${what} is asked for, even uncommitted`, async () => {
      const print = await printOf(tool);
      await grant({ server: 'fixture', tool, fingerprint: print, mode });
      reopenManual();
      const release = engine.stall();
      const start = startOf({ tool, fingerprint: print, mode });
      calls.start(start);
      await vi.waitFor(() => {
        tick(); // an Allow once's consumption commits
        expect(engine.queuedCalls()).toHaveLength(1); // past the final mcp_status and the fence
      });
      const replaced = { server: 'fixture', tool, fingerprint: print, mode, ...replacement };
      const asked = store.grantConnectorTool(artifactId, replaced); // its row in the open batch, nothing committed
      release();
      await settle();
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(engine.calls(), 'no mcp_call reached stdin').toEqual([]);
      tick();
      await asked;
      expect(await ended(start.operationId)).toMatchObject({ ok: false, failure: 'refused', refusal: 'revoked' });
      expect(await store.connectorGrants(artifactId), 'the replacement unused').toEqual([expect.objectContaining({ tool, fingerprint: replaced.fingerprint, mode: replaced.mode })]);
      expect((store as unknown as { fences: Map<string, unknown> }).fences.size, 'the fence released').toBe(0);
    });
  }

  // A re-grant of the very permission the call was admitted under withdraws nothing: the call is written, and an Allow
  // once granted again is left for the next call.
  for (const [what, tool, mode] of [
    ['the same read grant', 'rows', 'read'],
    ['Allow once again', 'send_document', 'once'],
  ] as const) {
    it(`a call queued behind a busy stdin is written after ${what} is asked for meanwhile`, async () => {
      const print = await printOf(tool);
      await grant({ server: 'fixture', tool, fingerprint: print, mode });
      reopenManual();
      const release = engine.stall();
      const start = startOf({ tool, fingerprint: print, mode });
      calls.start(start);
      await vi.waitFor(() => {
        tick();
        expect(engine.queuedCalls()).toHaveLength(1);
      });
      const asked = store.grantConnectorTool(artifactId, { server: 'fixture', tool, fingerprint: print, mode });
      release();
      tick();
      await asked;
      expect(await ended(start.operationId)).toMatchObject({ ok: true });
      expect(engine.calls()).toHaveLength(1);
      expect(await store.connectorGrants(artifactId)).toEqual([expect.objectContaining({ tool, fingerprint: print, mode })]);
      expect((store as unknown as { fences: Map<string, unknown> }).fences.size).toBe(0);
    });
  }

  it('a call queued behind a busy stdin is written when nothing was asked meanwhile, and its fence released after', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    const release = engine.stall();
    const start = startOf();
    calls.start(start);
    await vi.waitFor(() => expect(engine.queuedCalls()).toHaveLength(1));
    expect((store as unknown as { fences: Map<string, unknown> }).fences.size, 'held while it is queued').toBe(1);
    release();
    expect(await ended(start.operationId)).toMatchObject({ ok: true });
    expect(engine.calls()).toHaveLength(1);
    expect((store as unknown as { fences: Map<string, unknown> }).fences.size).toBe(0);
  });

  it('a revoke asked for while the tool runs cancels it through the engine and answers revoked', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'read' });
    engine.state.call = () => null; // the tool runs on
    const start = startOf();
    calls.start(start);
    await vi.waitFor(() => expect(engine.calls()).toHaveLength(1));
    await store.revokeConnectorTool(artifactId, { server: 'fixture', tool: 'rows' });
    expect(await ended(start.operationId)).toMatchObject({ ok: false, failure: 'refused', refusal: 'revoked' });
    expect(engine.cancels()).toHaveLength(1);
  });

  it('refuses a call main admitted under a fingerprint the session no longer reports, consuming nothing', async () => {
    await grant({ server: 'fixture', tool: 'rows', mode: 'once' });
    const stale = startOf({ mode: 'once', fingerprint: 'f'.repeat(64) });
    calls.start(stale);
    expect(await ended(stale.operationId)).toMatchObject({ ok: false, failure: 'refused', refusal: 'fingerprintChanged' });
    expect(await store.connectorGrants(artifactId)).toHaveLength(1);
    expect(engine.calls()).toEqual([]);
  });
});
