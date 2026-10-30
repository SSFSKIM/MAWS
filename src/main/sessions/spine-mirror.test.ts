// Main's mirror of the spine's view on the daemon shape (P5 O3-D M5b; docs/doperpowers/plans/2026-10-29-p5-o3-d-cutover.md,
// Interfaces §F; D14, D19): a fake `machine` host answers the snapshot commands (each answer held until the test lets it
// go, where a case needs the race) and fires the front's events, as main's supervisor would hand them over.
import { describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId, AttentionId, ProjectId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { HostState, ProjectRecord } from '@shared/ipc/schema';
import { SCENARIO_UNAVAILABLE } from '@shared/spine/view';
import { digest as digestOf, humanTurn, item as itemOf, project as projectOf, record as recordOf, status as statusOf, T0 } from '../../../test/support/builders';
import { intentFor as intentOf } from '../../../test/support/session-host';
import { createMirrorSpineView, type MirrorHosts } from './spine-mirror';

// The builders' shapes, keyed as the mirror keys them
const record = ({ appId, ...over }: { appId: string } & Partial<SessionRecord>) => recordOf(appId, over);
const project = ({ id, ...over }: { id: string } & Partial<ProjectRecord>) => projectOf(id, 0, over);
const item = ({ appSessionId, id }: { appSessionId: string; id: AttentionId }) => itemOf(appSessionId, 'permission', T0, { id });
const status = ({ appSessionId, process, turn, ...over }: { appSessionId: string; process: EngineSessionStatus['process']; turn?: boolean } & Partial<Omit<EngineSessionStatus, 'turn'>>) => ({
  ...statusOf(appSessionId, { process, turn: turn ? humanTurn : null }),
  ...over,
});
const digestOfId = ({ appSessionId }: { appSessionId: string }) => digestOf(appSessionId);
const intentOfId = ({ appSessionId }: { appSessionId: string }) => intentOf(appSessionId);

const A = '11111111-1111-4111-8111-111111111111' as AppSessionId;
const B = '22222222-2222-4222-8222-222222222222' as AppSessionId;
const C = '33333333-3333-4333-8333-333333333333' as AppSessionId;

type Answer = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };

// The `machine` host as main's supervisor shows it: streaming once told, its commands answered from `answers` (a
// command named in `held` waits for `release`), its events fired by the test
class FakeMachine implements MirrorHosts {
  readonly asked: { name: string; input: unknown }[] = [];
  readonly answers = new Map<string, (input: unknown) => Answer>();
  readonly held = new Set<string>();
  private readonly waiting = new Map<string, (() => void)[]>();
  private readonly listeners = new Map<string, Set<(payload: never) => void>>();
  private readonly streamingListeners = new Set<() => void>();
  private readonly stateListeners = new Set<(state: HostState) => void>();
  private state: HostState = { state: 'starting', pid: null, restarts: 0, revision: 0 };
  private isStreaming = false;

  constructor(seed: Partial<Record<string, unknown>> = {}) {
    const ok = (value: unknown) => () => ({ ok: true as const, value });
    this.answers.set('session.list', ok({ sessions: seed.records ?? [], revision: 1 }));
    this.answers.set('session.projects.list', ok({ projects: seed.projects ?? [], revision: 1, rows: seed.rows ?? seed.projects ?? [] }));
    this.answers.set('session.digests', ok({ digests: seed.digests ?? [] }));
    this.answers.set('attention.list', ok(seed.attention ?? []));
    this.answers.set('session.intent.list', ok({ intents: seed.intents ?? [] }));
    this.answers.set('session.visible', ok({ sessions: seed.visible ?? [] }));
    this.answers.set('session.launchMode', ok({ mode: seed.mode ?? 'index' }));
    this.answers.set('machine.client', ok(undefined));
    this.answers.set('session.follow', ok({ streams: [] }));
  }

