import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn() } }));
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, EventName } from '@shared/ipc/schema';
import { TEST_FIXTURE_DIR } from '../../../test/support/fixtures';
import type { onEmitted } from '../ipc/events';
import { emittedAttentionSource } from '.';
import { SessionReadModel } from './read-model';
import { stubSource, type StubSourceDeps } from './stub-source';

const NINE = join(TEST_FIXTURE_DIR, 'shell/nine-sessions.json');
const CHARTER = 'app-9a1d4262' as AppSessionId;
const FIX = 'app-3eb04b84' as AppSessionId;
const USAGE = 'app-59505fdc' as AppSessionId;

function harness() {
  const handlers = new Map<CommandName, (input: unknown) => unknown>();
  const emitted: { name: EventName; payload: unknown }[] = [];
  // main's emit and its taps, as sessions/index.ts wires them: the read model hears attention only as emitted.
  const taps = new Map<string, (payload: unknown) => void>();
  const tap = ((name: string, listener: (payload: unknown) => void) => {
    taps.set(name, listener);
    return () => taps.delete(name);
  }) as typeof onEmitted;
  const deps: StubSourceDeps = {
    emit: (name, payload) => {
      emitted.push({ name, payload });
      taps.get(name)?.(payload);
      return true;
    },
    intercept: (name, handler) => {
      handlers.set(name, handler as (input: unknown) => unknown);
      return () => handlers.delete(name);
    },
    now: () => Date.parse('2026-09-28T11:00:00.000Z'),
  };
  const model = new SessionReadModel('scenario');
  const stopTap = model.registerScenario(emittedAttentionSource(tap));
  const source = stubSource(NINE, { kind: 'manual' }, deps);
  const stopSource = model.registerScenario(source);
  const stop = () => {
    stopSource();
    stopTap();
  };
  const call = <T>(name: CommandName, input?: unknown) => handlers.get(name)!(input) as T;
  const events = (name: EventName) => emitted.filter((e) => e.name === name).map((e) => e.payload);
  return { model, source, stop, handlers, call, events, emitted };
}

const scenarioGlobal = () => (globalThis as { __maws_scenario?: { now(): number; advanceTo(ms: number): void } }).__maws_scenario;

