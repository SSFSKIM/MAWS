import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandName, CommandResult, EventName, EventPayload, MawsBridge } from '@shared/ipc/schema';
import type { ReplayFixture, ReplayProgress } from '@shared/ipc/schema/session';
import { createReplayDiagnosticsStore, describeProgress, describeSpeed } from './replay-diagnostics';

const workflow: ReplayFixture = { id: 'f1', name: 'workflow', kind: 'journal', path: '/repo/spikes/protocol-probe/fixtures/pass2/workflow.jsonl', sessionId: null, addedAt: '2026-09-28T10:00:00.000Z', lastPlayedAt: null };
const parent: ReplayFixture = { id: 'f2', name: 'subagent-parent', kind: 'transcript', path: '/repo/test/fixtures/transcripts/subagent-parent.jsonl', sessionId: '9a1d4262', addedAt: '2026-09-28T10:00:00.000Z', lastPlayedAt: null };
const A = 'app-replay-1' as AppSessionId;
const progress = (over: Partial<ReplayProgress> = {}): ReplayProgress => ({ appSessionId: A, state: 'running', index: 0, total: 120, at: null, speed: 5, message: null, ...over });

function fakeClient(given: Partial<Record<CommandName, (input: unknown) => CommandResult<CommandName>>> = {}) {
  const answers: typeof given = { 'session.replay.fixtures': () => ({ ok: true, value: { fixtures: [] } }) as CommandResult<CommandName>, ...given };
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const client = {
    invoke: vi.fn(async (name: CommandName, input: unknown) => answers[name]?.(input) ?? ({ ok: true, value: undefined } as CommandResult<CommandName>)),
    on: vi.fn((name: string, listener: (payload: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    }),
  };
  return {
    client: client as unknown as MawsBridge,
    invoke: client.invoke,
    event: <N extends EventName>(name: N, payload: EventPayload<N>) => listeners.get(name)?.forEach((l) => l(payload)),
    listening: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('replay diagnostics', () => {
  it('lists the fixtures, starts the chosen one at the chosen speed, and follows its progress to done', async () => {
    const fake = fakeClient({
      'session.replay.fixtures': () => ({ ok: true, value: { fixtures: [workflow, parent] } }) as CommandResult<CommandName>,
      'session.replay.start': () => ({ ok: true, value: { appSessionId: A, sessionId: 'rp_1', totalRows: 120, spanMs: 9000 } }) as CommandResult<CommandName>,
    });
    const store = createReplayDiagnosticsStore(fake.client);
    const disconnect = store.getState().connect();
    await flush();
    expect(store.getState().fixtures).toEqual([workflow, parent]);

    await store.getState().start(parent, 'instant');
    expect(fake.invoke).toHaveBeenCalledWith('session.replay.start', { source: { kind: 'transcript', path: parent.path }, speed: 'instant' });
    expect(store.getState().runs[A]).toMatchObject({ name: 'subagent-parent', progress: null });

    fake.event('session.replay.progress', progress({ index: 25, speed: 'instant' }));
    expect(describeProgress(store.getState().runs[A].progress)).toBe('running · 25 / 120 · instant');
    fake.event('session.replay.progress', progress({ state: 'done', index: 120, speed: 'instant' }));
    expect(describeProgress(store.getState().runs[A].progress)).toBe('done · 120 / 120 · instant');
    disconnect();
    expect(fake.listening()).toBe(0);
  });

  it('sends pause, resume, a speed and stop for a run, and forgets it once stopped', async () => {
    const fake = fakeClient();
    const store = createReplayDiagnosticsStore(fake.client);
    store.getState().connect();
    fake.event('session.replay.progress', progress());
    expect(store.getState().runs[A]).toMatchObject({ name: A, progress: { state: 'running' } }); // a run this page did not start
    await store.getState().control(A, { action: 'pause' });
    await store.getState().control(A, { speed: 1 });
    await store.getState().control(A, { action: 'stop' });
    expect(fake.invoke.mock.calls.filter(([name]) => name === 'session.replay.control').map(([, input]) => input)).toEqual([
      { appSessionId: A, action: 'pause' },
      { appSessionId: A, speed: 1 },
      { appSessionId: A, action: 'stop' },
    ]);
    fake.event('session.replay.progress', progress({ state: 'stopped' }));
    expect(store.getState().runs[A]).toBeUndefined();
  });

  it('shows why a start failed', async () => {
    const fake = fakeClient({ 'session.replay.start': () => ({ ok: false, error: { code: 'internal', message: 'replay source not found: /x.jsonl' } }) });
    const store = createReplayDiagnosticsStore(fake.client);
    store.getState().connect();
    await store.getState().start(workflow, 5);
    expect(store.getState().error).toBe('replay source not found: /x.jsonl');
    expect(store.getState().runs).toEqual({});
  });

  it('labels speeds and progress', () => {
    expect(describeSpeed(0.25)).toBe('0.25×');
    expect(describeSpeed(5)).toBe('5×');
    expect(describeSpeed('instant')).toBe('instant');
    expect(describeProgress(null)).toBe('starting…');
    expect(describeProgress(progress({ state: 'error', index: 3, message: 'unexpected frame' }))).toBe('error · 3 / 120 · 5× · unexpected frame');
  });
});
