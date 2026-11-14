// The take-back (UX wave U4a, docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, decision 13; Acceptance 6, the
// take-back's suite): against the draft store itself (src/services/index/drafts.ts, the real `DraftStore` over its
// table in memory) behind a scripted queue, never a bridge that accepts by itself. The queue answers as the engine host
// does: `session.steer.cancel` answers `cancelled` once and `already_started` for any uuid it no longer holds, and
// `session.queue.remove` of an entry it no longer lists is rejected; each withdrawal it takes is a row of the record.
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendContent } from '@shared/engine/session-state-store';
import type { PromptHistoryEvent } from '@shared/graph/events';
import type { AppSessionId, MessageUuid } from '@shared/graph/ids';
import type { CommandResult, MawsBridge } from '@shared/ipc/schema';
import { DRAFT_CLAIM, settles, STAGED_DRAFT_WORDS, STALE_DRAFT_WORDS, type Draft } from '@shared/ipc/schema/session';
import { Db } from '../../../../services/index/db';
import { DraftStore } from '../../../../services/index/drafts';
import { addressOf } from '@shared/machine/address';
import { remoteRow } from '../../../../../test/support/builders';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../../test/support/machine';
import { heardReaderRows, readerRowsOf, resetReaderRows } from '../../lane-b/reader-rows';
import { resetRemoteLaneBStore } from '../../lane-b/remote-session';
import { useMachines } from '../../stores/machines';
import { useSessions } from '../../stores/sessions';
import { resetRemoteDrafts } from '../editor/drafts';
import { fakeClient } from '../../../../../test/support/fake-client';
import type { QueueControls } from '../../session/controls/types';
import { resetComposerStore, useComposerStore } from '../../stores/composer';
import { useHosts } from '../../stores/hosts';
import { resetQueueStore, useQueueStore, type SessionQueue } from '../../stores/queue';
import { daemonStatus, hostStatus } from '../../test-support/host-status';
import { preloadOf } from '../../test-support/preload-of';
import { attachmentsOf, type ComposerDoc } from '../editor/doc';
import { draftOf } from '../editor/drafts';
import { STACK_WORDS } from './stack';
import { deleteRefusal, refusalsNow, takeBackRefusal } from './stack-acts';
import { attachTakeBackBox, carryForward, readRecord, resetTakeBack, retryTakeBackLoad, SETTLE_RETRY_MS, stageMark, storeRefusesStage, TAKE_BACK_WORDS, takeBack, takingBack, WITHDRAW_WAIT_MS, type TakeBackBox, type TakeBackDeps } from './take-back';

const APP = 'app-take' as AppSessionId;
const U1 = '11111111-1111-4111-8111-111111111111' as MessageUuid;
const U2 = '22222222-2222-4222-8222-222222222222' as MessageUuid;
const SINCE = '2026-09-29T10:00:00.000Z';
const TEXT = 'make the header sticky';

// ---- the store, the record and the queue ------------------------------------------------------------------------------

type Pending = { resolve: () => void };
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