  dispatch = async (_owner: string, name: string, input: unknown) => {
    this.asked.push({ name, input });
    if (this.held.has(name)) await new Promise<void>((resolve) => this.waiting.set(name, [...(this.waiting.get(name) ?? []), resolve]));
    const answer = this.answers.get(name);
    return (answer ? answer(input) : { ok: false, error: { code: 'internal', message: `no answer for ${name}` } }) as never;
  };
  onEvent = (name: string, listener: (payload: never) => void) => {
    const set = this.listeners.get(name) ?? new Set();
    this.listeners.set(name, set);
    set.add(listener);
    return () => void set.delete(listener);
  };
  onStreaming = (_owner: string, listener: () => void) => {
    this.streamingListeners.add(listener);
    return () => void this.streamingListeners.delete(listener);
  };
  streaming = () => this.isStreaming;
  onState = (_owner: string, listener: (state: HostState) => void) => {
    this.stateListeners.add(listener);
    return () => void this.stateListeners.delete(listener);
  };
  snapshot = () => this.state;

  fire(name: string, payload: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener(payload as never);
  }
  release(name: string): void {
    this.held.delete(name);
    for (const resolve of this.waiting.get(name) ?? []) resolve();
    this.waiting.delete(name);
  }
  stream(): void {
    this.setState('ready');
    this.isStreaming = true;
    for (const listener of this.streamingListeners) listener();
  }
  lose(state: HostState['state'] = 'restarting'): void {
    this.isStreaming = false;
    this.setState(state);
  }
  private setState(state: HostState['state']): void {
    this.state = { ...this.state, state, revision: this.state.revision + 1 };
    for (const listener of this.stateListeners) listener(this.state);
  }
}

function mirrorOver(host: FakeMachine, options: { refused?: () => string | null; browserSocket?: () => string | null } = {}) {
  let daemon: () => void = () => {};
  const mirror = createMirrorSpineView({
    hosts: host,
    spineRefused: options.refused ?? (() => null),
    onDaemonStatus: (listener) => ((daemon = listener), () => {}),
    browserSocket: options.browserSocket ?? (() => null),
    retryMs: 10,
    log: () => {},
  });
  const availability: (string | null)[] = [];
  mirror.view.on('availability', (reason) => void availability.push(reason));
  return { mirror, view: mirror.view, availability, daemonStatus: () => daemon() };
}

const loaded = (view: { unavailable(): string | null }) => vi.waitFor(() => expect(view.unavailable()).toBeNull());

