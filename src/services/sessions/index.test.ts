import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppSessionId } from '@shared/graph/ids';
import { endableClientRef } from '@shared/ipc/client';
import { digest, item } from '../../../test/support/builders';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import { IndexSessionSource } from '../index/source';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emittedAppEventsSource, startSessions, type SessionsOptions } from '.';

// The read side answers through the services bus (P5 O3-C M1). A page is a ClientRef its owner ends (main's ends when
// the page closes, crashes or navigates its document away: src/main/ipc/clients.ts, whose own suite pins those events).
let pageIds = 0;
const page = () => endableClientRef(`page:${++pageIds}.1`);

let bus: FakeBus;
beforeEach(() => {
  bus = fakeBus();
});
const start = (options: Omit<SessionsOptions, 'bus' | 'packaged' | 'appRoot'> & Partial<Pick<SessionsOptions, 'packaged' | 'appRoot'>>) =>
  startSessions({ packaged: false, appRoot: process.cwd(), bus, ...options });

// The source is real: after the renderer disappears, a disk advance must stay unread.
describe('visibility belongs to the reporting renderer', () => {
  it('releases visibility when its client ends, and a replacement page may report it again', async () => {
    const dir = tempDir();
    const index = new Index(join(dir.path, 'index.sqlite'));
    const disk = summary();
    const appId = index.sessions.upsertFromSummary(disk).record.appId;
    const listeners = new Map<string, (payload: unknown) => void>();
    const source = new IndexSessionSource(index, {
      ...hosts,
      onEvent: (name, listener) => { listeners.set(name, listener as (payload: unknown) => void); return () => { listeners.delete(name); }; },
      snapshot: () => ({ state: 'starting', pid: null, restarts: 0, revision: 1 }),
    }, { emit: () => true, warmLinkedWorktrees: async () => {} });
    const sessions = start({ env: {}, hosts, indexSource: source });
    const first = page();
    try {
      expect(await bus.invoke('session.setVisible', { appSessionId: appId, visible: true }, first)).toEqual({ ok: true, value: undefined });
      first.end();
      listeners.get('fs.sessionChanged')!({ summary: { ...disk, size: disk.size + 100, leafUuid: 'new-leaf', lastRecordAt: '2026-10-02T12:00:00Z' } });
      await new Promise((resolve) => setImmediate(resolve)); // E11: discoveries apply at the end of the burst's turn
      expect(index.sessions.get(appId)?.unread).toBe(true);
      await bus.invoke('session.setVisible', { appSessionId: appId, visible: true }, page());
      expect(index.sessions.get(appId)?.unread).toBe(false);
    } finally { sessions.stop(); index.close(); dir.dispose(); }
  });

  it('holds nothing for a client already gone when it reports', async () => {
    const visibility = vi.fn();
    const sessions = start({ env: {}, hosts, indexSource: { start: () => () => {}, onSetVisible: visibility } });
    const gone = page();
    gone.end();
    await bus.invoke('session.setVisible', { appSessionId: 'app', visible: true }, gone);
    expect(visibility.mock.calls).toEqual([]);
    sessions.stop();
  });

  it('does not let one window hide a session still visible in another', async () => {
    const visibility = vi.fn();
    const sessions = start({ env: {}, hosts, indexSource: { start: () => () => {}, onSetVisible: visibility } });
    const a = page();
    const b = page();
    await bus.invoke('session.setVisible', { appSessionId: 'app', visible: true }, a);
    await bus.invoke('session.setVisible', { appSessionId: 'app', visible: true }, b);
    await bus.invoke('session.setVisible', { appSessionId: 'app', visible: false }, a);
    expect(visibility.mock.calls).toEqual([['app', true]]);
    b.end();
    expect(visibility.mock.calls).toEqual([['app', true], ['app', false]]);
    sessions.stop();
  });
});

