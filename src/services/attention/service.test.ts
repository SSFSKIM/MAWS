import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttentionItemSchema, type AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { CommandName, EventName, HostState } from '@shared/ipc/schema';
import { validateEventPayload } from '@shared/ipc/validate';
import { interruptedSummary, PERSIST_RETRY_MS, startAttentionService, type AttentionServiceDeps } from './service';
import type { AttentionStore } from './store';
import { laneAAttention } from '../lane-a/attention';
import type { LaneAView } from '../lane-a/driver';

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

function setup(opts: { store?: FakeStore; dispatch?: AttentionServiceDeps['dispatch']; log?: (message: string) => void; seenAt?: AttentionServiceDeps['seenAt']; handingOver?: AttentionServiceDeps['handingOver'] } = {}) {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const handlers = new Map<string, (input: unknown) => unknown>();
  const states = new Set<(state: HostState) => void>();
  const changed: { appSessionId: string; items: AttentionItem[]; silent?: string[] }[] = [];
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
      if (name === 'attention.changed') changed.push(payload as { appSessionId: string; items: AttentionItem[]; silent?: string[] });
      return true;
    }) as AttentionServiceDeps['emit'],
    register: ((name: CommandName, handler: (input: unknown) => unknown) => void handlers.set(name, handler)) as AttentionServiceDeps['register'],
    log: opts.log ?? (() => {}),
    ...(opts.seenAt && { seenAt: opts.seenAt }),
    ...(opts.handingOver && { handingOver: opts.handingOver }),
  });
  const fire = (name: EventName, payload: unknown) => listeners.get(name)?.forEach((l) => l(payload));
  const batch = (...events: SessionEvent[]) => fire('session.eventBatch', { appSessionId: APP, events });
  const last = () => changed.at(-1)?.items ?? [];
  return { service, store, dispatch, handlers, changed, fire, batch, last, hostState: (state: HostState['state']) => states.forEach((listener) => listener({ state, pid: null, restarts: 1, revision: 2 })) };
}

