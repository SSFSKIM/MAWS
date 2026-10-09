import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttentionItemSchema, type AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { CommandName, EventName, HostState } from '@shared/ipc/schema';
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
  // each event a moment after the last, as a session's own are (a turn retires only what was raised before it)
  return { id: `${APP}:L:${seq}:0`, sessionId: SID, at: new Date(Date.parse(AT) + seq).toISOString(), seq, agentId: null, parentToolUseId: null, kind, ...payload } as unknown as SessionEvent;
}

function setup(opts: { store?: FakeStore; dispatch?: AttentionServiceDeps['dispatch'] } = {}) {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const states = new Set<(state: HostState) => void>();
  const changed: { appSessionId: string; items: AttentionItem[] }[] = [];
  const store = opts.store ?? new FakeStore();
  const dispatch = opts.dispatch ?? vi.fn(async () => ({ ok: true as const, value: { event: null } }));
  const service = startAttentionService({
    onEvent: ((name: EventName, listener: (payload: unknown) => void) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
      return () => {};
    }) as AttentionServiceDeps['onEvent'],
    onState: (_owner: string, listener: (state: HostState) => void) => { states.add(listener); return () => { states.delete(listener); }; },
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
  return { service, store, dispatch, handlers, changed, fire, batch, last, hostState: (state: HostState['state']) => states.forEach((listener) => listener({ state, pid: null, restarts: 1, revision: 2 })) };
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
      { id: `${APP}:interrupted:${exited.id}`, appSessionId: APP, sessionId: SID, kind: 'interrupted', request: { requestId: null, toolUseId: null, taskId: null, agentId: null }, summary: 'Session interrupted, 2 approvals lost', createdAt: exited.at, state: 'pending', stateChangedAt: exited.at, expiresAt: null },
    ]);
    expect(interruptedSummary(1)).toBe('Session interrupted, 1 approval lost');
    // E1 M5 fix: the blocking `maws` asks among the lost are questions
    expect(interruptedSummary(0, 1)).toBe('Session interrupted, 1 question lost');
    expect(interruptedSummary(1, 2)).toBe('Session interrupted, 1 approval and 2 questions lost');
    await service.settled();
    expect(store.sessions.get(APP)).toMatchObject([{ kind: 'interrupted', summary: 'Session interrupted, 2 approvals lost' }]);
    batch(event('process.exited', { code: 0, signal: null, reason: 'unknown', lostAttentionCount: 0 }));
    expect(last()).toHaveLength(1); // nothing lost, nothing raised
  });

  it('a process exit that lost a blocking ask raises the interrupted item naming it a question (E1 M5 fix)', () => {
    const { batch, last } = setup();
    batch(event('process.exited', { code: null, signal: 'SIGTERM', reason: 'stop', lostAttentionCount: 1, lostAskCount: 1 }));
    expect(last()).toMatchObject([{ kind: 'interrupted', summary: 'Session interrupted, 1 question lost' }]);
  });

  it('retires broker and held-message attention on host loss without erasing durable errors', async () => {
    const h = setup();
    await h.service.ready;
    const permission = item({ kind: 'permission', state: 'pending' });
    h.fire('session.brokerItems', { appSessionId: APP, items: [permission] });
    h.fire('session.status', { appSessionId: APP, status: { process: 'ready', engineSessionId: SID, heldPeerMessages: [{ from: 'peer', lane: 'main', messageUuid: 'message', heldAt: AT, expiresAt: null }] } });
    h.batch(event('turn.ended', { isError: true, result: 'error', errors: [] }));
    expect(h.service.list().map((i) => i.kind)).toEqual(['permission', 'held_peer_message', 'error']);
    h.hostState('crashed'); // the supervisor cannot synthesize engine session exits
    expect(h.service.list().map((i) => i.kind)).toEqual(['error']);
    expect(h.last().map((i) => i.kind)).toEqual(['error']);
    await h.service.settled();
    expect(h.store.sessions.get(APP)?.map((i) => i.kind)).toEqual(['error']);
    h.hostState('ready');
    expect(await h.handlers.get('attention.request')!({ appSessionId: APP, requestId: 'req-1' })).toEqual({ event: null });
    expect(h.dispatch).not.toHaveBeenCalled();
    h.fire('session.brokerItems', { appSessionId: APP, items: [permission] });
    expect(h.service.list().map((i) => i.kind)).toEqual(['permission', 'error']);
    h.service.stop();
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
    // a user abort is not a failure, and the wire marks every abort is_error: true (3.8's aborted_streaming; pass3/plan-outcomes seq 510 aborted_tools)
    const fine = event('turn.ended', { isError: true, terminalReason: 'aborted_streaming', result: 'error_during_execution', resultText: null, isEchoReceipt: false, origin: 'human', errors: [] });
    const aborted = event('turn.ended', { isError: true, terminalReason: 'aborted_tools', result: 'error_during_execution', resultText: null, isEchoReceipt: false, origin: 'human', errors: [] });
    const task = event('task.notification', { taskId: 'task-1', toolUseId: null, status: 'failed', summary: 'npm test exited 1', outputFile: null, reason: null });
    const unavailable = event('tool.result', { toolUseId: 'toolu_7', denial: 'automode-unavailable' });
    batch(failed, hard, fine, aborted, task, unavailable);
    expect(last().map((i) => [i.kind, i.summary, i.request])).toEqual([
      ['error', 'The turn ended with an error (overloaded)', { requestId: null, toolUseId: null, taskId: null, agentId: null }],
      ['error', 'The turn ended with an error (the conversation is too long for the model)', { requestId: null, toolUseId: null, taskId: null, agentId: null }],
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

  // E11 F2b (plan 2.4)
  describe('error attention: words, a terminal turn retires it, seen and dismissed', () => {
    const failedTurn = (over: Record<string, unknown> = {}) => event('turn.ended', { isError: true, terminalReason: null, result: 'error_during_execution', resultText: null, isEchoReceipt: false, origin: 'human', errors: [], ...over });

    it('translates the engine’s subtypes and terminal reasons into words', () => {
      const { batch, last } = setup();
      batch(
        failedTurn(),
        failedTurn({ result: 'error_max_turns' }),
        failedTurn({ result: 'error_max_budget_usd' }),
        failedTurn({ result: 'success', isError: false, terminalReason: 'budget_exhausted' }),
        failedTurn({ terminalReason: 'api_error', errors: ['overloaded'] }),
      );
      expect(last().map((i) => i.summary)).toEqual(['The turn ended with an error', 'Stopped at the turn limit', 'Stopped at the budget', 'Stopped at the budget', 'The turn ended with an error (overloaded)']);
    });

    it('a failed background task’s summary is its preview (plan 2.6): no owner marks', () => {
      const { batch, last } = setup();
      batch(event('task.notification', { taskId: 'task-9', toolUseId: null, status: 'failed', summary: '<to-human>\n<essential>npm test exited 1</essential>\n</to-human>', outputFile: null, reason: null }));
      expect(last().map((i) => i.summary)).toEqual(['Background task failed: npm test exited 1']);
    });

    it('a human prompt read from the transcript on disk (origin null, backfill.ts) retires it; engine, peer and task-notification turns do not', () => {
      const { batch, last } = setup();
      batch(failedTurn());
      for (const origin of ['engine', 'peer', 'task-notification']) batch(event('turn.started', { userMessageUuid: null, origin }));
      expect(last().map((i) => i.kind)).toEqual(['error']);
      batch(event('turn.started', { userMessageUuid: 'u-disk', origin: null }));
      expect(last()).toEqual([]);
    });

    it('seen moves it out of Needs you (confirmed), Dismiss retires it; neither goes back, both persist, a later failure alerts anew', async () => {
      const { service, store, handlers, batch, last } = setup();
      const acknowledge = handlers.get('attention.acknowledge')!;
      batch(failedTurn());
      const [error] = last();
      await acknowledge({ appSessionId: APP, attentionId: error!.id, how: 'seen' });
      expect(last()).toEqual([expect.objectContaining({ id: error!.id, state: 'confirmed' })]);
      await acknowledge({ appSessionId: APP, attentionId: error!.id, how: 'dismissed' });
      expect(last()).toEqual([expect.objectContaining({ id: error!.id, state: 'retired' })]);
      await acknowledge({ appSessionId: APP, attentionId: error!.id, how: 'seen' }); // never back from dismissed
      expect(last()[0]!.state).toBe('retired');
      await service.settled();
      expect(store.sessions.get(APP)).toEqual([expect.objectContaining({ id: error!.id, state: 'retired' })]);
      batch(failedTurn({ result: 'error_max_turns' }));
      expect(last().map((i) => [i.summary, i.state])).toEqual([['The turn ended with an error', 'retired'], ['Stopped at the turn limit', 'pending']]);
    });

    it('acknowledges only error items: a request, an interruption and an unknown id are left as they are', async () => {
      const { fire, handlers, batch, last } = setup();
      fire('session.brokerItems', { appSessionId: APP, items: [item({ kind: 'permission', state: 'pending' })] });
      batch(event('process.exited', { code: 1, signal: null, reason: 'crash', lostAttentionCount: 1 }));
      const before = last();
      for (const target of before) await handlers.get('attention.acknowledge')!({ appSessionId: APP, attentionId: target.id, how: 'dismissed' });
      await handlers.get('attention.acknowledge')!({ appSessionId: APP, attentionId: `${APP}:error:nope`, how: 'dismissed' });
      expect(last()).toEqual(before);
    });

    it('an acknowledged error stays acknowledged when the transcript replays the same failure, before or after the load', async () => {
      const failure = failedTurn();
      const id = `${APP}:error:${failure.id}`;
      const persisted = item({ kind: 'error', state: 'confirmed', id: id as never, summary: 'The turn ended with an error', request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
      const after = setup({ store: new FakeStore([persisted]) });
      await after.service.ready;
      after.batch(failure);
      expect(after.last().map((i) => [i.id, i.state])).toEqual([[id, 'confirmed']]);

      let release!: () => void;
      const store = new FakeStore([persisted]);
      const list = store.list.bind(store);
      store.list = async () => {
        await new Promise<void>((r) => (release = r));
        return list();
      };
      const before = setup({ store });
      before.batch(failure); // derived pending while the load is outstanding
      release();
      await before.service.ready;
      expect(before.last().map((i) => [i.id, i.state])).toEqual([[id, 'confirmed']]);
    });

    // F2b review 1: a fresh follower's backfill replays every old prompt as a null-origin turn.started, each carrying its
    // record's timestamp; only a turn newer than the failure is the next human turn.
    it('a backfill replaying the failed turn’s own turn.started keeps the acknowledged error (before or after the load); a newer human turn retires it', async () => {
      const PROMPT_AT = '2026-09-28T09:59:00.000Z';
      const FAILED_AT = '2026-09-28T09:59:30.000Z';
      for (const how of ['confirmed', 'retired'] as const) {
        const prompt = event('turn.started', { userMessageUuid: 'u-old', origin: null, at: PROMPT_AT, seq: null }); // backfilled: no journal row
        const failure = failedTurn({ at: FAILED_AT, seq: null });
        const id = `${APP}:error:${failure.id}`;
        const persisted = item({ kind: 'error', state: how, id: id as never, createdAt: FAILED_AT, stateChangedAt: AT, summary: 'The turn ended with an error', request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });

        const after = setup({ store: new FakeStore([persisted]) });
        await after.service.ready;
        after.batch(prompt, failure);
        expect(after.last().map((i) => [i.id, i.state])).toEqual([[id, how]]);

        let release!: () => void;
        const store = new FakeStore([persisted]);
        const list = store.list.bind(store);
        store.list = async () => {
          await new Promise<void>((r) => (release = r));
          return list();
        };
        const before = setup({ store });
        before.batch(prompt, failure); // replayed while the load is outstanding
        release();
        await before.service.ready;
        expect(before.last().map((i) => [i.id, i.state])).toEqual([[id, how]]);
        await before.service.settled();
        expect(store.sessions.get(APP)?.map((i) => [i.id, i.state])).toEqual([[id, how]]);

        before.batch(event('turn.started', { userMessageUuid: 'u-new', origin: null, at: '2026-09-28T10:01:00.000Z', seq: null }));
        expect(before.last()).toEqual([]);
      }
    });

    // F2b review residue: a live event's `at` is its journal row's ms, which a queued prompt right after a failed result
    // can share (queue-and-interrupt.jsonl rows 197 and 201 are 2 ms apart; one stdout chunk's rows share one), so live
    // turns retire by stream order.
    it('a live human turn in the same millisecond as the failure still retires it', () => {
      const { batch, last } = setup();
      batch(failedTurn({ at: AT, seq: 197 }));
      expect(last().map((i) => i.kind)).toEqual(['error']);
      batch(event('turn.started', { userMessageUuid: 'u-queued', origin: 'human', at: AT, seq: 201 }));
      expect(last()).toEqual([]);
    });

    it('rewrites a persisted item’s raw "Turn failed: <code>" summary in words on load', async () => {
      const legacy = (code: string, n: number) => item({ kind: 'error', state: 'pending', id: `${APP}:error:legacy-${n}` as never, summary: `Turn failed: ${code}`, request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
      const { service, handlers } = setup({ store: new FakeStore([legacy('error_during_execution', 1), legacy('error_max_turns', 2), legacy('api_error (overloaded)', 3)]) });
      await service.ready;
      expect(((await handlers.get('attention.list')!(undefined)) as AttentionItem[]).map((i) => i.summary)).toEqual(['The turn ended with an error', 'Stopped at the turn limit', 'The turn ended with an error (overloaded)']);
    });
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

  // C12: a release under the memory budget is not an attention event (D-18, §5.7): nothing is raised, whatever the
  // session held before (a released session held no request, so it lost none)
  it('a budget exit raises nothing and keeps what the session already had', () => {
    const { batch, last, changed } = setup();
    batch(event('turn.ended', { isError: true, terminalReason: 'model_error', result: 'x', resultText: null, isEchoReceipt: false, origin: 'human', errors: [] }));
    const before = last();
    batch(event('process.exited', { code: 0, signal: null, reason: 'budget', lostAttentionCount: 0, budget: { limitKiB: 8_388_608, totalKiB: 9_100_000 } }));
    expect(last()).toEqual(before);
    expect(changed.at(-1)?.items.some((i) => i.kind === 'interrupted')).toBe(false);
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
