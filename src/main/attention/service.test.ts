import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttentionItemSchema, type AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { CommandName, EventName } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { interruptedSummary, startAttentionService, type AttentionServiceDeps } from './service';
import type { AttentionStore } from './store';

const APP = 'app-a' as AppSessionId;
const SID = '33333333-3333-4333-8333-333333333333';
const AT = '2026-09-28T10:00:00.000Z';

class FakeStore implements AttentionStore {
  sessions = new Map<string, AttentionItem[]>();
  replaced: [string, AttentionItem[]][] = [];
  retired: string[] = [];
  constructor(initial: AttentionItem[] = []) {
    for (const item of initial) this.sessions.set(item.appSessionId, [...(this.sessions.get(item.appSessionId) ?? []), item]);
  }
  async list() {
    return [...this.sessions.values()].flat();
  }
  async replaceForSession(id: AppSessionId, items: AttentionItem[]) {
    this.replaced.push([id, items]);
    this.sessions.set(id, items);
  }
  async retireForSession(id: AppSessionId) {
    this.retired.push(id);
    this.sessions.delete(id);
  }
}

function item(over: Partial<AttentionItem> & Pick<AttentionItem, 'kind' | 'state'>): AttentionItem {
  return AttentionItemSchema.parse({
    id: `${APP}:${over.kind}:${over.request?.requestId ?? 'x'}`, appSessionId: APP, sessionId: SID, summary: 'Bash: git log --oneline', createdAt: AT, stateChangedAt: AT, expiresAt: null,
    request: { requestId: 'req-1', toolUseId: 'toolu_1', taskId: null, agentId: null }, ...over,
  });
}

let seq = 0;
function event(kind: string, payload: Record<string, unknown> = {}): SessionEvent {
  seq += 1;
  return { id: `${APP}:L:${seq}:0`, sessionId: SID, at: AT, seq, agentId: null, parentToolUseId: null, kind, ...payload } as unknown as SessionEvent;
}