describe('answers cannot outlive attention', () => {
  afterEach(() => { hosts.dispatch.mockClear(); });
  it('refuses an answer after host-loss retirement instead of forwarding it to the replacement host', async () => {
    const sessions = start({ env: {}, hosts });
    const id = 'app' as AppSessionId;
    const pending = item(id, 'permission', '2026-10-02T00:00:00Z');
    let publish!: (items: typeof pending[]) => void;
    sessions.model.register({ start: (writer) => { publish = (items) => writer.observeAttention(id, items); return () => {}; } });
    publish([pending]);
    expect(bus.intercepted()).toEqual(['session.answer']);
    const input = { appSessionId: id, requestId: pending.request.requestId, answer: { kind: 'permission', decision: 'deny', message: 'No' } };
    expect(await bus.invoke('session.answer', input)).toEqual({ ok: true, value: { outcome: 'delivered' } });
    publish([]); // attention service's host-loss update
    expect(await bus.invoke('session.answer', input)).toEqual({ ok: true, value: { outcome: 'not_pending' } });
    expect(hosts.dispatch).toHaveBeenCalledTimes(1);
    sessions.stop();
    expect(bus.intercepted()).toEqual([]);
  });

  it('relays the host’s refusal of a pending answer with its code', async () => {
    const sessions = start({ env: {}, hosts });
    const id = 'app' as AppSessionId;
    const pending = item(id, 'permission', '2026-10-02T00:00:00Z');
    sessions.model.register({ start: (writer) => (writer.observeAttention(id, [pending]), () => {}) });
    hosts.dispatch.mockResolvedValueOnce({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is not running' } } as never);
    const input = { appSessionId: id, requestId: pending.request.requestId, answer: { kind: 'permission', decision: 'deny', message: 'No' } };
    expect(await bus.invoke('session.answer', input)).toEqual({ ok: false, error: { code: 'host_unavailable', message: 'engine-host is not running' } });
    sessions.stop();
  });
});

const hosts = { dispatch: vi.fn(async () => ({ ok: true as const, value: { outcome: 'delivered' as const } })), onEvent: () => () => {}, onState: () => () => {}, onStreaming: () => () => {}, setResync: () => {} }; // C12: onState; E10: onStreaming, setResync

describe('launch mode reaches the page', () => {
  it('session.launchMode answers the mode decided at start', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const index = start({ env: {}, hosts });
    expect(await bus.invoke('session.launchMode')).toEqual({ ok: true, value: { mode: 'index' } });
    index.stop();

    bus = fakeBus();
    const env = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/empty.json', MAWS_SCENARIO_CLOCK: 'manual', MAWS_E2E: '1' };
    const scenario = start({ env, hosts });
    expect(await bus.invoke('session.launchMode')).toEqual({ ok: true, value: { mode: 'scenario' } });
    scenario.stop();
    log.mockRestore();
  });
});

// M5b fix round 6: a scenario's statuses are the spine's own (D11); its load emits none of them, so main's mirror on the
// daemon shape reads them with session.engineStatuses
describe('session.engineStatuses', () => {
  it('answers the statuses the read model holds, a scenario’s load-time ones included', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const env = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/nine-sessions.json', MAWS_SCENARIO_CLOCK: 'manual', MAWS_E2E: '1' };
    const scenario = start({ env, hosts });
    const fixture = JSON.parse(readFileSync(join(process.cwd(), 'test/fixtures/shell/nine-sessions.json'), 'utf8')) as { engine: { appSessionId: string }[] };
    const answer = await bus.main('session.engineStatuses', undefined);
    expect(await bus.invoke('session.engineStatuses'), 'main-only').toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
    expect(answer.ok && (answer.value as { statuses: { appSessionId: string }[] }).statuses.map((s) => s.appSessionId).sort()).toEqual(fixture.engine.map((e) => e.appSessionId).sort());
    expect(bus.emittedOf('session.status'), 'the load emitted none of them').toEqual([]);
    scenario.stop();
    log.mockRestore();
  });
});