describe('the spine mirror (Interfaces §F)', () => {
  it('answers every member from its snapshot once the machine host streams, and is available only then', async () => {
    const rA = record({ appId: A, projectId: 'p1' as ProjectId });
    const hiddenRow = project({ id: 'p2' as ProjectId, hidden: true });
    const host = new FakeMachine({
      records: [rA],
      projects: [project({ id: 'p1' as ProjectId })],
      rows: [project({ id: 'p1' as ProjectId }), hiddenRow],
      digests: [digestOfId({ appSessionId: A })],
      attention: [item({ appSessionId: A, id: 'att-1' as AttentionId })],
      intents: [intentOfId({ appSessionId: B })],
      visible: [A],
    });
    const { view, availability } = mirrorOver(host);
    expect(view.unavailable()).toMatch(/starting/); // the machine host's state while it does not stream
    expect(view.records()).toEqual([]);
    host.stream();
    await loaded(view);
    expect(availability.at(-1)).toBeNull();
    expect(view.record(A)).toEqual(rA);
    expect(view.records()).toEqual([rA]);
    expect(view.projects().map((p) => p.id)).toEqual(['p1']);
    expect(view.projectRows().map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(view.project('p2' as ProjectId)).toEqual(hiddenRow);
    expect(view.digest(A)?.appSessionId).toBe(A);
    expect(view.digests()).toHaveLength(1);
    expect(view.attention(A).map((i) => i.id)).toEqual(['att-1']);
    expect([...view.allAttention().keys()]).toEqual([A]);
    expect(view.intent(B)?.appSessionId).toBe(B);
    expect(view.intents()).toHaveLength(1);
    expect(view.known(A)).toBe(true);
    expect(view.known(B)).toBe(true); // an intent with no record
    expect(view.known(C)).toBe(false);
    expect(view.visibleSessions()).toEqual([A]);
    expect(host.asked.find((a) => a.name === 'session.list')?.input).toEqual({ includeArchived: true });
  });

  it('follows each event of the front: records, removals, projects with their rows, digests, attention with its silent ids, intents, the visible set', async () => {
    const host = new FakeMachine();
    const { view } = mirrorOver(host);
    host.stream();
    await loaded(view);
    const heard: string[] = [];
    view.on('record', (id, r) => void heard.push(`record ${id} ${r ? 'put' : 'removed'}`));
    view.on('projects', () => void heard.push('projects'));
    view.on('digest', (d) => void heard.push(`digest ${d.appSessionId}`));
    view.on('attention', (id, items, silent) => void heard.push(`attention ${id} ${items.length} silent ${[...silent].join(',')}`));
    view.on('intent', (id, i) => void heard.push(`intent ${id} ${i ? 'put' : 'removed'}`));
    view.on('visible', (id, visible) => void heard.push(`visible ${id} ${visible}`));

    host.fire('session.changed', { record: record({ appId: A }), cause: 'created', revision: 2 });
    host.fire('session.projects.changed', { projects: [project({ id: 'p1' as ProjectId })], revision: 2, rows: [project({ id: 'p1' as ProjectId }), project({ id: 'p9' as ProjectId, hidden: true })] });
    host.fire('session.digest', digestOfId({ appSessionId: A }));
    host.fire('attention.changed', { appSessionId: A, items: [item({ appSessionId: A, id: 'att-1' as AttentionId }), item({ appSessionId: A, id: 'att-2' as AttentionId })], silent: ['att-1'] });
    host.fire('session.intent.changed', { appSessionId: B, intent: intentOfId({ appSessionId: B }) });
    host.fire('session.visibleChanged', { appSessionId: A, visible: true });
    expect(view.record(A)).not.toBeNull();
    expect(view.project('p9' as ProjectId)?.hidden).toBe(true);
    expect(view.digest(A)).not.toBeNull();
    expect(view.attention(A)).toHaveLength(2);
    expect(view.intent(B)).not.toBeNull();
    expect(view.visibleSessions()).toEqual([A]);

    host.fire('session.intent.changed', { appSessionId: B, intent: null });
    host.fire('session.visibleChanged', { appSessionId: A, visible: false });
    host.fire('session.removed', { appSessionId: A, revision: 3 });
    expect(view.record(A)).toBeNull();
    expect(view.digest(A)).toBeNull();
    expect(view.attention(A)).toEqual([]);
    expect(view.known(B)).toBe(false);
    expect(heard).toEqual([
      `record ${A} put`, 'projects', `digest ${A}`, `attention ${A} 2 silent att-1`, `intent ${B} put`, `visible ${A} true`,
      `intent ${B} removed`, `visible ${A} false`, `record ${A} removed`,
    ]);
  });

  it('reads engine statuses from the streams: each status, the mid-turn count, and the engine event', async () => {
    const host = new FakeMachine({ records: [record({ appId: A }), record({ appId: B })] });
    const { view } = mirrorOver(host);
    host.stream();
    await loaded(view);
    const engine: [string, string | null][] = [];
    view.on('engine', (id, s) => void engine.push([id, s?.process ?? null]));
    host.fire('session.status', { appSessionId: A, status: status({ appSessionId: A, process: 'ready', turn: true }) });
    host.fire('session.status', { appSessionId: B, status: status({ appSessionId: B, process: 'starting' }) });
    host.fire('session.status', { appSessionId: C, status: status({ appSessionId: C, process: 'ready', turn: true }) }); // no record: a bootstrap
    expect(view.engineStatuses().map((s) => s.appSessionId).sort()).toEqual([A, B]);
    expect(view.midTurnCount()).toBe(2); // A's turn and B launching; C is no session the spine knows
    expect(engine).toEqual([[A, 'ready'], [B, 'starting'], [C, 'ready']]);
  });

  it('lets an event win over the snapshot it raced: the ids it touched keep the event’s rows; a whole-list event keeps the list', async () => {
    const stale = record({ appId: A, title: { text: 'from the snapshot', source: 'user' } });
    const fresh = record({ appId: A, title: { text: 'from the event', source: 'user' } });
    const host = new FakeMachine({ records: [stale, record({ appId: B })], projects: [project({ id: 'old' as ProjectId })] });
    host.held.add('session.list').add('session.projects.list');
    const { view } = mirrorOver(host);
    host.stream();
    await vi.waitFor(() => expect(host.asked.map((a) => a.name)).toContain('session.list'));
    host.fire('session.changed', { record: fresh, cause: 'updated', revision: 5 });
    host.fire('session.projects.changed', { projects: [project({ id: 'new' as ProjectId })], revision: 5, rows: [project({ id: 'new' as ProjectId })] });
    host.release('session.list');
    host.release('session.projects.list');
    await loaded(view);
    expect(view.record(A)?.title.text).toBe('from the event');
    expect(view.record(B)).not.toBeNull(); // an id no event touched: the snapshot's
    expect(view.projects().map((p) => p.id)).toEqual(['new']);
    expect(view.projectRows().map((p) => p.id)).toEqual(['new']);
  });

  it('says the daemon’s refusal while the snapshot cannot load, tries again, and is available once it does; availability fires at each change', async () => {
    let refused: string | null = 'spine.lock is held by pid 4242 (build 0.0.0+old)';
    const host = new FakeMachine();
    const list = host.answers.get('session.list')!;
    host.answers.set('session.list', (input) => (refused ? { ok: false, error: { code: 'host_unavailable', message: refused } } : list(input)));
    const { view, availability, daemonStatus } = mirrorOver(host, { refused: () => refused });
    host.stream();
    await vi.waitFor(() => expect(view.unavailable()).toBe(refused));
    refused = null;
    daemonStatus();
    await loaded(view);
    expect(availability).toContain('spine.lock is held by pid 4242 (build 0.0.0+old)');
    expect(availability.at(-1)).toBeNull();
    expect(availability.filter((reason, i) => i > 0 && reason === availability[i - 1])).toEqual([]); // once per change
  });

  it('keeps its maps, stale and readable, while the machine host does not stream, naming its state, and refills them at the next streaming', async () => {
    const host = new FakeMachine({ records: [record({ appId: A })] });
    const { view, availability } = mirrorOver(host);
    host.stream();
    await loaded(view);
    host.lose('restarting');
    expect(view.unavailable()).toMatch(/restarting/);
    expect(availability.at(-1)).toMatch(/restarting/);
    expect(view.record(A)).not.toBeNull();
    host.answers.set('session.list', () => ({ ok: true, value: { sessions: [record({ appId: B })], revision: 2 } }));
    const removed: string[] = [];
    view.on('record', (id, r) => void (r === null && removed.push(id)));
    host.stream();
    await loaded(view);
    expect(view.record(A)).toBeNull();
    expect(view.record(B)).not.toBeNull();
    expect(removed).toEqual([A]); // a later snapshot tells what it removed
  });

  it('marks every attention item of its first snapshot silent, so the notifier announces none it found', async () => {
    const host = new FakeMachine({ records: [record({ appId: A })], attention: [item({ appSessionId: A, id: 'att-1' as AttentionId })] });
    const { view } = mirrorOver(host);
    const told: { id: string; items: readonly AttentionItem[]; silent: string[] }[] = [];
    const records: string[] = [];
    view.on('attention', (id, items, silent) => void told.push({ id, items, silent: [...silent] }));
    view.on('record', (id) => void records.push(id));
    host.stream();
    await loaded(view);
    expect(told).toEqual([{ id: A, items: [expect.objectContaining({ id: 'att-1' })], silent: ['att-1'] }]);
    expect(records).toEqual([]); // the readers start from availability, not a record event per session
  });

  it('is unavailable in launch mode scenario while answering the scenario’s records', async () => {
    const host = new FakeMachine({ mode: 'scenario', records: [record({ appId: A })] });
    const { view } = mirrorOver(host);
    host.stream();
    await vi.waitFor(() => expect(view.unavailable()).toBe(SCENARIO_UNAVAILABLE));
    expect(view.record(A)).not.toBeNull();
    // the scenario's statuses are the spine's emits, no engine host's: counted, and kept across a reconnection whose
    // follow finds no launch for them (D11)
    host.fire('session.status', { appSessionId: A, status: status({ appSessionId: A, process: 'ready', turn: true }) });
    expect(view.midTurnCount()).toBe(1);
    host.answers.set('session.follow', () => ({ ok: true, value: { streams: [{ appSessionId: A, mode: 'live', launchId: null }] } }));
    host.lose();
    host.stream();
    await vi.waitFor(() => expect(host.asked.filter((a) => a.name === 'session.follow')).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(view.midTurnCount()).toBe(1);
  });

  it('dispatches acquire and files’ admission read; a failed read answers no paths', async () => {
    const host = new FakeMachine();
    host.answers.set('session.acquire', () => ({ ok: true, value: { status: 'ready' } }));
    host.answers.set('library.fileLinkedPaths', () => ({ ok: true, value: { paths: ['/tmp/linked.md'] } }));
    const { view } = mirrorOver(host);
    host.stream();
    expect(await view.acquire(A, 'read')).toEqual({ status: 'ready' });
    expect(host.asked.find((a) => a.name === 'session.acquire')?.input).toEqual({ appSessionId: A, reason: 'read' });
    expect(await view.fileLinkedPaths(A)).toEqual(['/tmp/linked.md']);
    host.answers.set('library.fileLinkedPaths', () => ({ ok: false, error: { code: 'host_unavailable', message: 'mawsd is restarting' } }));
    expect(await view.fileLinkedPaths(A)).toEqual([]);
    host.answers.set('session.acquire', () => ({ ok: false, error: { code: 'host_unavailable', message: 'mawsd is restarting' } }));
    await expect(view.acquire(A, 'read')).rejects.toThrow('mawsd is restarting');
  });

  it('at each streaming tells mawsd its browser socket and follows every live session from its cursor', async () => {
    const host = new FakeMachine({ records: [record({ appId: A }), record({ appId: B })] });
    const { view } = mirrorOver(host, { browserSocket: () => '/profile/browser/cua' });
    host.stream();
    await loaded(view);
    const follows = () => host.asked.filter((a) => a.name === 'session.follow').map((a) => a.input);
    expect(host.asked.find((a) => a.name === 'machine.client')?.input).toEqual({ browserSocket: '/profile/browser/cua' });
    expect(follows()).toEqual([{ sessions: [], live: true }]);
    // A: a status, then events of its launch (the cursor is the last one delivered); B: a status alone (its stream's
    // opening row); C: exited, so it is not followed again
    host.fire('session.status', { appSessionId: A, status: status({ appSessionId: A, process: 'ready', launchId: 'LA', lastEventSeq: 3 }) });
    host.fire('session.eventBatch', { appSessionId: A, events: [{ id: `${A}:LA:4:0`, seq: 4 }, { id: `${A}:LA:4:1`, seq: 4 }] });
    host.fire('session.status', { appSessionId: B, status: status({ appSessionId: B, process: 'ready', launchId: 'LB', lastEventSeq: 7 }) });
    host.fire('session.status', { appSessionId: B, status: status({ appSessionId: B, process: 'ready', launchId: 'LB', lastEventSeq: 9 }) });
    host.fire('session.status', { appSessionId: C, status: status({ appSessionId: C, process: 'exited', launchId: 'LC', lastEventSeq: 2 }) });
    host.lose();
    host.stream();
    await vi.waitFor(() => expect(follows()).toHaveLength(2));
    expect(follows()[1]).toEqual({
      sessions: [
        { appSessionId: A, cursor: { launchId: 'LA', seq: 4, idx: 1 } },
        { appSessionId: B, cursor: { launchId: 'LB', seq: 7, idx: -1 } }, // from the row its stream opened at
      ],
      live: true,
    });
  });

  it('forgets the status of a session its follow finds not live (the engine host replaced meanwhile)', async () => {
    const host = new FakeMachine({ records: [record({ appId: A })] });
    const { view } = mirrorOver(host);
    host.stream();
    await loaded(view);
    host.fire('session.status', { appSessionId: A, status: status({ appSessionId: A, process: 'ready', launchId: 'LA', lastEventSeq: 1 }) });
    host.answers.set('session.follow', () => ({ ok: true, value: { streams: [{ appSessionId: A, mode: 'live', launchId: null }] } }));
    const engine: (string | null)[] = [];
    view.on('engine', (_id, s) => void engine.push(s?.process ?? null));
    host.lose();
    host.stream();
    await vi.waitFor(() => expect(engine).toEqual([null]));
    expect(view.engineStatuses()).toEqual([]);
  });

  it('stops: no event, no streaming and no daemon status reaches it any more', async () => {
    const host = new FakeMachine({ records: [record({ appId: A })] });
    const { mirror, view } = mirrorOver(host);
    host.stream();
    await loaded(view);
    mirror.stop();
    host.fire('session.removed', { appSessionId: A, revision: 2 });
    expect(view.record(A)).not.toBeNull();
  });
});