function setup(opts: { store?: FakeStore; dispatch?: AttentionServiceDeps['dispatch'] } = {}) {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const changed: { appSessionId: string; items: AttentionItem[] }[] = [];
  const store = opts.store ?? new FakeStore();
  const dispatch = opts.dispatch ?? vi.fn(async () => ({ ok: true as const, value: { event: null } }));
  const service = startAttentionService({
    onEvent: ((name: EventName, listener: (payload: unknown) => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
      return () => {};
    }) as AttentionServiceDeps['onEvent'],
    dispatch,
    store,
    emit: ((name: EventName, payload: unknown) => {
      expect(validateEventPayload(name, payload).ok).toBe(true);
      if (name === 'attention.changed') changed.push(payload as { appSessionId: string; items: AttentionItem[] });
      return true;
    }) as AttentionServiceDeps['emit'],
    register: ((name: CommandName, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as AttentionServiceDeps['register'],
    log: () => {},
  });
  const fire = (name: EventName, payload: unknown) => listeners.get(name)?.forEach((l) => l(payload));
  const batch = (...events: SessionEvent[]) => fire('session.eventBatch', { appSessionId: APP, events });
  const last = () => changed.at(-1)?.items ?? [];
  return { service, store, dispatch, handlers, changed, fire, batch, last };
}

describe('attention service merges broker items with the derived kinds', () => {
  it('keeps the broker\'s pending and delivered items, persists the merged list, and emits it whole', async () => {
    const { service, store, fire, last } = setup();
    await service.ready;
    const permission = item({ kind: 'permission', state: 'pending' });
    const question = item({ kind: 'question', state: 'delivered', request: { requestId: 'req-2' as never, toolUseId: 'toolu_2' as never, taskId: null, agentId: null } });
    const plan = item({ kind: 'plan', state: 'confirmed', request: { requestId: 'req-3' as never, toolUseId: 'toolu_3' as never, taskId: null, agentId: null } });
    fire('session.brokerItems', { appSessionId: APP, items: [permission, question, plan] });
    expect(last()).toEqual([permission, question]); // the engine moved past a confirmed item
    await service.settled();
    expect(store.sessions.get(APP)).toEqual([permission, question]);
    expect(await service.list()).toEqual([permission, question]);
  });

  it('a process exit with lost approvals raises one interrupted item with the contract summary; the broker items are gone', async () => {
    const { service, store, fire, batch, last } = setup();
    fire('session.brokerItems', { appSessionId: APP, items: [item({ kind: 'permission', state: 'pending' }), item({ kind: 'permission', state: 'delivered', request: { requestId: 'req-9' as never, toolUseId: 'toolu_9' as never, taskId: null, agentId: null } })] });
    fire('session.brokerItems', { appSessionId: APP, items: [] }); // the broker retires them at the exit, before the exit row
    const exited = event('process.exited', { code: null, signal: 'SIGKILL', reason: 'crash', lostAttentionCount: 2 });
    batch(exited);
    expect(last()).toEqual([
      { id: `${APP}:interrupted:${exited.id}`, appSessionId: APP, sessionId: SID, kind: 'interrupted', request: { requestId: null, toolUseId: null, taskId: null, agentId: null }, summary: 'Session interrupted, 2 approvals lost', createdAt: AT, state: 'pending', stateChangedAt: AT, expiresAt: null },
    ]);
    expect(interruptedSummary(1)).toBe('Session interrupted, 1 approval lost');
    await service.settled();
    expect(store.sessions.get(APP)).toMatchObject([{ kind: 'interrupted', summary: 'Session interrupted, 2 approvals lost' }]);
    batch(event('process.exited', { code: 0, signal: null, reason: 'unknown', lostAttentionCount: 0 }));
    expect(last()).toHaveLength(1); // nothing lost, nothing raised
  });

  it('answers attention.request for a broker item through session.pendingRequest, and null for any other kind without asking', async () => {
    const requested = event('permission.requested', { requestId: 'req-1' });
    const dispatch = vi.fn(async () => ({ ok: true as const, value: { event: requested } }));
    const { handlers, fire, batch } = setup({ dispatch: dispatch as never });
    fire('session.brokerItems', { appSessionId: APP, items: [item({ kind: 'permission', state: 'pending' })] });
    expect(await handlers.get('attention.request')!({ appSessionId: APP, requestId: 'req-1' })).toEqual({ event: requested });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith('engine-host', 'session.pendingRequest', { appSessionId: APP, requestId: 'req-1' });
    batch(event('process.exited', { code: 1, signal: null, reason: 'crash', lostAttentionCount: 1 }));
    expect(await handlers.get('attention.request')!({ appSessionId: APP, requestId: 'req-404' })).toEqual({ event: null });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const failing = setup({ dispatch: vi.fn(async () => ({ ok: false as const, error: { code: 'host_unavailable' as const, message: 'engine-host is crashed' } })) as never });
    failing.fire('session.brokerItems', { appSessionId: APP, items: [item({ kind: 'permission', state: 'pending' })] });
    await expect(failing.handlers.get('attention.request')!({ appSessionId: APP, requestId: 'req-1' })).rejects.toThrow('engine-host is crashed');
  });

  it('derives error, auto_mode_unavailable and held_peer_message items, and retires the first two when the next human turn starts', () => {
    const { fire, batch, last } = setup();
    const failed = event('turn.ended', { isError: true, terminalReason: 'api_error', result: 'error_during_execution', resultText: null, isEchoReceipt: false, origin: 'human', errors: ['overloaded'] });
    const hard = event('turn.ended', { isError: false, terminalReason: 'prompt_too_long', result: 'success', resultText: null, isEchoReceipt: false, origin: 'human', errors: [] });
    const fine = event('turn.ended', { isError: false, terminalReason: 'aborted_streaming', result: 'success', resultText: null, isEchoReceipt: false, origin: 'human', errors: [] });
    const task = event('task.notification', { taskId: 'task-1', toolUseId: null, status: 'failed', summary: 'npm test exited 1', outputFile: null, reason: null });
    const unavailable = event('tool.result', { toolUseId: 'toolu_7', denial: 'automode-unavailable' });
    batch(failed, hard, fine, task, unavailable);
    expect(last().map((i) => [i.kind, i.summary, i.request])).toEqual([
      ['error', 'Turn failed: api_error (overloaded)', { requestId: null, toolUseId: null, taskId: null, agentId: null }],
      ['error', 'Turn failed: prompt_too_long', { requestId: null, toolUseId: null, taskId: null, agentId: null }],
      ['error', 'Background task failed: npm test exited 1', { requestId: null, toolUseId: null, taskId: 'task-1', agentId: null }],
      ['auto_mode_unavailable', 'Auto mode unavailable: switch out of auto mode to continue', { requestId: null, toolUseId: 'toolu_7', taskId: null, agentId: null }],
    ]);
    const held = { messageUuid: 'm-1', from: 'peer', fromName: 'Reviewer', lane: 'team', heldAt: AT, expiresAt: '2026-09-28T10:05:00.000Z' };
    fire('session.status', { appSessionId: APP, status: { engineSessionId: SID, heldPeerMessages: [held] } as unknown as EngineSessionStatus });
    expect(last().at(-1)).toMatchObject({ kind: 'held_peer_message', summary: 'Held message from Reviewer', createdAt: AT, expiresAt: '2026-09-28T10:05:00.000Z' });

    batch(event('turn.started', { userMessageUuid: 'u-2', origin: 'engine' })); // an engine-initiated turn retires nothing
    expect(last()).toHaveLength(5);
    batch(event('turn.started', { userMessageUuid: 'u-3', origin: 'human' }));
    expect(last().map((i) => i.kind)).toEqual(['held_peer_message']);
    fire('session.status', { appSessionId: APP, status: { engineSessionId: SID, heldPeerMessages: [] } as unknown as EngineSessionStatus });
    expect(last()).toEqual([]);
  });

  it('an exit drops the held-message item, and the exited status that follows never re-derives it (M5 review)', () => {
    const { fire, batch, last } = setup();
    const held = { messageUuid: 'm-1', from: 'peer', fromName: null, lane: 'team', heldAt: AT, expiresAt: '2026-09-28T10:05:00.000Z' };
    fire('session.status', { appSessionId: APP, status: { process: 'ready', engineSessionId: SID, heldPeerMessages: [held] } as unknown as EngineSessionStatus });
    expect(last().map((i) => i.kind)).toEqual(['held_peer_message']);
    batch(event('process.exited', { code: 1, signal: null, reason: 'crash', lostAttentionCount: 0 }));
    expect(last()).toEqual([]);
    fire('session.status', { appSessionId: APP, status: { process: 'exited', engineSessionId: SID, heldPeerMessages: [held] } as unknown as EngineSessionStatus });
    expect(last()).toEqual([]);
  });

  it('a stop retires the error items before raising its own losses; an archive retires the session from the store', async () => {
    const { service, store, batch, last, changed } = setup();
    batch(event('turn.ended', { isError: true, terminalReason: 'model_error', result: 'x', resultText: null, isEchoReceipt: false, origin: 'human', errors: [] }));
    batch(event('process.exited', { code: 0, signal: null, reason: 'stop', lostAttentionCount: 1 }));
    expect(last().map((i) => i.kind)).toEqual(['interrupted']);
    batch(event('process.exited', { code: 0, signal: null, reason: 'archive', lostAttentionCount: 3 }));
    expect(changed.at(-1)).toEqual({ appSessionId: APP, items: [] });
    await service.settled();
    expect(store.retired).toEqual([APP]);
    expect(await service.list()).toEqual([]);
  });

  it('on start, keeps the persisted derived items and drops broker items whose processes died with the previous run', async () => {
    const interrupted = item({ kind: 'interrupted', state: 'pending', id: `${APP}:interrupted:e1` as never, summary: 'Session interrupted, 1 approval lost', request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
    const stale = item({ kind: 'permission', state: 'pending' });
    const other = item({ kind: 'error', state: 'pending', appSessionId: 'app-b' as never, id: 'app-b:error:e2' as never, request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
    const store = new FakeStore([interrupted, stale, other]);
    const { service, handlers } = setup({ store });
    await service.ready;
    expect(await handlers.get('attention.list')!(undefined)).toEqual([interrupted, other]);
    await service.settled();
    expect(store.sessions.get(APP)).toEqual([interrupted]);
  });

  // M5 review (Important 2): main starts the host without awaiting the service, so live events can precede the load.
  it('merges persisted derived items with live state at startup: a live retirement wins, an item the live state does not know is kept', async () => {
    const keep = item({ kind: 'interrupted', state: 'pending', id: `${APP}:interrupted:e1` as never, summary: 'Session interrupted, 1 approval lost', request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
    const retiredByTurn = item({ kind: 'error', state: 'pending', appSessionId: 'app-b' as never, id: 'app-b:error:e2' as never, request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
    const archived = item({ kind: 'error', state: 'pending', appSessionId: 'app-c' as never, id: 'app-c:error:e3' as never, request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
    let release!: () => void;
    const store = new FakeStore([keep, retiredByTurn, archived]);
    const list = store.list.bind(store);
    store.list = async () => {
      await new Promise<void>((r) => (release = r));
      return list();
    };
    const { service, fire, handlers } = setup({ store });
    const permission = item({ kind: 'permission', state: 'pending' });
    fire('session.brokerItems', { appSessionId: APP, items: [permission] }); // live before the load
    fire('session.eventBatch', { appSessionId: 'app-b', events: [event('turn.started', { userMessageUuid: 'u', origin: 'human' })] });
    fire('session.forgotten', { appSessionId: 'app-c' });
    release();
    await service.ready;
    expect(await handlers.get('attention.list')!(undefined)).toEqual([permission, keep]);
    await service.settled();
    expect(store.sessions.get(APP)).toEqual([permission, keep]);
    expect(store.sessions.get('app-b') ?? []).toEqual([]); // the persisted error was retired by this run's human turn
    expect(store.sessions.has('app-c')).toBe(false);
  });

  // M5 review (Important 4)
  it('session.forgotten (an archive, live or exited) retires the whole session', async () => {
    const { service, store, fire, batch, changed } = setup();
    batch(event('process.exited', { code: 0, signal: null, reason: 'crash', lostAttentionCount: 2 }));
    expect(changed.at(-1)!.items).toHaveLength(1);
    fire('session.forgotten', { appSessionId: APP });
    expect(changed.at(-1)).toEqual({ appSessionId: APP, items: [] });
    await service.settled();
    expect(store.retired).toEqual([APP]);
    expect(service.list()).toEqual([]);
  });
});

// M5 review (Important 5): nothing is treated as saved that was not.
describe('attention service persistence failures', () => {
  afterEach(() => vi.useRealTimers());

  class FlakyStore extends FakeStore {
    failures = 1;
    override async replaceForSession(id: AppSessionId, items: AttentionItem[]) {
      if (this.failures > 0) {
        this.failures -= 1;
        throw new Error('EIO: attention.json not written');
      }
      return super.replaceForSession(id, items);
    }
  }

  it('a failed write rejects settled(), keeps serving the list, and is retried with the next change', async () => {
    const store = new FlakyStore();
    const { service, fire, handlers, last } = setup({ store });
    const first = item({ kind: 'permission', state: 'pending' });
    fire('session.brokerItems', { appSessionId: APP, items: [first] });
    await expect(service.settled()).rejects.toThrow('EIO: attention.json not written');
    expect(await handlers.get('attention.list')!(undefined)).toEqual([first]);
    expect(last()).toEqual([first]);
    const second = item({ kind: 'permission', state: 'delivered', request: { requestId: 'req-2' as never, toolUseId: 'toolu_2' as never, taskId: null, agentId: null } });
    fire('session.brokerItems', { appSessionId: APP, items: [first, second] });
    await expect(service.settled()).resolves.toBeUndefined();
    expect(store.sessions.get(APP)).toEqual([first, second]);
    service.stop();
  });

  it('a failed write is retried after 5 s with no further change', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = new FlakyStore();
    const { service, fire } = setup({ store });
    const first = item({ kind: 'permission', state: 'pending' });
    fire('session.brokerItems', { appSessionId: APP, items: [first] });
    await expect(service.settled()).rejects.toThrow('EIO');
    expect(store.sessions.get(APP)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(store.sessions.get(APP)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await expect(service.settled()).resolves.toBeUndefined();
    expect(store.sessions.get(APP)).toEqual([first]);
    service.stop();
  });

  // M5 re-review: a transient load failure must not let a live write replace persisted items nobody read.
  it('a failed load is retried at once and then every 5 s; nothing is written before a load succeeds, then the merge runs and writes resume', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const persisted = item({ kind: 'interrupted', state: 'pending', id: `${APP}:interrupted:e1` as never, summary: 'Session interrupted, 1 approval lost', request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
    const store = new FakeStore([persisted]);
    const list = store.list.bind(store);
    let failures = 2; // the first attempt and the immediate retry
    const attempts = vi.fn(async () => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('EBUSY: attention.json');
      }
      return list();
    });
    store.list = attempts;
    const { service, fire, handlers, last } = setup({ store });
    const permission = item({ kind: 'permission', state: 'pending' });
    fire('session.brokerItems', { appSessionId: APP, items: [permission] });
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toHaveBeenCalledTimes(2);
    await expect(service.settled()).rejects.toThrow('EBUSY');
    expect(store.replaced).toEqual([]); // the persisted list is untouched
    expect(await handlers.get('attention.list')!(undefined)).toEqual([permission]); // the live list still serves
    expect(last()).toEqual([permission]);
    await vi.advanceTimersByTimeAsync(4_998);
    expect(attempts).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2);
    expect(attempts).toHaveBeenCalledTimes(3);
    await service.ready;
    await expect(service.settled()).resolves.toBeUndefined();
    expect(last()).toEqual([permission, persisted]);
    expect(store.sessions.get(APP)).toEqual([permission, persisted]);
    service.stop();
  });

  it('a load that fails once succeeds on the immediate retry', async () => {
    const store = new FakeStore([]);
    const list = store.list.bind(store);
    let failures = 1;
    store.list = vi.fn(async () => {
      if (failures-- > 0) throw new Error('EAGAIN');
      return list();
    });
    const { service, fire } = setup({ store });
    fire('session.brokerItems', { appSessionId: APP, items: [item({ kind: 'permission', state: 'pending' })] });
    await service.ready;
    await expect(service.settled()).resolves.toBeUndefined();
    expect(store.list).toHaveBeenCalledTimes(2);
    expect(store.sessions.get(APP)).toHaveLength(1);
    service.stop();
  });
});