describe('C4’s index source attaches through the read model', () => {
  const indexSource = () => {
    const stop = vi.fn();
    return { stop, start: vi.fn(() => stop) };
  };

  it('starts in launch mode index and stops with the sessions', () => {
    const source = indexSource();
    const sessions = start({ env: {}, hosts, indexSource: source });
    expect(source.start).toHaveBeenCalledOnce();
    sessions.stop();
    expect(source.stop).toHaveBeenCalledOnce();
  });

  it('is refused unstarted in launch mode scenario, so the index never scans', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const source = indexSource();
    const env = { MAWS_SESSION_SOURCE: 'stub:test/fixtures/shell/empty.json', MAWS_SCENARIO_CLOCK: 'manual', MAWS_E2E: '1' };
    start({ env, hosts, indexSource: source }).stop();
    expect(source.start).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('read-model: scenario mode, source ignored');
    log.mockRestore();
  });
});

// The read model hears attention and main's own events only as the bus sent them, and relays each digest on it.
describe('the read side over the bus', () => {
  it('folds attention.changed as emitted, never a refused payload, and emits session.digest for each digest', () => {
    const sessions = start({ env: {}, hosts });
    const id = 'app' as AppSessionId;
    const pending = item(id, 'permission', '2026-10-02T00:00:00Z');
    expect(bus.emit('attention.changed', { appSessionId: id, items: [pending] })).toBe(true);
    expect(sessions.model.attention(id)).toEqual([pending]);
    expect(bus.emit('attention.changed', { appSessionId: id, items: 'none' } as never)).toBe(false);
    expect(sessions.model.attention(id)).toEqual([pending]);
    sessions.model.register({ start: (writer) => (writer.setDigest(digest(id)), () => {}) });
    expect(bus.emittedOf('session.digest')).toEqual([sessions.model.digest(id)]);
    sessions.stop();
  });
});

// E3 (Design §5): a side thread's rows come back from the index, not from the read model's store of 20 app events
describe('side-thread events in session.appEvents', () => {
  const parent = '6f1f8a52-6f0b-4c43-9a55-9a4b0f3f0a01' as AppSessionId;
  const event = (id: string, kind: 'notice.posted' | 'side.thread.opened') =>
    (kind === 'notice.posted'
      ? { id: `${parent}:${id}`, sessionId: 's', at: '2026-10-02T00:00:00.000Z', seq: null, agentId: null, parentToolUseId: null, kind, level: 'info', key: 'k', text: 'x' }
      : { id: `${parent}:${id}`, sessionId: 's', at: '2026-10-02T00:00:00.000Z', seq: null, agentId: null, parentToolUseId: null, kind, childAppSessionId: 'c', childEngineSessionId: null, anchor: null, openedBy: 'btw' }) as never;

  it('keeps side.thread.* out of the read model’s capped store', () => {
    const observed: unknown[] = [];
    let tapped: ((payload: { appSessionId: string; events: unknown[] }) => void) | null = null;
    const source = emittedAppEventsSource(((_name: string, fn: typeof tapped) => ((tapped = fn), () => {})) as never);
    source.start({ observeAppEvents: (_id: AppSessionId, events: unknown[]) => observed.push(...events) } as never);
    tapped!({ appSessionId: parent, events: [event('notice', 'notice.posted'), event('side-thread:c:opened', 'side.thread.opened')] });
    expect(observed.map((e) => (e as { kind: string }).kind)).toEqual(['notice.posted']);
  });

  it('answers the read model’s events with the index’s, once per id', async () => {
    const extra = vi.fn(() => [event('side-thread:c:opened', 'side.thread.opened'), event('side-thread:c:opened', 'side.thread.opened')]);
    const sessions = start({ env: {}, hosts, appEventsExtra: extra });
    expect(await bus.invoke('session.appEvents', { appSessionId: parent })).toEqual({ ok: true, value: { events: [event('side-thread:c:opened', 'side.thread.opened')] } });
    expect(extra).toHaveBeenCalledWith(parent);
    sessions.stop();
  });
});