function world(over: { history?: () => { events: PromptHistoryEvent[]; complete: boolean } } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE sessions (app_id TEXT PRIMARY KEY);
CREATE TABLE drafts (app_session_id TEXT PRIMARY KEY REFERENCES sessions(app_id) ON DELETE CASCADE, doc TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);`);
  sqlite.prepare('INSERT INTO sessions (app_id) VALUES (?)').run(APP);
  const store = new DraftStore(new Db(sqlite, []));
  const log: string[] = [];
  const events: PromptHistoryEvent[] = [];
  const row = (action: string, queueId: string | null, messageUuid: MessageUuid | null) =>
    events.push({ kind: 'queue.transition', action, queueId, messageUuid, reason: null } as unknown as PromptHistoryEvent);
  // the next draft save waits here, and lands when let go
  const heldSets: Pending[] = [];
  let holdSets = 0;
  const steers = new Set<MessageUuid>();
  const entries = new Set<string>();
  let holdWithdrawals = false; // a withdrawal's answer never comes
  let claimAnswer: string | null = null; // the claim answered with these words instead of by the store
  let settlesFailing = 0; // the next settling saves fail (the services do not answer)
  let readsFailing: false | 'timeout' | 'not-offered' = false; // a read of what is kept fails, or is not offered

  const invoke = async (name: string, input: Record<string, unknown>) => {
    if (name === 'session.drafts.set') {
      const { draft, replaces } = input as { draft: Draft | null; replaces?: string | null };
      log.push(replaces === DRAFT_CLAIM ? 'claim' : replaces?.startsWith(settles('')) ? 'settle' : 'save');
      if (holdSets > 0) {
        holdSets -= 1;
        const gate = deferred();
        heldSets.push(gate);
        await gate.promise;
      }
      if (replaces === DRAFT_CLAIM && claimAnswer !== null) return { ok: false, error: { code: 'internal', message: claimAnswer } };
      if (replaces?.startsWith(settles('')) && settlesFailing > 0) {
        settlesFailing -= 1;
        return { ok: false, error: { code: 'timeout', message: 'the services did not answer' } };
      }
      try {
        store.set(APP, draft, 'owner', replaces);
        return { ok: true, value: undefined };
      } catch (error) {
        return { ok: false, error: { code: 'internal', message: (error as Error).message } };
      }
    }
    if (name === 'session.drafts.get') {
      log.push('read');
      if (readsFailing === 'not-offered') return { ok: false, error: { code: 'internal', message: 'refused', issues: { refusal: 'not-offered' } } };
      return readsFailing ? { ok: false, error: { code: 'timeout', message: 'the services did not answer' } } : { ok: true, value: store.get(APP) };
    }
    if (name === 'session.promptHistory') {
      log.push('record');
      return { ok: true, value: over.history?.() ?? { events: [...events], complete: true } };
    }
    throw new Error(`unscripted ${name}`);
  };
  const fake = fakeClient();
  const client = { ...fake.client, localMachine: TEST_MACHINE, invoke: vi.fn(invoke) } as unknown as MawsBridge;

  const never = new Promise<never>(() => {});
  const real = {
    cancelSteer: async ({ messageUuid }: { messageUuid: MessageUuid }): Promise<CommandResult<'session.steer.cancel'>> => {
      log.push('cancel');
      if (holdWithdrawals) return never;
      if (!steers.delete(messageUuid)) return { ok: true, value: { outcome: 'already_started' } };
      row('cancel', null, messageUuid);
      return { ok: true, value: { outcome: 'cancelled' } };
    },
    remove: async ({ queueId }: { queueId: string }): Promise<CommandResult<'session.queue.remove'>> => {
      log.push('remove');
      if (holdWithdrawals) return never;
      if (!entries.delete(queueId)) return { ok: false, error: { code: 'invalid_input', message: `no queued entry ${queueId}` } };
      row('remove', queueId, null);
      return { ok: true, value: undefined };
    },
  };
  const controls = {
    cancelSteer: vi.fn(real.cancelSteer),
    remove: vi.fn(real.remove),
    promote: vi.fn(),
    hold: vi.fn(),
    edit: vi.fn(),
    setPaused: vi.fn(),
    sendNow: vi.fn(),
  };
  const deps: TakeBackDeps = { client, controls: () => controls as unknown as QueueControls };

  return {
    store,
    log,
    events,
    row,
    deps,
    controls,
    real,
    steers,
    entries,
    holdNextSets: (count = 1) => void (holdSets += count),
    heldCount: () => heldSets.length,
    letGo: async () => {
      heldSets.shift()!.resolve();
      await settleAll();
    },
    holdWithdrawals: (on: boolean) => void (holdWithdrawals = on),
    answerClaim: (words: string | null) => void (claimAnswer = words),
    failSettles: (count: number) => void (settlesFailing = count),
    failReads: (on: boolean | 'not-offered') => void (readsFailing = on === true ? 'timeout' : on),
    /** The engine host's queue as the window's store lists it. */
    listed(queue: Partial<SessionQueue> = {}) {
      const steersNow = [...steers].map((messageUuid) => ({ messageUuid, content: TEXT, createdAt: SINCE }));
      useQueueStore.setState((s) => ({
        bySession: new Map(s.bySession).set(APP, { entries: [...entries].map((queueId) => entry(queueId)), paused: false, pauseReason: null, steers: steersNow, withdrawn: [], loaded: true, ...queue }),
      }));
    },
  };
}

const entry = (queueId: string) => ({ queueId, appSessionId: APP, content: TEXT, createdAt: SINCE, state: 'queued' as const, messageUuid: null, submittedAt: null, uncertain: false, steer: false });
const settleAll = () => new Promise((resolve) => setImmediate(resolve)); // not a timer: the settle's own may be faked

// ---- the box ----------------------------------------------------------------------------------------------------------

function box(free = true) {
  const state = { free, loaded: [] as ComposerDoc[], replaced: [] as (ComposerDoc | null)[], held: [] as boolean[], later: [] as string[], taken: [] as (() => void)[], settled: 0 };
  const api: TakeBackBox = {
    load: (doc) => (state.free ? (state.loaded.push(doc), true) : false),
    replace: (doc) => void state.replaced.push(doc),
    hold: (on) => void state.held.push(on),
    settleLater: (replaces, taken) => {
      state.later.push(replaces);
      state.taken.push(taken);
    },
    settled: () => void (state.settled += 1),
  };
  return { state, api };
}

const textOf = (doc: ComposerDoc | null | undefined): string => JSON.stringify(doc ?? null).match(/"text":"([^"]*)"/)?.[1] ?? '';
const next = (messageUuid: MessageUuid, content: SendContent = TEXT) => ({ kind: 'next' as const, key: messageUuid, messageUuid, content, createdAt: SINCE, answer: false });
const after = (queueId: string, content: SendContent = TEXT) => ({ kind: 'after' as const, key: queueId, queueId, content, createdAt: SINCE, answer: false });
const held = (queueId: string) => ({ kind: 'held' as const, key: queueId, queueId, content: TEXT, createdAt: SINCE, answer: false });
const stageOf = (ref: MessageUuid, at = '2026-09-29T10:01:00.000Z') =>
  draftOf({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: TEXT }] }], attrs: { takeBack: { ref, kind: 'steer', since: SINCE } } }, at, { whole: true })!;
const notice = () => useComposerStore.getState().stackNotices.get(APP)?.text ?? null;
/** A send that has just cleared the slot: the store keeps a tombstone. */
const sentAndCleared = (w: ReturnType<typeof world>) => {
  w.store.set(APP, draftOf({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'an earlier message' }] }] }, '2026-09-29T09:00:00.000Z'));
  w.store.set(APP, null);
};

beforeEach(() => {
  useHosts.setState({ supervisor: hostStatus() }); // this Mac's services: a daemon of this build
  window.maws = preloadOf(fakeClient());
  resetComposerStore();
  resetQueueStore();
});
afterEach(() => {
  resetTakeBack();
  delete (window as { maws?: unknown }).maws;
  vi.useRealTimers();
});

describe('a take-back in order', () => {
  it('a next-step message after a send: the claim, the withdrawal, the load, the settling save; the draft is the box’s', async () => {
    const w = world();
    sentAndCleared(w);
    w.steers.add(U1);
    const b = box();
    attachTakeBackBox(APP, b.api);
    await takeBack(APP, next(U1), w.deps);
    expect(w.log).toEqual(['claim', 'cancel', 'settle']);
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(stageMark({ doc: b.state.loaded[0], attachments: [], updatedAt: '' })).toBeNull(); // loaded without the mark
    expect(b.state.held).toEqual([false, true, false]); // attached free, read-only while in hand
    const kept = w.store.get(APP)!;
    expect(stageMark(kept)).toBeNull();
    expect(textOf(kept.doc as ComposerDoc)).toBe(TEXT);
    expect(w.steers.size).toBe(0); // in the queue not at all
    expect(w.controls.sendNow).not.toHaveBeenCalled();
  });

  it('a box attached while a take-back of its session is in hand is held, and one attached for another session is not', async () => {
    const w = world();
    w.steers.add(U1);
    attachTakeBackBox(APP, box().api);
    w.holdNextSets();
    const run = takeBack(APP, next(U1), w.deps);
    await vi.waitFor(() => expect(w.heldCount()).toBe(1));
    const remounted = box();
    attachTakeBackBox(APP, remounted.api);
    const other = box();
    attachTakeBackBox('app-other' as AppSessionId, other.api);
    expect(remounted.state.held).toEqual([true]);
    expect(other.state.held).toEqual([false]);
    await w.letGo();
    await run;
    expect(remounted.state.held).toEqual([true, false]);
  });

  it('a held message is removed in the second place', async () => {
    const w = world();
    w.entries.add('q-1');
    const b = box();
    attachTakeBackBox(APP, b.api);
    await takeBack(APP, held('q-1'), w.deps);
    expect(w.log).toEqual(['claim', 'remove', 'settle']);
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(w.entries.size).toBe(0);
  });

  it('(i) a second take-back while one is in hand does nothing', async () => {
    const w = world();
    w.steers.add(U1);
    w.entries.add('q-1');
    attachTakeBackBox(APP, box().api);
    w.holdNextSets();
    const first = takeBack(APP, next(U1), w.deps);
    await vi.waitFor(() => expect(w.heldCount()).toBe(1));
    expect(takingBack(APP)).toBe(true);
    await takeBack(APP, after('q-1'), w.deps);
    await carryForward(APP, stageOf(U1), w.deps);
    expect(w.log).toEqual(['claim']);
    await w.letGo();
    await first;
    expect(w.log).toEqual(['claim', 'cancel', 'settle']);
    expect(w.entries.has('q-1')).toBe(true);
  });
});

describe('(c) a claim that is not taken withdraws nothing and the row stays', () => {
  it('a draft with a document is kept', async () => {
    const w = world();
    w.store.set(APP, draftOf({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'half a thought' }] }] }, '2026-09-29T09:00:00.000Z'));
    w.steers.add(U1);
    const b = box();
    attachTakeBackBox(APP, b.api);
    await takeBack(APP, next(U1), w.deps);
    expect(w.log).toEqual(['claim']);
    expect(notice()).toBe(TAKE_BACK_WORDS.draftKept);
    expect(w.steers.has(U1)).toBe(true);
    expect(b.state.loaded).toEqual([]);
    expect(textOf(w.store.get(APP)!.doc as ComposerDoc)).toBe('half a thought');
  });

  it('the save fails', async () => {
    const w = world();
    w.answerClaim('the services did not answer');
    w.entries.add('q-1');
    attachTakeBackBox(APP, box().api);
    await takeBack(APP, after('q-1'), w.deps);
    expect(w.log).toEqual(['claim']);
    expect(notice()).toBe(TAKE_BACK_WORDS.notKept);
    expect(w.entries.has('q-1')).toBe(true);
  });

  it('(h) a store of an earlier build answers the claim as stale: the sentence, then Edit and ↑ refused for that machine while Delete is not', async () => {
    const w = world();
    w.answerClaim(STALE_DRAFT_WORDS);
    w.steers.add(U1);
    attachTakeBackBox(APP, box().api);
    await takeBack(APP, next(U1), w.deps);
    expect(w.log).toEqual(['claim']);
    expect(w.steers.has(U1)).toBe(true);
    expect(notice()).toBe(TAKE_BACK_WORDS.needsServices);
    expect(storeRefusesStage(APP)).toBe(TAKE_BACK_WORDS.needsServices);
    const refusals = refusalsNow(APP);
    expect(takeBackRefusal(refusals, after('q-1'))).toBe(TAKE_BACK_WORDS.needsServices);
    expect(takeBackRefusal(refusals, next(U1))).toBe(TAKE_BACK_WORDS.needsServices);
    expect(deleteRefusal(refusals, after('q-1'))).toBeNull();
    expect(deleteRefusal(refusals, next(U1))).toBeNull();
  });

  it('(h) the refusal ends when this Mac’s services restart: a take-back then works without a reload', async () => {
    const w = world();
    w.answerClaim(STALE_DRAFT_WORDS);
    w.steers.add(U1);
    const b = box();
    attachTakeBackBox(APP, b.api);
    await takeBack(APP, next(U1), w.deps);
    expect(storeRefusesStage(APP)).toBe(TAKE_BACK_WORDS.needsServices);
    useHosts.setState({ supervisor: hostStatus({ daemon: daemonStatus({ pid: 4242, startedAt: '2026-11-13T12:00:00.000Z' }) }) }); // a new mawsd
    expect(storeRefusesStage(APP)).toBeNull();
    w.answerClaim(null);
    await takeBack(APP, next(U1), w.deps);
    expect(w.log).toEqual(['claim', 'claim', 'cancel', 'settle']);
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
  });

  it('(h) services this Mac runs in the app (no daemon) are this build’s: a stale answer is said and not remembered', async () => {
    useHosts.setState({ supervisor: hostStatus({ daemon: null }) });
    const w = world();
    w.answerClaim(STALE_DRAFT_WORDS);
    w.steers.add(U1);
    attachTakeBackBox(APP, box().api);
    await takeBack(APP, next(U1), w.deps);
    expect(notice()).toBe(TAKE_BACK_WORDS.needsServices);
    expect(storeRefusesStage(APP)).toBeNull();
  });
});

// decision 13, step 4, to the letter (M3's review, finding 2): the box stays held until a settling save is acknowledged
// or a read of what is kept settles it; tries spent and a failed read are neither
describe('the settle', () => {
  it('a settling save that keeps failing holds the box, hands the form to the writer, and is asked again until taken', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = world();
    w.steers.add(U1);
    const b = box();
    attachTakeBackBox(APP, b.api);
    w.failSettles(5);
    const run = takeBack(APP, next(U1), w.deps);
    await vi.advanceTimersByTimeAsync(SETTLE_RETRY_MS * 8);
    expect(w.log.filter((step) => step === 'settle').length).toBeGreaterThanOrEqual(3);
    expect(b.state.later).toEqual([settles(w.store.get(APP)!.updatedAt)]); // the stage's settle form, to the writer
    expect(b.state.held.at(-1)).toBe(true); // tries spent: still held
    expect(takingBack(APP)).toBe(true);
    expect(stageMark(w.store.get(APP))).not.toBeNull();
    await vi.advanceTimersByTimeAsync(SETTLE_RETRY_MS * 64);
    await run;
    expect(b.state.held.at(-1)).toBe(false);
    expect(stageMark(w.store.get(APP))).toBeNull();
    expect(textOf(w.store.get(APP)!.doc as ComposerDoc)).toBe(TEXT);
    expect(b.state.settled).toBe(1); // the writer no longer names the form
  });

  it('a settle the writer’s own save acknowledged ends the operation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = world();
    w.steers.add(U1);
    const b = box();
    attachTakeBackBox(APP, b.api);
    w.failSettles(1000);
    const run = takeBack(APP, next(U1), w.deps);
    await vi.advanceTimersByTimeAsync(SETTLE_RETRY_MS * 8);
    expect(b.state.taken).toHaveLength(1);
    b.state.taken[0]!(); // the writer's save naming the form was taken
    await vi.advanceTimersByTimeAsync(SETTLE_RETRY_MS * 64);
    await run;
    expect(b.state.held.at(-1)).toBe(false);
    expect(takingBack(APP)).toBe(false);
  });

  it('a stale settle whose read of what is kept fails leaves the hold in place; once the read answers, the box takes what is kept', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = world();
    w.steers.add(U1);
    const b = box();
    attachTakeBackBox(APP, b.api);
    w.holdNextSets(2); // the claim, then the settling save
    const run = takeBack(APP, next(U1), w.deps);
    await vi.waitFor(() => expect(w.heldCount()).toBe(1));
    const stage = (await w.letGo(), w.store.get(APP)!);
    await vi.waitFor(() => expect(w.heldCount()).toBe(1));
    // another mount settles the stage first, with its own words
    const theirs = draftOf({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'their settled words' }] }] }, '2026-09-29T10:09:00.000Z')!;
    w.store.set(APP, theirs, 'owner', settles(stage.updatedAt));
    w.failReads(true);
    await w.letGo(); // this mount's settle lands: stale; its read fails
    await vi.advanceTimersByTimeAsync(SETTLE_RETRY_MS * 4);
    expect(w.log.filter((step) => step === 'read').length).toBeGreaterThanOrEqual(1);
    expect(b.state.held.at(-1)).toBe(true); // a failed read is no answer
    expect(b.state.replaced).toEqual([]);
    expect(takingBack(APP)).toBe(true);
    w.failReads(false);
    await vi.advanceTimersByTimeAsync(SETTLE_RETRY_MS * 64);
    await run;
    expect(b.state.replaced.map(textOf)).toEqual(['their settled words']);
    expect(b.state.held.at(-1)).toBe(false);
  });
});

describe('(a) a withdrawal whose answer never comes: the record decides, and nothing is sent', () => {
  const cases: { name: string; rows: (w: ReturnType<typeof world>) => void; listed?: boolean; box: string | null; kept: string | null; line: string | null }[] = [
    { name: 'a cancel row: the stage is the draft', rows: (w) => w.row('cancel', null, U1), box: TEXT, kept: TEXT, line: null },
    { name: 'a drop row: the stage is the draft', rows: (w) => w.row('drop', null, U1), box: TEXT, kept: TEXT, line: null },
    { name: 'an abandon row: the stage is the draft', rows: (w) => w.row('abandon', null, U1), box: TEXT, kept: TEXT, line: null },
    { name: 'a started lifecycle: the agent has it, the stage is cleared', rows: (w) => w.events.push({ kind: 'command.lifecycle', commandUuid: U1, state: 'started' } as unknown as PromptHistoryEvent), box: null, kept: null, line: STACK_WORDS.readAlready },
    { name: 'none of these and not listed: loaded under the line that it may have been read', rows: () => {}, listed: false, box: TEXT, kept: TEXT, line: TAKE_BACK_WORDS.mayHaveRead },
  ];
  it.each(cases)('$name', async ({ rows, listed, box: inBox, kept, line }) => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = world();
    w.steers.add(U1);
    const b = box();
    attachTakeBackBox(APP, b.api);
    w.holdWithdrawals(true);
    const run = takeBack(APP, next(U1), w.deps);
    await vi.advanceTimersByTimeAsync(0);
    rows(w);
    if (listed === false) w.steers.delete(U1);
    w.listed();
    await vi.advanceTimersByTimeAsync(WITHDRAW_WAIT_MS);
    await run;
    expect(w.log.slice(0, 3)).toEqual(['claim', 'cancel', 'record']);
    expect(b.state.loaded.map(textOf)).toEqual(inBox === null ? [] : [inBox]);
    const stored = w.store.get(APP);
    expect(stored === null ? null : textOf(stored.doc as ComposerDoc)).toBe(kept);
    expect(stageMark(stored)).toBeNull();
    expect(notice()).toBe(line);
    expect(w.controls.sendNow).not.toHaveBeenCalled();
    expect(w.controls.promote).not.toHaveBeenCalled();
  });

  it('a hold row: it goes on under the held entry’s name, and is removed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = world();
    w.steers.add(U1);
    const b = box();
    attachTakeBackBox(APP, b.api);
    w.holdWithdrawals(true);
    const run = takeBack(APP, next(U1), w.deps);
    await vi.advanceTimersByTimeAsync(0);
    w.steers.delete(U1);
    w.entries.add('q-7');
    w.row('hold', 'q-7', U1);
    w.listed();
    w.holdWithdrawals(false);
    await vi.advanceTimersByTimeAsync(WITHDRAW_WAIT_MS);
    await run;
    expect(w.log).toEqual(['claim', 'cancel', 'record', 'remove', 'settle']);
    expect(w.controls.remove).toHaveBeenCalledWith({ queueId: 'q-7' });
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(w.entries.size).toBe(0);
  });

  it('an incomplete record cannot say: loaded under the line', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = world({ history: () => ({ events: [], complete: false }) });
    w.steers.add(U1);
    const b = box();
    attachTakeBackBox(APP, b.api);
    w.holdWithdrawals(true);
    const run = takeBack(APP, next(U1), w.deps);
    await vi.advanceTimersByTimeAsync(WITHDRAW_WAIT_MS);
    await run;
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(notice()).toBe(TAKE_BACK_WORDS.mayHaveRead);
  });
});

describe('the record, read in the order of its rows (decision 13’s table)', () => {
  const t = (action: string, queueId: string | null, messageUuid: MessageUuid | null) => ({ kind: 'queue.transition', action, queueId, messageUuid, reason: null }) as unknown as PromptHistoryEvent;
  const started = (uuid: MessageUuid) => ({ kind: 'command.lifecycle', commandUuid: uuid, state: 'started' }) as unknown as PromptHistoryEvent;
  const steer = { kind: 'steer' as const, ref: U1 };
  const queued = { kind: 'entry' as const, ref: 'q-1' };
  it.each([
    ['nothing', [], steer, { state: 'pending', name: steer }],
    ['a cancel row', [t('cancel', null, U1)], steer, { state: 'gone', name: steer }],
    ['a remove row', [t('remove', 'q-1', null)], queued, { state: 'gone', name: queued }],
    ['a drop row', [t('drop', 'q-1', null)], queued, { state: 'gone', name: queued }],
    ['an abandon row', [t('abandon', null, U1)], steer, { state: 'gone', name: steer }],
    ['a hold row', [t('hold', 'q-9', U1)], steer, { state: 'pending', name: { kind: 'entry', ref: 'q-9' } }],
    ['a promote row', [t('promote', 'q-1', U2)], queued, { state: 'pending', name: { kind: 'steer', ref: U2 } }],
    ['a promote row, then its start', [t('promote', 'q-1', U2), started(U2)], queued, { state: 'read', name: { kind: 'steer', ref: U2 } }],
    ['a promote row, then a revert', [t('promote', 'q-1', U2), t('revert', 'q-1', null)], queued, { state: 'pending', name: queued }],
    ['a release row', [t('release', 'q-1', U2)], queued, { state: 'read', name: queued }],
    ['a release row, then a revert', [t('release', 'q-1', U2), t('revert', 'q-1', null)], queued, { state: 'pending', name: queued }],
    ['a started lifecycle', [started(U1)], steer, { state: 'read', name: steer }],
    ['another message’s rows', [t('cancel', null, U2), t('remove', 'q-2', null), started(U2)], steer, { state: 'pending', name: steer }],
  ] as const)('%s', (_name, events, start, expected) => {
    expect(readRecord(events as unknown as PromptHistoryEvent[], start)).toEqual(expected);
  });
});

describe('(b) a refused load', () => {
  it('leaves the stage stored, says so, and loads once the editor is free', async () => {
    const w = world();
    w.steers.add(U1);
    const b = box(false);
    attachTakeBackBox(APP, b.api);
    await takeBack(APP, next(U1), w.deps);
    expect(w.log).toEqual(['claim', 'cancel']);
    expect(notice()).toBe(TAKE_BACK_WORDS.later);
    expect(stageMark(w.store.get(APP))).toEqual({ ref: U1, kind: 'steer', since: SINCE }); // the stage stays stored
    expect(w.steers.size).toBe(0);
    const holds = b.state.held.length;
    retryTakeBackLoad(APP); // still not free: nothing changes
    expect(b.state.held).toHaveLength(holds);
    expect(w.log).toEqual(['claim', 'cancel']);
    b.state.free = true;
    retryTakeBackLoad(APP);
    await vi.waitFor(() => expect(w.log).toEqual(['claim', 'cancel', 'settle']));
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(stageMark(w.store.get(APP))).toBeNull();
  });
});

describe('(e, f) what meets a stored stage', () => {
  it('(e) a remount that restores a stage whose message is still listed withdraws it and loads it', async () => {
    const w = world();
    w.entries.add('q-1');
    attachTakeBackBox(APP, box(false).api);
    w.holdWithdrawals(true);
    // a window that staged and went away before its withdrawal reached the queue
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const first = takeBack(APP, after('q-1'), w.deps);
    await vi.advanceTimersByTimeAsync(0);
    const stage = w.store.get(APP)!;
    resetTakeBack(); // that window is gone
    void first;
    vi.useRealTimers();
    w.holdWithdrawals(false);
    w.listed();
    const b = box();
    attachTakeBackBox(APP, b.api);
    await carryForward(APP, stage, w.deps);
    expect(w.entries.size).toBe(0);
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(stageMark(w.store.get(APP))).toBeNull();
  });

  it('(f) a pending save of the emptied box that lands after the stage is refused; one that lands before it leaves a slot the claim takes', async () => {
    const w = world();
    w.store.set(APP, draftOf({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'was being typed' }] }] }, '2026-09-29T09:00:00.000Z'));
    // before: the emptied box's save (the local writer names no `replaces`) lands, and the claim takes the slot
    w.store.set(APP, null);
    w.steers.add(U1);
    attachTakeBackBox(APP, box().api);
    w.holdNextSets(2); // the claim, and then the settling save, are held
    const run = takeBack(APP, next(U1), w.deps);
    await vi.waitFor(() => expect(w.heldCount()).toBe(1));
    await w.letGo(); // the claim lands
    await vi.waitFor(() => expect(w.heldCount()).toBe(1)); // the settling save, held
    expect(stageMark(w.store.get(APP))).not.toBeNull();
    // after: a save of the emptied box still pending lands on the stage, and is fenced
    expect(() => w.store.set(APP, null)).toThrow(STAGED_DRAFT_WORDS);
    expect(() => w.store.set(APP, null, 'owner', null)).toThrow(STAGED_DRAFT_WORDS);
    await w.letGo();
    await run;
    expect(textOf(w.store.get(APP)!.doc as ComposerDoc)).toBe(TEXT);
  });
});

describe('(d) two windows carrying one stage', () => {
  // a second window: its own module graph, so its own take-back state and stores, over the same store and queue
  async function windowB() {
    vi.resetModules();
    const takeBackB = await import('./take-back');
    const queueB = await import('../../stores/queue');
    return { ...takeBackB, useQueueStore: queueB.useQueueStore };
  }
  const listIn = (store: typeof useQueueStore, w: ReturnType<typeof world>) =>
    store.setState({ bySession: new Map([[APP, { entries: [...w.entries].map(entry), paused: false, pauseReason: null, steers: [...w.steers].map((messageUuid) => ({ messageUuid, content: TEXT, createdAt: SINCE })), withdrawn: [], loaded: true }]]) });

  it('B mounts between A’s stage and A’s withdrawal: the message ends in the draft once and in the queue not at all', async () => {
    const w = world();
    w.steers.add(U1);
    const a = box();
    attachTakeBackBox(APP, a.api);
    const gate = deferred();
    w.controls.cancelSteer.mockImplementationOnce(async (args) => {
      await gate.promise; // A's withdrawal is on its way
      return w.real.cancelSteer(args);
    });
    const runA = takeBack(APP, next(U1), w.deps);
    await settleAll();
    const B = await windowB();
    listIn(B.useQueueStore, w);
    const b = box();
    B.attachTakeBackBox(APP, b.api);
    await B.carryForward(APP, w.store.get(APP)!, w.deps); // B's restore meets the stage
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    gate.resolve(); // A's withdrawal answers already_started; the record says cancelled
    await runA;
    expect(w.steers.size).toBe(0);
    expect(a.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(a.state.replaced.map(textOf)).toEqual([TEXT]); // A's settle was stale: it took what B settled
    expect(stageMark(w.store.get(APP))).toBeNull();
    expect(textOf(w.store.get(APP)!.doc as ComposerDoc)).toBe(TEXT);
    expect(w.log.filter((step) => step === 'cancel')).toHaveLength(2);
    B.resetTakeBack();
  });

  it('the same with A’s window gone after its withdrawal', async () => {
    const w = world();
    w.steers.add(U1);
    const a = box();
    const detachA = attachTakeBackBox(APP, a.api);
    const gate = deferred();
    w.controls.cancelSteer.mockImplementationOnce(async (args) => {
      const answer = await w.real.cancelSteer(args); // A's withdrawal is taken; its window goes before the answer
      await gate.promise;
      return answer;
    });
    const runA = takeBack(APP, next(U1), w.deps);
    await settleAll();
    detachA();
    const B = await windowB();
    listIn(B.useQueueStore, w);
    const b = box();
    B.attachTakeBackBox(APP, b.api);
    await B.carryForward(APP, w.store.get(APP)!, w.deps);
    gate.resolve();
    await runA;
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(a.state.loaded).toEqual([]);
    expect(w.steers.size).toBe(0);
    expect(textOf(w.store.get(APP)!.doc as ComposerDoc)).toBe(TEXT);
    B.resetTakeBack();
  });

  it('one mount’s settling save held while the other settles and sends: the held mount ends with an empty box, and the message went once', async () => {
    const w = world();
    w.steers.add(U1);
    const a = box();
    attachTakeBackBox(APP, a.api);
    const B = await windowB();
    const b = box();
    // A stages and withdraws; its settling save is held
    const stage = stageOf(U1);
    w.store.set(APP, null);
    w.store.set(APP, stage, 'owner', DRAFT_CLAIM);
    w.holdNextSets(1);
    const runA = carryForward(APP, stage, w.deps);
    await vi.waitFor(() => expect(w.heldCount()).toBe(1));
    expect(w.log).toEqual(['cancel', 'settle']);
    // B restores the stage, carries it forward, settles, and sends: the send clears the draft
    listIn(B.useQueueStore, w);
    B.attachTakeBackBox(APP, b.api);
    await B.carryForward(APP, w.store.get(APP)!, w.deps);
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    const sent = [textOf(b.state.loaded[0])];
    w.store.set(APP, null); // B's send clears the draft
    await w.letGo(); // A's settling save lands: stale
    await runA;
    expect(a.state.replaced).toEqual([null]); // an empty box
    expect(w.store.get(APP)).toBeNull();
    expect(sent).toEqual([TEXT]);
    B.resetTakeBack();
  });
});

describe('(g) a message with an attachment past the draft’s budget', () => {
  const MiB = 1024 * 1024;
  const pdf = Buffer.alloc(6 * MiB, 7).toString('base64');
  const content: SendContent = [{ type: 'text', text: TEXT }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } }] as unknown as SendContent;

  it('the stage holds every byte across an unmount; the next mount shows it whole; the editor’s next save leaves it out, marked so', async () => {
    const w = world();
    w.entries.add('q-1');
    const unmounted = box();
    const detach = attachTakeBackBox(APP, unmounted.api);
    w.controls.remove.mockImplementationOnce(async (args) => {
      const answer = await w.real.remove(args);
      detach(); // the composer unmounts between the withdrawal and the load
      return answer;
    });
    await takeBack(APP, after('q-1', content), w.deps);
    expect(notice()).toBe(TAKE_BACK_WORDS.later);
    const stage = w.store.get(APP)!;
    expect(stageMark(stage)).not.toBeNull();
    expect(attachmentsOf(stage.doc as ComposerDoc).map((a) => a.bytes)).toEqual([6 * MiB]);
    // the next mount restores the stage and carries it forward
    const b = box();
    attachTakeBackBox(APP, b.api);
    await carryForward(APP, stage, w.deps);
    const loaded = b.state.loaded[0];
    expect(attachmentsOf(loaded).map((a) => [a.bytes, a.persisted])).toEqual([[6 * MiB, false]]); // its tile reads "not kept in draft"
    // a word edited, the writer saves: the text is kept, the attachment is not
    const edited: ComposerDoc = { ...loaded, content: [{ type: 'paragraph', content: [{ type: 'text', text: `${TEXT} now` }] }] };
    w.store.set(APP, draftOf(edited, '2026-09-29T10:05:00.000Z'));
    const reopened = w.store.get(APP)!;
    expect(textOf(reopened.doc as ComposerDoc)).toBe(`${TEXT} now`);
    expect(attachmentsOf(reopened.doc as ComposerDoc)).toEqual([]);
  });
});

describe('(j) an entry released while its write is held open, the write then failing', () => {
  it('read after the revert: the release is undone, the message withdrawn under its queue id and loaded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = world();
    w.entries.add('q-1');
    const b = box();
    attachTakeBackBox(APP, b.api);
    w.holdWithdrawals(true);
    const run = takeBack(APP, after('q-1'), w.deps);
    await vi.advanceTimersByTimeAsync(0);
    w.row('release', 'q-1', U2);
    w.row('revert', 'q-1', null); // the frame's write failed: listed again
    w.listed();
    w.holdWithdrawals(false);
    await vi.advanceTimersByTimeAsync(WITHDRAW_WAIT_MS + SETTLE_RETRY_MS); // listed under the same name: asked again after the backoff
    await run;
    expect(w.log).toEqual(['claim', 'remove', 'record', 'remove', 'settle']);
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(w.entries.size).toBe(0);
  });

  it('read before the revert: the stage is cleared, and the row listed again holds the message, in one place', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = world();
    w.entries.add('q-1');
    const b = box();
    attachTakeBackBox(APP, b.api);
    w.holdWithdrawals(true);
    const run = takeBack(APP, after('q-1'), w.deps);
    await vi.advanceTimersByTimeAsync(0);
    w.row('release', 'q-1', U2);
    await vi.advanceTimersByTimeAsync(WITHDRAW_WAIT_MS);
    await run;
    expect(notice()).toBe(STACK_WORDS.readAlready);
    expect(w.store.get(APP)).toBeNull();
    expect(b.state.loaded).toEqual([]);
    w.row('revert', 'q-1', null); // the write then fails: the row is listed again
    expect(w.entries.has('q-1')).toBe(true);
  });
});

// M3's re-review, finding 1: a settle the route no longer takes (the machine's reader rows heard refused) is no settle; the
// box waits until a save is acknowledged or a read says what is kept
describe('the settle of a session on another machine whose route turns refused', () => {
  const R = addressOf(OTHER_MACHINE, 'app-take' as AppSessionId);
  beforeEach(() => {
    resetReaderRows();
    resetRemoteDrafts();
    resetRemoteLaneBStore();
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-11-13T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
    useSessions.setState({ listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-take'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
  });
  afterEach(() => {
    useSessions.setState({ listed: new Map(), listedMachines: new Set() });
    resetReaderRows();
    resetRemoteDrafts();
  });

  it('holds the box while neither a save nor a read is taken, and settles once the stored state can be read and written', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = world();
    w.steers.add(U1);
    const b = box();
    attachTakeBackBox(R, b.api);
    const real = w.real.cancelSteer;
    w.controls.cancelSteer.mockImplementationOnce(async (args) => {
      const answer = await real(args);
      heardReaderRows(R, { ok: false, error: { code: 'internal', message: 'refused', issues: { refusal: 'not-offered' } } }); // the route turns refused
      return answer;
    });
    w.failReads('not-offered');
    const run = takeBack(R, next(U1), w.deps);
    await vi.advanceTimersByTimeAsync(SETTLE_RETRY_MS * 16);
    expect(readerRowsOf(R)).toBe('refused');
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(stageMark(w.store.get(APP))).not.toBeNull(); // the stage is still what is kept
    expect(b.state.held.at(-1)).toBe(true); // and the box waits
    expect(takingBack(R)).toBe(true);
    w.failReads(false); // the machine answers again
    await vi.advanceTimersByTimeAsync(SETTLE_RETRY_MS * 64);
    await run;
    expect(stageMark(w.store.get(APP))).toBeNull();
    expect(textOf(w.store.get(APP)!.doc as ComposerDoc)).toBe(TEXT);
    expect(b.state.held.at(-1)).toBe(false);
  });
});

// the branch panel's findings 3 and 4 (decision 13's table): a message the record says is still listed keeps its stage
// and is withdrawn again, however many times that takes; each read of the record replays it from the stage's own name
describe('a message the record keeps listed', () => {
  it('(finding 4) a promote and then a revert, read from the stage’s own name: listed under its queue id again, withdrawn there, and loaded', async () => {
    const w = world();
    // the entry was sent on under a uuid before the take-back's withdrawal reached it
    w.steers.add(U2);
    w.row('promote', 'q-1', U2);
    w.listed();
    const b = box();
    attachTakeBackBox(APP, b.api);
    w.controls.cancelSteer.mockImplementationOnce(async () => {
      // the frame's write failed: the promotion is reverted, the entry listed again
      w.steers.delete(U2);
      w.entries.add('q-1');
      w.row('revert', 'q-1', null);
      w.listed();
      return { ok: true, value: { outcome: 'already_started' as const } };
    });
    await takeBack(APP, after('q-1'), w.deps);
    expect(w.controls.remove).toHaveBeenLastCalledWith({ queueId: 'q-1' });
    expect(w.entries.size).toBe(0); // withdrawn under its queue id
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(notice()).toBeNull(); // not "may already have been read": the record could say
  });

  it('(finding 3) withdrawals that keep failing while it stays listed: the stage stays, the box stays held, and nothing is loaded; Delete on the row is the way out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const w = world();
    w.entries.add('q-1');
    w.listed();
    const b = box();
    attachTakeBackBox(APP, b.api);
    // the queue's persistence fails: the entry is put back and the removal rejected, again and again
    w.controls.remove.mockImplementation(async () => ({ ok: false, error: { code: 'internal' as const, message: 'the queue could not be saved' } }));
    const run = takeBack(APP, after('q-1'), w.deps);
    await vi.advanceTimersByTimeAsync(SETTLE_RETRY_MS * 120);
    expect(w.controls.remove.mock.calls.length).toBeGreaterThan(4); // still withdrawing past the old four rounds
    expect(b.state.loaded).toEqual([]);
    expect(stageMark(w.store.get(APP))).not.toBeNull();
    expect(b.state.held.at(-1)).toBe(true);
    expect(takingBack(APP)).toBe(true);
    expect(notice()).toBeNull(); // nothing new drawn
    // Delete on the still-listed row: the engine removes it; the next withdrawal is refused and the record says removed
    w.entries.delete('q-1');
    w.row('remove', 'q-1', null);
    w.listed();
    w.controls.remove.mockImplementation(w.real.remove);
    await vi.advanceTimersByTimeAsync(SETTLE_RETRY_MS * 64);
    await run;
    expect(b.state.loaded.map(textOf)).toEqual([TEXT]);
    expect(stageMark(w.store.get(APP))).toBeNull();
    expect(b.state.held.at(-1)).toBe(false);
  });
});
