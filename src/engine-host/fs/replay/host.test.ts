import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { HostEmit } from '@shared/host/runtime';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { FIXTURE_DIR, loadJournal, TRANSCRIPT_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { ReplayHost, type ReplayBindings } from './host';
import { frameUnknownNormalizer } from './journal-source';

const WORKFLOW = { kind: 'journal', path: join(FIXTURE_DIR, 'pass2/workflow.jsonl') } as const;
const app = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as AppSessionId;
const run = (n: number) => `rp_00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as SessionId;

function harness(read?: (path: string) => Promise<Buffer>) {
  const emitted: { name: EventName; payload: unknown }[] = [];
  const emit: HostEmit = (name, payload) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
    emitted.push({ name, payload });
  };
  const bound = new Map<AppSessionId, SessionId>();
  const bindings: ReplayBindings = {
    bind: (pairs) => pairs.forEach(({ sessionId, appSessionId }) => bound.set(appSessionId, sessionId)),
    unbind: vi.fn(async (appSessionId: AppSessionId) => void bound.delete(appSessionId)),
  };
  const host = new ReplayHost({ emit, bindings, normalizer: frameUnknownNormalizer, readSource: read });
  const of = <N extends EventName>(name: N) => emitted.filter((e) => e.name === name).map((e) => e.payload as EventPayload<N>);
  const about = (appSessionId: AppSessionId) => emitted.filter((e) => (e.payload as { appSessionId?: string }).appSessionId === appSessionId);
  return { host, emitted, bound, bindings, of, about };
}

// Resolves once the run with this app id reports `state`.
const until = (h: ReturnType<typeof harness>, appSessionId: AppSessionId, state: string) =>
  vi.waitFor(() => expect(h.of('session.replay.progress').some((p) => p.appSessionId === appSessionId && p.state === state)).toBe(true));

describe('the engine host launches, controls and serves replay runs', () => {
  afterEach(() => void vi.useRealTimers());

  it('two concurrent replays of one journal carry two distinct session ids and app ids, neither the fixture\'s', async () => {
    const h = harness();
    const [a, b] = await Promise.all([
      h.host.launch({ appSessionId: app(1), sessionId: run(1), source: WORKFLOW, speed: 'instant' }),
      h.host.launch({ appSessionId: app(2), sessionId: run(2), source: WORKFLOW, speed: 'instant' }),
    ]);
    expect(a).toEqual(b);
    expect(a.totalRows).toBeGreaterThan(0);
    await until(h, app(1), 'done');
    await until(h, app(2), 'done');
    const batches = h.of('session.eventBatch');
    const original = new Set(loadJournal('pass2', 'workflow').map((r) => (r.frame as { session_id?: string }).session_id).filter(Boolean));
    expect(new Set(batches.map((batch) => batch.appSessionId))).toEqual(new Set([app(1), app(2)]));
    const sessionsOf = (id: AppSessionId) => new Set(batches.filter((batch) => batch.appSessionId === id).flatMap((batch) => batch.events.map((e) => e.sessionId)));
    expect(sessionsOf(app(1))).toEqual(new Set([run(1)]));
    expect(sessionsOf(app(2))).toEqual(new Set([run(2)]));
    for (const id of [run(1), run(2)]) expect(original.has(id)).toBe(false);
    expect(h.bound.get(app(1))).toBe(run(1));
    // A finished run keeps serving its events until it is stopped.
    expect(h.host.snapshot(app(1))).toEqual({ events: batches.filter((batch) => batch.appSessionId === app(1)).flatMap((batch) => batch.events), complete: true });
  });

  it('refuses a second launch of an app id that is already running', async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.host.launch({ appSessionId: app(3), sessionId: run(3), source: WORKFLOW, speed: 1 });
    await expect(h.host.launch({ appSessionId: app(3), sessionId: run(4), source: WORKFLOW, speed: 1 })).rejects.toThrow(`replay already live: ${app(3)}`);
    expect(h.bound.get(app(3))).toBe(run(3));
  });

  it('a launch that fails emits nothing and binds nothing for its ids', async () => {
    const h = harness();
    const missing = join(TRANSCRIPT_FIXTURE_DIR, 'no-such.jsonl');
    await expect(h.host.launch({ appSessionId: app(5), sessionId: run(5), source: { kind: 'transcript', path: missing }, speed: 1 })).rejects.toThrow(`replay source not found: ${missing}`);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.about(app(5))).toEqual([]);
    expect(h.bound.has(app(5))).toBe(false);
    expect(h.host.snapshot(app(5))).toBeNull();
  });

  it('a stop for a launch still loading cancels it: the load is discarded, nothing is bound or emitted', async () => {
    vi.useFakeTimers();
    let release: (bytes: Buffer) => void = () => {};
    const h = harness(() => new Promise((resolve) => (release = resolve)));
    const launched = h.host.launch({ appSessionId: app(6), sessionId: run(6), source: WORKFLOW, speed: 'instant' });
    const rejected = expect(launched).rejects.toThrow(`replay launch cancelled: ${app(6)}`);
    h.host.control({ appSessionId: app(6), action: 'stop' }); // answers at once
    release(Buffer.from(`${JSON.stringify(loadJournal('pass2', 'workflow')[0])}\n`));
    await rejected;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.about(app(6))).toEqual([]);
    expect(h.bound.has(app(6))).toBe(false);
    // The cancel was consumed: the id can be launched afresh.
    release = () => {};
    const again = h.host.launch({ appSessionId: app(6), sessionId: run(6), source: WORKFLOW, speed: 'instant' });
    release(Buffer.from(`${JSON.stringify(loadJournal('pass2', 'workflow')[0])}\n`));
    await expect(again).resolves.toMatchObject({ totalRows: 0 });
  });

  it('stop ends a running replay: progress stopped, the ids unbound, the runner dropped; an unknown id is a no-op', async () => {
    vi.useFakeTimers();
    const h = harness();
    await h.host.launch({ appSessionId: app(7), sessionId: run(7), source: WORKFLOW, speed: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(h.of('session.replay.progress')[0]).toMatchObject({ appSessionId: app(7), state: 'running', index: 0, speed: 1 });
    h.host.control({ appSessionId: app(7), action: 'pause' });
    h.host.control({ appSessionId: app(7), speed: 5 });
    expect(h.of('session.replay.progress').at(-1)).toMatchObject({ state: 'paused', speed: 5 });
    expect(h.host.snapshot(app(7))).toMatchObject({ complete: false });
    h.host.control({ appSessionId: app(7), action: 'stop' });
    expect(h.of('session.replay.progress').at(-1)).toMatchObject({ state: 'stopped' });
    expect(h.bindings.unbind).toHaveBeenCalledWith(app(7));
    expect(h.host.snapshot(app(7))).toBeNull();
    const before = h.emitted.length;
    h.host.control({ appSessionId: app(7), action: 'stop' });
    h.host.control({ appSessionId: app(99), action: 'stop' });
    expect(h.emitted).toHaveLength(before);
  });
});