describe('stub source plays a timeline', () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    vi.restoreAllMocks();
    h = harness();
  });
  afterEach(() => h.stop());

  it('emits nothing at load but the scenario’s attention, which reaches the read model through the emit tap', () => {
    expect([...new Set(h.emitted.map((e) => e.name))]).toEqual(['attention.changed']);
    expect(h.model.attention(FIX).map((i) => i.kind)).toEqual(['permission']);
  });

  it('fills the read model from the scenario at start', () => {
    expect(h.model.digests()).toHaveLength(11);
    expect(h.model.record(FIX)?.title.text).toBe('Fix sidebar drag');
    expect(h.model.attention(FIX).map((i) => i.kind)).toEqual(['permission']);
    expect(h.model.digests().find((d) => d.appSessionId === CHARTER)?.activity).toBe('Running bun test');
  });

  it('answers C4’s record side and C3’s attention commands from the scenario', () => {
    expect(h.call<{ sessions: unknown[] }>('session.list', {}).sessions).toHaveLength(11);
    expect(h.call<{ projects: { name: string }[] }>('session.projects.list').projects.map((p) => p.name)).toEqual([
      'MAWS', 'codex_somersault', 'claude-usage-menubar',
    ]);
    expect(h.call<{ title: { text: string } }>('session.get', { appSessionId: FIX }).title.text).toBe('Fix sidebar drag');
    expect(h.call<{ kind: string }[]>('attention.list').map((i) => i.kind).sort()).toEqual(['permission', 'plan', 'question']);
    const [item] = h.model.attention(FIX);
    const answer = h.call<{ event: { kind: string; toolName: string } }>('attention.request', { appSessionId: FIX, requestId: item.request.requestId });
    expect(answer.event).toMatchObject({ kind: 'permission.requested', toolName: 'Bash' });
    expect(h.call('attention.request', { appSessionId: FIX, requestId: 'nope' })).toEqual({ event: null });
    expect([...h.handlers.keys()].sort()).toEqual([
      'attention.list', 'attention.request', 'session.answer', 'session.get', 'session.list', 'session.projects.list', 'session.update',
    ]);
  });

  it('drives the timeline on the manual clock through the main-process global', () => {
    expect(scenarioGlobal()?.now()).toBe(0);
    expect(h.model.midTurnCount()).toBe(5);
    scenarioGlobal()!.advanceTo(3000);
    expect(h.model.attention(CHARTER).map((i) => i.summary)).toEqual(['Read: docs/charter.md']);
    expect(h.events('attention.changed')).toHaveLength(3 + 1); // the three sessions waiting at load, then the 3 s entry
    expect(h.model.midTurnCount()).toBe(5);
    scenarioGlobal()!.advanceTo(8000);
    expect(h.model.midTurnCount()).toBe(4);
    scenarioGlobal()!.advanceTo(12000);
    expect(h.model.midTurnCount()).toBe(3);
    expect(h.model.attention(FIX).map((i) => [i.kind, i.summary])).toEqual([['interrupted', 'Session interrupted, 1 approval lost']]);
    expect(h.model.digests().find((d) => d.appSessionId === FIX)?.phase).toBe('exited');
    expect(scenarioGlobal()?.now()).toBe(12000);
  });

  it('emits engine statuses as C3’s session.status would', () => {
    scenarioGlobal()!.advanceTo(8000);
    const statuses = h.events('session.status') as { appSessionId: string; status: { engineState: string; turn: unknown } }[];
    expect(statuses.findLast((s) => s.appSessionId === USAGE)?.status).toMatchObject({ engineState: 'idle', turn: null });
  });

  it('marks a turn end unread for a session that is not visible', () => {
    scenarioGlobal()!.advanceTo(8000);
    expect(h.call<{ unread: boolean }>('session.get', { appSessionId: USAGE }).unread).toBe(true);
    const changed = h.events('session.changed') as { record: { appId: string; unread: boolean }; revision: number }[];
    expect(changed.at(-1)).toMatchObject({ record: { appId: USAGE, unread: true } });
  });

  it('keeps a turn end read for a visible session', () => {
    h.model.setVisible(USAGE, true);
    scenarioGlobal()!.advanceTo(8000);
    expect(h.call<{ unread: boolean; lastSeen: { at: string } }>('session.get', { appSessionId: USAGE })).toMatchObject({
      unread: false,
      lastSeen: { at: '2026-09-28T11:00:00.000Z' },
    });
  });

  it('clears unread, sets lastSeen and resets cost since seen when a session becomes visible', () => {
    const quota = 'app-bac6130b' as AppSessionId;
    expect(h.call<{ unread: boolean }>('session.get', { appSessionId: quota }).unread).toBe(true);
    h.model.setVisible(quota, true);
    expect(h.call<{ unread: boolean; lastSeen: { at: string } }>('session.get', { appSessionId: quota })).toMatchObject({
      unread: false,
      lastSeen: { at: '2026-09-28T11:00:00.000Z' },
    });
    const withCost = h.model.digests().find((d) => d.cost !== null && d.cost.totalUsd > 0)!;
    h.model.setVisible(withCost.appSessionId, true);
    expect(h.model.digests().find((d) => d.appSessionId === withCost.appSessionId)?.cost?.sinceSeenUsd).toBe(0);
  });

  it('answers session.answer for a scenario item: delivered, the item gone, the session continuing', () => {
    scenarioGlobal()!.advanceTo(3000);
    const [read] = h.model.attention(CHARTER);
    const result = h.call('session.answer', {
      appSessionId: CHARTER,
      requestId: read.request.requestId,
      answer: { kind: 'permission', decision: 'allow', scope: 'once' },
    });
    expect(result).toEqual({ outcome: 'delivered' });
    expect(h.events('attention.changed').at(-1)).toEqual({ appSessionId: CHARTER, items: [] });
    expect(h.model.digests().find((d) => d.appSessionId === CHARTER)).toMatchObject({ phase: 'working', activity: 'Continuing', pendingRequests: 0 });
    expect(h.model.engineStatus(CHARTER)).toMatchObject({ engineState: 'running', pendingRequests: 0 });
    expect(h.call('session.answer', { appSessionId: CHARTER, requestId: read.request.requestId, answer: {} })).toEqual({ outcome: 'not_pending' });
  });

  it('removes its interceptors and the clock global when stopped', () => {
    h.stop();
    expect(h.handlers.size).toBe(0);
    expect(scenarioGlobal()).toBeUndefined();
  });
});

describe('stub source on the wall clock', () => {
  it('plays entries at their offsets', () => {
    vi.useFakeTimers();
    try {
      const deps: StubSourceDeps = { emit: () => true, intercept: () => () => {}, now: () => Date.now() };
      const model = new SessionReadModel('scenario');
      const stop = model.registerScenario(stubSource(NINE, { kind: 'wall' }, deps));
      expect(scenarioGlobal()).toBeUndefined();
      vi.advanceTimersByTime(7999);
      expect(model.midTurnCount()).toBe(5);
      vi.advanceTimersByTime(1);
      expect(model.midTurnCount()).toBe(4);
      stop();
      vi.advanceTimersByTime(10000);
      expect(model.midTurnCount()).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
});
