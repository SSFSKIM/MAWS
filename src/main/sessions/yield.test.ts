import { describe, expect, it, vi } from 'vitest';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { CommandName, CommandResult, EventName, EventPayload } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { record, status } from '../../../test/support/builders';
import type { HostEvents } from './context';
import { canYield, holderPhrase, startYield } from './yield';

const APP = 'app-w7' as AppSessionId;
const S = '11111111-1111-4111-8111-111111111111' as SessionId;
const TERMINAL = { kind: 'terminal' as const, pid: 96367 };

function harness(holder: SessionRecord['holder'], answers: Partial<Record<CommandName, unknown>> = {}) {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const calls: { name: CommandName; input: unknown }[] = [];
  const emitted: { name: EventName; payload: unknown }[] = [];
  let current: SessionRecord | null = record(APP, { engineSessionId: S, holder });
  const onEvent = ((name: string, listener: (payload: unknown) => void) => {
    const set = listeners.get(name) ?? new Set();
    set.add(listener);
    listeners.set(name, set);
    return () => set.delete(listener);
  }) as HostEvents;
  const stop = startYield({
    dispatch: vi.fn(async (_owner, name: CommandName, input: unknown) => {
      calls.push({ name, input });
      return { ok: true, value: answers[name] ?? (name === 'session.stop' ? { exited: true, code: 0, signal: null } : undefined) } as CommandResult<CommandName>;
    }),
    onEvent,
    sessions: { getByEngineId: (id) => (id === S ? current : null) },
    emit: (name, payload) => void emitted.push({ name, payload }) as never,
    now: () => '2026-10-01T18:23:51.000Z',
  });
  const fire = <N extends EventName>(name: N, payload: EventPayload<N>) => {
    const checked = validateEventPayload(name, payload);
    if (!checked.ok) throw new Error(`invalid ${name}: ${JSON.stringify(checked.issues)}`);
    for (const listener of listeners.get(name) ?? []) listener(checked.value);
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { calls, emitted, fire, stop, settle, setRecord: (next: SessionRecord | null) => void (current = next) };
}

const busy = (over: Partial<EngineSessionStatus> = {}): EngineSessionStatus => ({ ...status(APP), keepAlive: ['turn'], ...over });
const idle = (over: Partial<EngineSessionStatus> = {}): EngineSessionStatus => ({ ...status(APP), keepAlive: [], ...over });

// W7 (charter §4.3 as amended 2026-10-01): a live MAWS process yields once the foreign process writes.
describe('a live MAWS process yields to a foreign writer', () => {
  it('posts a notice and stops at once when nothing would be lost, leaving an empty queue unpaused', async () => {
    const h = harness({ kind: 'self', contestedBy: TERMINAL }, { 'session.status': idle() });
    h.fire('fs.foreignWrite', { sessionId: S, appSessionId: APP, holder: TERMINAL });
    await h.settle();
    expect(h.emitted).toHaveLength(1);
    const notice = (h.emitted[0].payload as { events: { id: string; seq: null; kind: string; key: string; text: string }[] }).events[0];
    expect(notice).toMatchObject({ seq: null, kind: 'notice.posted', key: 'session:yielded' });
    expect(notice.id.startsWith(`${APP}:`)).toBe(true); // an app-synthesised event: main's read model keeps it
    expect(notice.text).toBe('A terminal (pid 96367) started writing this session. MAWS stops its own process once it is idle and follows the transcript read-only.');
    expect(h.calls.map((c) => c.name)).toEqual(['session.status', 'session.stop']);
    expect(h.calls[1].input).toEqual({ appSessionId: APP, reason: 'stop', ifIdle: true });
  });

  it('lets a turn in flight finish with its queue paused, then stops once, and forgets the session after its exit', async () => {
    const queued = { length: 1, paused: false };
    const h = harness({ kind: 'self', contestedBy: TERMINAL }, { 'session.status': busy({ queue: queued, keepAlive: ['turn', 'queued_messages'] }) });
    h.fire('fs.foreignWrite', { sessionId: S, appSessionId: APP, holder: TERMINAL });
    await h.settle();
    expect(h.calls.map((c) => c.name)).toEqual(['session.status', 'session.queue.setPaused']);
    expect(h.calls[1].input).toEqual({ appSessionId: APP, paused: true });
    h.fire('session.status', { appSessionId: APP, status: busy() });
    expect(h.calls.filter((c) => c.name === 'session.stop')).toHaveLength(0);
    h.fire('session.status', { appSessionId: APP, status: idle({ queue: { length: 1, paused: true }, keepAlive: ['queued_messages'] }) }); // its own paused queue
    h.fire('session.status', { appSessionId: APP, status: idle() });
    expect(h.calls.filter((c) => c.name === 'session.stop')).toHaveLength(1);
    h.fire('session.status', { appSessionId: APP, status: idle({ process: 'exited' }) });
    h.fire('session.status', { appSessionId: APP, status: idle() }); // a later launch of the same id is not yielding
    expect(h.calls.filter((c) => c.name === 'session.stop')).toHaveLength(1);
  });

  // review finding: work that began after the idle status the yield read is the host's to see; it answers skipped
  it('tries again at a later status when the host skipped the stop because work began', async () => {
    const h = harness({ kind: 'self', contestedBy: TERMINAL }, { 'session.status': idle(), 'session.stop': { exited: false, code: null, signal: null, skipped: true } });
    h.fire('fs.foreignWrite', { sessionId: S, appSessionId: APP, holder: TERMINAL });
    await h.settle();
    await h.settle();
    h.fire('session.status', { appSessionId: APP, status: idle() });
    await h.settle();
    expect(h.calls.filter((c) => c.name === 'session.stop')).toHaveLength(2);
  });

  it('does nothing for a session MAWS does not run, and yields once per contest', async () => {
    const h = harness({ kind: 'terminal', pid: 96367 }, { 'session.status': busy() });
    h.fire('fs.foreignWrite', { sessionId: S, appSessionId: APP, holder: TERMINAL });
    await h.settle();
    expect(h.calls).toEqual([]);
    expect(h.emitted).toEqual([]);
    h.setRecord(record(APP, { engineSessionId: S, holder: { kind: 'self', contestedBy: TERMINAL } }));
    h.fire('fs.foreignWrite', { sessionId: S, appSessionId: APP, holder: TERMINAL });
    h.fire('fs.foreignWrite', { sessionId: S, appSessionId: APP, holder: TERMINAL });
    await h.settle();
    expect(h.emitted).toHaveLength(1);
    h.stop();
  });

  it('names the holder the way the row does, and waits out background work and pending requests', () => {
    expect(holderPhrase({ kind: 'background_job', pid: 5, jobId: 'abcd1234' })).toBe('A background job (bg · abcd1234)');
    expect(holderPhrase({ kind: 'background_job', pid: null, jobId: null })).toBe('A background job');
    expect(canYield(idle({ keepAlive: ['stateful_mcp', 'queued_messages'] }))).toBe(true);
    expect(canYield(idle({ keepAlive: ['background_tasks'] }))).toBe(false);
    expect(canYield(idle({ keepAlive: ['pending_request'] }))).toBe(false);
    expect(canYield(idle({ process: 'initializing' }))).toBe(false);
  });
});