describe('attention service merges broker items with the derived kinds', () => {
  it('keeps the broker\'s waiting items, persists the merged list, and emits it whole', async () => {
    const { service, store, fire, last } = setup();
    await service.ready;
    const permission = item({ kind: 'permission', state: 'pending' });
    const question = item({ kind: 'question', state: 'delivered', request: { requestId: 'req-2' as never, toolUseId: 'toolu_2' as never, taskId: null, agentId: null } });
    const plan = item({ kind: 'plan', state: 'confirmed', request: { requestId: 'req-3' as never, toolUseId: 'toolu_3' as never, taskId: null, agentId: null } });
    fire('session.brokerItems', { appSessionId: APP, items: [permission, question, plan] });
    expect(last()).toEqual([permission]); // UC-1: an answered (delivered) item waits nowhere; the engine moved past a confirmed one
    await service.settled();
    expect(store.sessions.get(APP)).toEqual([permission]);
    expect(await service.list()).toEqual([permission]);
  });

  // UC-1 (A17, §B): the publisher keeps only what waits, so no answered request reaches any window, machine or the store
  it('sends, persists and lists a broker list of a pending and a delivered item as the pending one alone', async () => {
    const { service, store, fire, last, handlers } = setup();
    await service.ready;
    const permission = item({ kind: 'permission', state: 'pending' });
    const answered = item({ kind: 'permission', state: 'delivered', request: { requestId: 'req-2' as never, toolUseId: 'toolu_2' as never, taskId: null, agentId: null } });
    fire('session.brokerItems', { appSessionId: APP, items: [permission, answered] });
    expect(last()).toEqual([permission]);
    await service.settled();
    expect(store.sessions.get(APP)).toEqual([permission]);
    expect(await handlers.get('attention.list')!(undefined)).toEqual([permission]);
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

  // O16 panel 1 (scalpel-2#1): a live handover leaves ready with its sessions alive under their session hosts; the
  // successor adopts them with their pending requests under the same ids. Their items stay, so the notification raised
  // for a still-pending permission is neither closed nor lost; a crash or a deliberate restart clears them as before.
  it('keeps broker and held-message attention while the engine host hands its sessions over; a crash after it clears them', async () => {
    const handover = { draining: false };
    const h = setup({ handingOver: () => handover.draining });
    await h.service.ready;
    const permission = item({ kind: 'permission', state: 'pending' });
    h.fire('session.brokerItems', { appSessionId: APP, items: [permission] });
    h.fire('session.status', { appSessionId: APP, status: { process: 'ready', engineSessionId: SID, heldPeerMessages: [{ from: 'peer', lane: 'main', messageUuid: 'message', heldAt: AT, expiresAt: null }] } });
    const changes = h.changed.length;
    handover.draining = true;
    h.hostState('restarting'); // the handover's ask: the link leaves ready and drains
    expect(h.service.list().map((i) => i.kind)).toEqual(['permission', 'held_peer_message']);
    expect(h.changed).toHaveLength(changes); // nothing told: no notification closes
    handover.draining = false;
    h.hostState('ready'); // the successor, its adoptions republishing what they restored
    h.fire('session.brokerItems', { appSessionId: APP, items: [permission] });
    expect(h.service.list().map((i) => i.kind)).toEqual(['permission', 'held_peer_message']);
    h.hostState('restarting'); // a crash: no handover under way
    expect(h.service.list()).toEqual([]);
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
    const unavailable = event('tool.result', { toolUseId: 'toolu_7', denial: 'automode-unavailable' });
    batch(failed, hard, fine, aborted, unavailable);
    expect(last().map((i) => [i.kind, i.summary, i.request])).toEqual([
      ['error', 'The turn ended with an error (overloaded)', { requestId: null, toolUseId: null, taskId: null, agentId: null }],
      ['error', 'The turn ended with an error (the conversation is too long for the model)', { requestId: null, toolUseId: null, taskId: null, agentId: null }],
      ['auto_mode_unavailable', 'Auto mode unavailable: switch out of auto mode to continue', { requestId: null, toolUseId: 'toolu_7', taskId: null, agentId: null }],
    ]);
    const held = { messageUuid: 'm-1', from: 'peer', fromName: 'Reviewer', lane: 'team', heldAt: AT, expiresAt: '2026-09-28T10:05:00.000Z' };
    fire('session.status', { appSessionId: APP, status: { engineSessionId: SID, heldPeerMessages: [held] } as unknown as EngineSessionStatus });
    expect(last().at(-1)).toMatchObject({ kind: 'held_peer_message', summary: 'Held message from Reviewer', createdAt: AT, expiresAt: '2026-09-28T10:05:00.000Z' });

    batch(event('turn.started', { userMessageUuid: 'u-2', origin: 'engine' })); // an engine-initiated turn retires nothing
    expect(last()).toHaveLength(4);
    batch(event('turn.started', { userMessageUuid: 'u-3', origin: 'human' }));
    expect(last().map((i) => i.kind)).toEqual(['held_peer_message']);
    fire('session.status', { appSessionId: APP, status: { engineSessionId: SID, heldPeerMessages: [] } as unknown as EngineSessionStatus });
    expect(last()).toEqual([]);
  });

  // UX wave U3, O-34 (the U3a document, Acceptance 5): a failed task raises nothing, whether it ran in the background or in
  // the foreground; its line in the transcript says it (O-28), and a foreground command's own tool row already does.
  it('a failed task notification derives no item, of a background task or a foreground one; a failed turn, an API error and auto mode unavailable derive theirs as before', () => {
    const { service, batch } = setup();
    batch(
      event('task.started', { taskId: 'task-bg', toolUseId: 'toolu_bg', taskType: 'local_bash', description: 'npm test', isBackground: true, workflowName: null }),
      event('task.notification', { taskId: 'task-bg', toolUseId: 'toolu_bg', status: 'failed', summary: 'Background command "npm test" failed with exit code 1', outputFile: '/tmp/uxw/task-bg.output', reason: null }),
      event('task.started', { taskId: 'task-fg', toolUseId: 'toolu_fg', taskType: 'local_bash', description: 'make build', isBackground: false, workflowName: null }),
      event('task.notification', { taskId: 'task-fg', toolUseId: 'toolu_fg', status: 'failed', summary: 'make build', outputFile: null, reason: null }),
    );
    expect(service.list()).toEqual([]);
    batch(
      event('turn.ended', { isError: true, terminalReason: null, result: 'error_during_execution', resultText: null, isEchoReceipt: false, origin: 'human', errors: [] }),
      event('turn.ended', { isError: true, terminalReason: 'api_error', result: 'success', resultText: 'API Error: 529 Overloaded', isEchoReceipt: false, origin: 'human', errors: [] }),
      event('tool.result', { toolUseId: 'toolu_7', denial: 'automode-unavailable' }),
    );
    expect(service.list().map((i) => [i.kind, i.summary])).toEqual([
      ['error', 'The turn ended with an error'],
      ['error', 'API Error: 529 Overloaded'],
      ['auto_mode_unavailable', 'Auto mode unavailable: switch out of auto mode to continue'],
    ]);
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

    it('a human prompt read from the transcript on disk (origin null, backfill.ts) retires it; engine, peer and task-notification turns do not', () => {
      const { batch, last } = setup();
      batch(failedTurn());
      for (const origin of ['engine', 'peer', 'task-notification']) batch(event('turn.started', { userMessageUuid: null, origin }));
      expect(last().map((i) => i.kind)).toEqual(['error']);
      batch(event('turn.started', { userMessageUuid: 'u-disk', origin: null }));
      expect(last()).toEqual([]);
    });

    it('seen (the composer\u2019s dwell) or Dismiss retires it; it never comes back, the retirement persists, a later failure alerts anew', async () => {
      const { service, store, handlers, batch, last } = setup();
      const acknowledge = handlers.get('attention.acknowledge')!;
      for (const how of ['seen', 'dismissed'] as const) {
        batch(failedTurn());
        const error = last().at(-1)!;
        await acknowledge({ appSessionId: APP, attentionId: error.id, how });
        expect(last().at(-1)).toEqual(expect.objectContaining({ id: error.id, state: 'retired' }));
        await acknowledge({ appSessionId: APP, attentionId: error.id, how: how === 'seen' ? 'dismissed' : 'seen' }); // never back
        expect(last().at(-1)!.state).toBe('retired');
      }
      await service.settled();
      expect(store.sessions.get(APP)?.map((i) => i.state)).toEqual(['retired', 'retired']);
      batch(failedTurn({ result: 'error_max_turns' }));
      expect(last().map((i) => [i.summary, i.state])).toEqual([['The turn ended with an error', 'retired'], ['The turn ended with an error', 'retired'], ['Stopped at the turn limit', 'pending']]);
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
      expect(after.last().map((i) => [i.id, i.state])).toEqual([[id, 'retired']]); // a seen error persisted before the ruling loads retired

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
      expect(before.last().map((i) => [i.id, i.state])).toEqual([[id, 'retired']]);
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
        expect(after.last().map((i) => [i.id, i.state])).toEqual([[id, 'retired']]); // a confirmed one (seen before the ruling) loads retired

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
        expect(before.last().map((i) => [i.id, i.state])).toEqual([[id, 'retired']]);
        await before.service.settled();
        expect(store.sessions.get(APP)?.map((i) => [i.id, i.state])).toEqual([[id, 'retired']]);

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

  // The owner's ruling (2026-10-30): an error is raised only when it is newer than the last time the session was seen in
  // MAWS; seeing the session or dismissing the item retires it for good; an API error reads in the engine's own words.
  describe('an error is raised only if unseen, and reads as what happened', () => {
    const PROMPT_AT = '2026-10-01T08:59:58.000Z';
    const FAILED_AT = '2026-10-01T09:00:00.000Z';
    const SEEN_AT = Date.parse('2026-10-29T12:00:00.000Z');
    const OVERLOADED = 'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.';
    const envelope = (text: string, over: Record<string, unknown> = {}) =>
      event('assistant.block.complete', { messageUuid: 'm-err', apiMessageId: 'm-err', blockIndex: 0, block: { type: 'text', text }, model: '<synthetic>', supersedes: [], aborted: false, userMessageUuids: [], isApiErrorMessage: true, error: 'server_error', ...over });
    // An old turn read back from the transcript on disk (backfill.ts): the prompt, the engine's API error envelope, and
    // the turn_duration's turn.ended (no terminal reason, no errors on disk).
    const diskTurn = () => [
      event('turn.started', { userMessageUuid: 'u-old', origin: null, at: PROMPT_AT, seq: null }),
      envelope(OVERLOADED, { at: FAILED_AT, seq: null }),
      event('turn.ended', { isError: true, terminalReason: null, result: 'error_during_execution', resultText: null, isEchoReceipt: false, origin: null, errors: [], at: FAILED_AT, seq: null }),
    ];
    // The same failure live: the envelope, then the result naming it (pass2/auto-unrouted seq 11-12).
    const liveTurn = (text: string, withEnvelope = true) => [
      event('turn.started', { userMessageUuid: 'u-live', origin: 'human' }),
      ...(withEnvelope ? [envelope(text)] : []),
      event('turn.ended', { isError: true, terminalReason: 'api_error', result: 'success', resultText: text, isEchoReceipt: false, origin: 'human', errors: [] }),
    ];

    it('an old error the session was seen after raises nothing', () => {
      const { service, batch } = setup({ seenAt: () => SEEN_AT });
      batch(...diskTurn());
      expect(service.list()).toEqual([]);
    });

    it('a session never seen in MAWS (or seen before the error) tells once, in the API error’s own words; a replay raises no second item', () => {
      for (const seenAt of [() => null, () => Date.parse(PROMPT_AT)]) {
        const { service, batch } = setup({ seenAt });
        const turn = diskTurn();
        batch(...turn);
        batch(...turn);
        expect(service.list().map((i) => [i.kind, i.state, i.summary, i.createdAt])).toEqual([['error', 'pending', OVERLOADED, FAILED_AT]]);
      }
    });

    it('seeing the session retires it, and it never comes back: not on a replay, not after a restart, not from a store that lost it', async () => {
      let seen: number | null = null;
      const first = setup({ seenAt: () => seen });
      const turn = diskTurn();
      first.batch(...turn);
      first.service.seen(APP, Date.parse(PROMPT_AT)); // a look before the failure leaves it
      expect(first.service.list().map((i) => i.state)).toEqual(['pending']);
      seen = SEEN_AT;
      first.service.seen(APP, SEEN_AT);
      expect(first.last().map((i) => i.state)).toEqual(['retired']);
      first.batch(...turn);
      expect(first.service.list().map((i) => i.state)).toEqual(['retired']);
      await first.service.settled();

      const restarted = setup({ store: new FakeStore(first.store.sessions.get(APP)), seenAt: () => seen });
      await restarted.service.ready;
      restarted.batch(...turn);
      expect(restarted.service.list().map((i) => i.state)).toEqual(['retired']);

      const lost = setup({ seenAt: () => seen });
      await lost.service.ready;
      lost.batch(...turn);
      expect(lost.service.list()).toEqual([]);
    });

    it('dismissing retires it for good while the session stays unseen: a replay and a restart leave it retired', async () => {
      const first = setup({ seenAt: () => null });
      const turn = diskTurn();
      first.batch(...turn);
      await first.handlers.get('attention.acknowledge')!({ appSessionId: APP, attentionId: first.last()[0]!.id, how: 'dismissed' });
      first.batch(...turn);
      expect(first.service.list().map((i) => i.state)).toEqual(['retired']);
      await first.service.settled();
      const restarted = setup({ store: new FakeStore(first.store.sessions.get(APP)), seenAt: () => null });
      await restarted.service.ready;
      restarted.batch(...turn);
      expect(restarted.service.list().map((i) => i.state)).toEqual(['retired']);
    });

    it('an unseen error persisted by an earlier run loads retired once the session has been seen since', async () => {
      const id = `${APP}:error:old` as never;
      const persisted = item({ kind: 'error', state: 'pending', id, createdAt: FAILED_AT, summary: 'The turn ended with an error', request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
      const seen = setup({ store: new FakeStore([persisted]), seenAt: () => SEEN_AT });
      await seen.service.ready;
      expect(seen.service.list().map((i) => i.state)).toEqual(['retired']);
      const unseen = setup({ store: new FakeStore([persisted]), seenAt: () => Date.parse(PROMPT_AT) });
      await unseen.service.ready;
      expect(unseen.service.list().map((i) => i.state)).toEqual(['pending']);
    });

    it('an unseen error an earlier build stored in the generic words takes the API error’s once the transcript replays it; a retired one keeps its words', async () => {
      const turn = diskTurn();
      const id = `${APP}:error:${turn[2]!.id}` as never;
      for (const state of ['pending', 'retired'] as const) {
        const persisted = item({ kind: 'error', state, id, createdAt: FAILED_AT, stateChangedAt: FAILED_AT, summary: 'The turn ended with an error', request: { requestId: null, toolUseId: null, taskId: null, agentId: null } });
        const { service, store, batch } = setup({ store: new FakeStore([persisted]), seenAt: () => Date.parse(PROMPT_AT) });
        await service.ready;
        batch(...turn);
        const words = state === 'pending' ? OVERLOADED : 'The turn ended with an error';
        expect(service.list().map((i) => [i.id, i.state, i.summary, i.createdAt, i.stateChangedAt])).toEqual([[id, state, words, FAILED_AT, FAILED_AT]]);
        await service.settled();
        expect(store.sessions.get(APP)?.map((i) => [i.state, i.summary])).toEqual([[state, words]]);
      }
    });

    it('a live API error raises the item while no client shows the session, and nothing while one does', () => {
      let showing = false;
      const { service, batch } = setup({ seenAt: () => (showing ? Infinity : Date.parse(AT) - 60_000) });
      const limited = 'API Error: Request rejected (429) · This request would exceed your account’s rate limit. Please try again later.';
      batch(...liveTurn(limited));
      expect(service.list().map((i) => [i.state, i.summary])).toEqual([['pending', limited]]);
      showing = true;
      batch(...liveTurn(OVERLOADED)); // its human turn retires the first; the second arrives under the reader's eyes
      expect(service.list()).toEqual([]);
    });

    it('names the API error from the result when no envelope was read, and only the main conversation’s envelope counts', () => {
      const { service, batch } = setup();
      batch(...liveTurn('Login expired · Please run /login', false));
      expect(service.list().map((i) => i.summary)).toEqual(['Login expired · Please run /login']);
      const child = setup();
      child.batch(event('turn.started', { userMessageUuid: 'u-c', origin: 'human' }), envelope('API Error: child', { parentToolUseId: 'toolu_agent' }), event('turn.ended', { isError: true, terminalReason: 'max_turns', result: 'error_max_turns', resultText: null, isEchoReceipt: false, origin: 'human', errors: [] }));
      expect(child.service.list().map((i) => i.summary)).toEqual(['Stopped at the turn limit']);
    });

    it('a reply after the envelope (the engine recovered within the turn) leaves the generic words to the turn’s own failure', () => {
      const { service, batch } = setup();
      batch(
        event('turn.started', { userMessageUuid: 'u-r', origin: 'human' }),
        envelope(OVERLOADED),
        event('assistant.block.complete', { messageUuid: 'm-ok', apiMessageId: 'm-ok', blockIndex: 0, block: { type: 'text', text: 'Recovered.' }, model: 'claude', supersedes: [], aborted: false, userMessageUuids: [] }),
        event('turn.ended', { isError: true, terminalReason: null, result: 'error_max_turns', resultText: null, isEchoReceipt: false, origin: 'human', errors: [] }),
      );
      expect(service.list().map((i) => i.summary)).toEqual(['Stopped at the turn limit']);
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
    expect(changed.at(-1)).toEqual({ appSessionId: APP, items: [], silent: [] });
    await service.settled();
    expect(store.retired).toEqual([APP]);
    expect(await service.list()).toEqual([]);
  });

  // C12: a release under the memory budget is not an attention event (D-18, §5.7): nothing is raised, whatever the
  // session held before (a released session held no request, so it lost none)
  // UX wave U8b M6 (X-168): a session read from disk now ends with the follower's exit (reason unknown, `seq` null)
  // whether or not its last turn ended, so the case below runs for sessions that ended long ago. It raises nothing: the
  // same history with and without the supplied exit gives the same list, and nothing new is emitted for the exit.
  it('the exit a follower supplies to a session read from disk raises nothing', () => {
    const disk = (kind: string, payload: Record<string, unknown>, at: string) => ({ ...event(kind, payload), seq: null, at }) as SessionEvent;
    const history = [
      disk('turn.started', { userMessageUuid: 'u-1', origin: null }, '2026-09-01T09:00:00.000Z'),
      disk('turn.ended', { isError: false, terminalReason: null, result: 'success', resultText: null, isEchoReceipt: false, origin: null, errors: [] }, '2026-09-01T09:00:05.000Z'),
      disk('turn.started', { userMessageUuid: 'u-2', origin: null }, '2026-09-01T09:00:10.000Z'),
      disk('turn.ended', { isError: true, terminalReason: null, result: 'error_during_execution', resultText: null, isEchoReceipt: false, origin: null, errors: ['overloaded'] }, '2026-09-01T09:00:15.000Z'),
      disk('task.notification', { taskId: 'task-old', toolUseId: null, status: 'completed', summary: 'done', outputFile: null, reason: null }, '2026-09-01T09:01:00.000Z'),
    ];
    const exit = disk('process.exited', { code: null, signal: null, reason: 'unknown', lostAttentionCount: 0, budget: null }, '2026-09-01T09:01:00.000Z');
    const without = setup();
    without.batch(...history);
    const withExit = setup();
    withExit.batch(...history);
    const emitted = withExit.changed.length;
    withExit.batch(exit);
    expect(withExit.last().map((i) => i.kind)).toEqual(['error']); // the history's own failed turn, as before: not the exit's
    expect(withExit.last()).toEqual(without.last());
    expect(withExit.changed.length).toBe(emitted); // the list did not change, so nothing was emitted or persisted
    withExit.batch(...history, exit); // a second read of the same history
    expect(withExit.last()).toEqual(without.last());
  });

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
    expect(changed.at(-1)).toEqual({ appSessionId: APP, items: [], silent: [] });
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
    const second = item({ kind: 'permission', state: 'pending', request: { requestId: 'req-2' as never, toolUseId: 'toolu_2' as never, taskId: null, agentId: null } });
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

  // P5 O3-C M5's task review: a root stops attention and then closes the store in one synchronous pass, so a write still
  // queued at the stop would reach a closed store, and its retry outlive the service.
  it('a stop writes what it still owes before the store can close, and queues nothing after', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const store = new FakeStore();
    const { service, fire } = setup({ store });
    await service.ready;
    const first = item({ kind: 'permission', state: 'pending' });
    fire('session.brokerItems', { appSessionId: APP, items: [first] }); // owed; its queued write has not run
    expect(store.replaced).toEqual([]);
    service.stop();
    expect(store.sessions.get(APP)).toEqual([first]); // written inside the stop
    await vi.advanceTimersByTimeAsync(3 * PERSIST_RETRY_MS);
    expect(store.replaced).toEqual([[APP, [first]]]); // once: the queued write found the service stopped
  });

  it('a write that fails after the stop is not retried', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const logged: string[] = [];
    const store = new FakeStore();
    const { service, fire } = setup({ store, log: (message) => void logged.push(message) });
    await service.ready;
    let fail!: (error: Error) => void;
    const attempts = vi.fn(() => new Promise<void>((_, reject) => (fail = reject)));
    store.replaceForSession = attempts;
    fire('session.brokerItems', { appSessionId: APP, items: [item({ kind: 'permission', state: 'pending' })] });
    await vi.waitFor(() => expect(attempts).toHaveBeenCalledOnce()); // in flight
    service.stop();
    fail(new Error('database is not open'));
    await vi.advanceTimersByTimeAsync(3 * PERSIST_RETRY_MS);
    expect(attempts).toHaveBeenCalledOnce();
    expect(logged).toEqual(['not persisted (stopped): database is not open']);
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

// P2-C start (2026-10-09; the P2-C document, Design §5): the owner channel's items are a third list, projected from the
// marks table, which is their truth: the service never restores them from its own store, and a projection may be silent.
describe('the owner channel projects its items as a third list (P2-C)', () => {
  const anchor = { messageUuid: '44444444-4444-4444-8444-444444444444', blockIndex: 0, span: 0 };
  const ownerItem = (kind: 'async_input' | 'essential_unread', span = 0): AttentionItem =>
    AttentionItemSchema.parse({
      id: `${APP}:${kind}:${APP}:${anchor.messageUuid}:0:${kind === 'async_input' ? 'q' : 'e'}${span}`, appSessionId: APP, sessionId: SID, kind,
      request: { requestId: null, toolUseId: null, taskId: null, agentId: null }, summary: kind === 'async_input' ? 'Question — Which backend?' : 'Must read — The key rotates',
      createdAt: AT, state: 'pending', stateChangedAt: AT, expiresAt: null, anchor: { ...anchor, span },
    });

  it('merges them after the broker and derived items, persists the whole list, and marks the silent ids restored before the change is emitted', async () => {
    const { service, store, fire, batch, changed, last } = setup();
    await service.ready;
    const permission = item({ kind: 'permission', state: 'pending' });
    fire('session.brokerItems', { appSessionId: APP, items: [permission] });
    const restoredAtEmit: boolean[] = [];
    const question = ownerItem('async_input');
    const essential = ownerItem('essential_unread');
    const before = changed.length;
    service.setOwnerItems(APP, [question, essential], [essential.id]);
    restoredAtEmit.push(service.restoredIds.has(essential.id), service.restoredIds.has(question.id));
    expect(changed.length).toBe(before + 1);
    expect(last()).toEqual([permission, question, essential]);
    expect(restoredAtEmit).toEqual([true, false]);
    expect(changed.at(-1)!.silent).toEqual([essential.id]); // P5 O3-D M1 (D13): the restored marks travel on the event
    // a human turn retires neither kind, nor does a stop
    batch(event('turn.started', { userMessageUuid: null, origin: 'human' }));
    expect(last()).toEqual([permission, question, essential]);
    await service.settled();
    expect(store.sessions.get(APP)).toEqual([permission, question, essential]);
    service.setOwnerItems(APP, [essential], []);
    expect(last()).toEqual([permission, essential]);
    service.stop();
  });

  // P5 O3-D M1 (D13): an accepted persisted item is restored, and every change that carries it says so in `silent`, the
  // retirement of a session's list included (an empty one)
  it('fills silent on every change with the restored ids among its items', async () => {
    const persisted = item({ kind: 'error', state: 'pending' });
    const { service, fire, changed } = setup({ store: new FakeStore([persisted]) });
    await service.ready;
    expect(changed.at(-1)).toEqual({ appSessionId: APP, items: [persisted], silent: [persisted.id] });
    const permission = item({ kind: 'permission', state: 'pending' });
    fire('session.brokerItems', { appSessionId: APP, items: [permission] });
    expect(changed.at(-1)).toEqual({ appSessionId: APP, items: [permission, persisted], silent: [persisted.id] });
    fire('session.brokerItems', { appSessionId: APP, items: [] });
    service.setOwnerItems(APP, [], []);
    expect(changed.at(-1)!.silent).toEqual([persisted.id]);
    service.stop();
  });

  it('skips the two kinds at load: the marks table re-projects them', async () => {
    const persisted = [ownerItem('async_input'), item({ kind: 'error', state: 'pending' })];
    const { service, last } = setup({ store: new FakeStore(persisted) });
    await service.ready;
    expect(last()).toEqual([persisted[1]]);
    expect(service.restoredIds.has(persisted[0]!.id)).toBe(false);
    service.stop();
  });

  it('an archive retires them with the rest; the archived projection (empty) changes nothing, and an unarchive\'s brings them back', async () => {
    const { service, fire, last, changed } = setup();
    await service.ready;
    service.setOwnerItems(APP, [ownerItem('async_input')], []);
    fire('session.forgotten', { appSessionId: APP });
    expect(last()).toEqual([]);
    const count = changed.length;
    service.setOwnerItems(APP, [], []); // the owner channel projects nothing for an archived session
    expect(changed.length).toBe(count);
    expect(service.list()).toEqual([]);
    // F-AB (scale review B sweep#1): unarchived, its owner items are live again (they are a projection, never restored)
    const question = ownerItem('async_input');
    service.setOwnerItems(APP, [question], [question.id]);
    expect(last()).toEqual([question]);
    expect(service.list()).toEqual([question]);
    service.stop();
  });
});
// P2-C end

// P5 O9 M6: a local terminal session's requests, a fourth list from the spine's lane A driver (src/services/lane-a/attention.ts)
describe('lane A items', () => {
  const laneA = (request: string): { item: AttentionItem; request: SessionEvent } => ({
    item: AttentionItemSchema.parse({
      id: `lane-a:${SID}:${request}`, appSessionId: APP, sessionId: SID, kind: 'permission', request: { requestId: request, toolUseId: request, taskId: null, agentId: null },
      summary: 'Bash: ls', createdAt: AT, state: 'pending', stateChangedAt: AT, expiresAt: null,
    }),
    request: { id: `lane-a:${request}`, sessionId: SID, at: AT, seq: null, agentId: null, parentToolUseId: null, kind: 'permission.requested', requestId: request, toolUseId: request, toolName: 'Bash', displayName: null, input: { command: 'ls' }, description: null, decisionReasonType: null, suggestions: [], blockedPath: null } as unknown as SessionEvent,
  });

  it('merges them last, answers attention.request from their own views without asking the host, and leaves them past a host restart', async () => {
    const { service, fire, last, handlers, dispatch, hostState } = setup();
    await service.ready;
    const permission = item({ kind: 'permission', state: 'pending' });
    fire('session.brokerItems', { appSessionId: APP, items: [permission] });
    const a = laneA('toolu_a');
    service.setLaneAItems(APP, [a]);
    expect(last()).toEqual([permission, a.item]);
    expect(await handlers.get('attention.request')!({ appSessionId: APP, requestId: 'toolu_a' })).toEqual({ event: a.request });
    expect(dispatch).not.toHaveBeenCalled();
    hostState('crashed'); // the engine host holds none of them
    expect(last()).toEqual([a.item]);
    service.setLaneAItems(APP, []);
    expect(last()).toEqual([]);
    expect(await handlers.get('attention.request')!({ appSessionId: APP, requestId: 'toolu_a' })).toEqual({ event: null });
    service.stop();
  });

  // UC-1 (U1a's §B): with the bridge's settlement held back, the session's machine stops listing a request at the moment
  // the answer was taken (the holder told by its endpoint's `laneA.accepted`), though the bridge still lists it
  it('carries no request the holder was told was taken, in attention.changed or attention.list, while the bridge still lists it', async () => {
    const { service, last, handlers } = setup();
    await service.ready;
    const holder = laneAAttention({ set: (appId, entries) => service.setLaneAItems(appId, entries) });
    const raised = { request: 'toolu_a', session: SID, tool: 'Bash', input: { command: 'echo made-up' }, t: Date.parse(AT) };
    const view = { state: { appSessionId: APP, engineSessionId: SID, bridge: 'live', reason: null, launch: 'l1', sminos: '1.47.0', ops: [], reads: [], controls: {}, turn: { running: true, unknown: false }, model: null, effort: null, override: null, mode: null, catalog: null, pending: [raised], settled: [], deliveries: [] }, fresh: true, tool: null } as LaneAView;
    holder.update(APP, view);
    expect(last().map((i) => i.request.requestId)).toEqual(['toolu_a']);
    holder.accepted(APP, 'toolu_a');
    holder.update(APP, view); // the bridge has not settled it
    expect(last()).toEqual([]);
    expect(await handlers.get('attention.list')!(undefined)).toEqual([]);
    holder.stop();
    service.stop();
  });

  it('skips them at load: the bridge re-raises what is still pending', async () => {
    const a = laneA('toolu_a');
    const { service, last } = setup({ store: new FakeStore([a.item]) });
    await service.ready;
    expect(last()).toEqual([]);
    service.stop();
  });
});
