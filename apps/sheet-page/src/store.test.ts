// The page's data (§P, "The page and the model"; T14): the summaries and the door from each snapshot, and the model of
// the one session on screen, read again at every snapshot and at each change of that session, the later read standing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SheetModel, SheetSummary } from '@shared/sheet/model';
import type { ReadAnswer } from './api';
import { createStore, READ_RETRY_MS } from './store';

const S = '5eed0000-0000-4000-8000-000000000019';
const T = '5eed0000-0000-4000-8000-0000000000a2';
const model = (seq: number, session = S): SheetModel => ({ v: 1, session, seq, open: [], hidden: [], sent: [], pending: [], closed: {} });
const summary = (session: string, open: number): SheetSummary => ({ session, appSessionId: null, title: null, live: true, seq: 1, open, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false });
const DOOR = { known: true as const, available: true as const };

function harness() {
  const pending: { session: string; done(answer: ReadAnswer): void }[] = [];
  let stored = 0; // what storage holds of the memory, as a version the baseline captures
  const watched = new Map<string, Set<(adopted: boolean) => void>>(); // the memory's listeners, by session
  const store = createStore({
    read: (session) => new Promise<ReadAnswer>((done) => void pending.push({ session, done })),
    baseline: () => ({ version: stored }) as never,
    onMemory: (session, listener) => {
      const set = watched.get(session) ?? new Set();
      watched.set(session, set.add(listener));
      return () => void set.delete(listener);
    },
  });
  // a write of the session's memory: another tab's (adopted) or this tab's own
  const wrote = (session: string, adopted = true) => {
    for (const listener of watched.get(session) ?? []) listener(adopted);
  };
  const answer = async (at: number, value: ReadAnswer) => {
    pending[at]!.done(value);
    await Promise.resolve();
    await Promise.resolve();
  };
  const write = () => void (stored += 1); // a write lands in storage, its event not yet delivered
  return { store, pending, answer, wrote, watched, write };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the store', () => {
  it('reads the session it is shown, once, and holds nothing until the read is applied', async () => {
    const { store, pending, answer } = harness();
    store.show(S);
    store.show(S);
    expect(pending.map((read) => read.session)).toEqual([S]);
    expect(store.state().shown).toMatchObject({ session: S, model: undefined, fresh: false });
    await answer(0, { ok: true, model: model(1), door: DOOR });
    expect(store.state().shown).toMatchObject({ session: S, model: model(1), fresh: true });
    expect(store.state().door).toEqual(DOOR);
  });

  it('a new connection is not fresh from its `paired` until the read its `ready` started is applied (T14)', async () => {
    const { store, pending, answer } = harness();
    store.show(S);
    store.ready([summary(S, 1)], DOOR);
    await answer(0, { ok: true, model: model(1), door: DOOR });
    await answer(1, { ok: true, model: model(1), door: DOOR });
    expect(store.state().shown?.fresh).toBe(true);
    store.opened(); // the next connection reached `paired`; its `ready` has not come
    expect(store.state().shown).toMatchObject({ session: S, model: model(1), fresh: false });
    store.changed(S, summary(S, 2)); // a change heard before `ready` reads, but is not the snapshot's read
    await answer(2, { ok: true, model: model(2), door: DOOR });
    expect(store.state().shown).toMatchObject({ session: S, model: model(2), fresh: false });
    store.ready([summary(S, 2)], DOOR);
    expect(pending).toHaveLength(4);
    await answer(3, { ok: true, model: model(2), door: DOOR });
    expect(store.state().shown).toMatchObject({ session: S, model: model(2), fresh: true });
  });

  it('a write of another tab, adopted, unsettles the model until a read started after it is applied, and starts that read', async () => {
    const { store, pending, answer } = harness();
    store.show(S);
    await answer(0, { ok: true, model: model(1), door: DOOR });
    expect(store.state().shown).toMatchObject({ model: model(1), settled: true });
    store.adopted(S);
    expect(store.state().shown).toMatchObject({ model: model(1), settled: false });
    expect(pending).toHaveLength(2); // the read the adoption starts
    store.adopted(S); // another, while that read is out: one more read once it lands, not one each
    expect(pending).toHaveLength(2);
    await answer(1, { ok: true, model: model(1), door: DOOR });
    expect(store.state().shown).toMatchObject({ settled: false }); // started before the second adoption
    expect(pending).toHaveLength(3);
    await answer(2, { ok: true, model: model(2), door: DOOR });
    expect(store.state().shown).toMatchObject({ model: model(2), settled: true });
    store.adopted(T); // another session's: nothing of this one
    expect(store.state().shown).toMatchObject({ settled: true });
    expect(pending).toHaveLength(3);
  });

  it('a write of another tab while the first read is out leaves that read unsettled, though no view was mounted to hear it (B1)', async () => {
    const { store, pending, answer, wrote } = harness();
    store.show(S); // the first read, slow
    wrote(S); // another tab writes a draft against a newer model, before this tab draws anything
    await answer(0, { ok: true, model: model(1), door: DOOR });
    expect(store.state().shown).toMatchObject({ model: model(1), settled: false }); // an older model: its reconcile is not written
    expect(pending).toHaveLength(2); // and it is read again
    await answer(1, { ok: true, model: model(2), door: DOOR });
    expect(store.state().shown).toMatchObject({ model: model(2), settled: true });
  });

  it('carries the stored memory as it was when the applied read started, whatever storage holds when it lands (B1)', async () => {
    const { store, answer, write, wrote } = harness();
    store.show(S);
    write(); // another tab's write after the read started; its event comes only after the answer
    await answer(0, { ok: true, model: model(1), door: DOOR });
    expect(store.state().shown).toMatchObject({ model: model(1), settled: true, baseline: { version: 0 } }); // judged against the start
    wrote(S); // the event, delivered late: the read again carries the newer baseline
  });

  it('holds the model unfresh from `unavailable` until a read started after the next snapshot is applied (B3)', async () => {
    const { store, pending, answer } = harness();
    store.show(S);
    store.ready([summary(S, 1)], DOOR);
    await answer(0, { ok: true, model: model(1), door: DOOR });
    await answer(1, { ok: true, model: model(1), door: DOOR });
    expect(store.state().shown?.fresh).toBe(true);
    store.stale(); // the spine went away: no snapshot can be had now
    expect(store.state().shown?.fresh).toBe(false);
    store.changed(S, summary(S, 2)); // a read before the next snapshot does not make it fresh
    await answer(2, { ok: true, model: model(2), door: DOOR });
    expect(store.state().shown?.fresh).toBe(false);
    store.ready([summary(S, 2)], DOOR);
    await answer(pending.length - 1, { ok: true, model: model(2), door: DOOR });
    expect(store.state().shown?.fresh).toBe(true);
  });

  it('a write of this tab’s own, or of another session, settles nothing less; a session left is no longer heard (B1)', async () => {
    const { store, pending, answer, wrote, watched } = harness();
    store.show(S);
    wrote(S, false);
    wrote(T);
    await answer(0, { ok: true, model: model(1), door: DOOR });
    expect(store.state().shown).toMatchObject({ settled: true });
    expect(pending).toHaveLength(1);
    store.show(T);
    expect(watched.get(S)?.size ?? 0).toBe(0);
    expect(watched.get(T)?.size).toBe(1);
  });

  it('forgets everything of a pairing that ended, keeps the place, and applies none of its reads still out (B5)', async () => {
    const { store, pending, answer } = harness();
    store.show(S);
    store.ready([summary(S, 1)], DOOR);
    await answer(0, { ok: true, model: model(1), door: DOOR });
    await answer(1, { ok: true, model: model(1), door: DOOR });
    store.changed(S, summary(S, 2)); // a read out when the pairing ends
    store.reset();
    expect(store.state()).toEqual({ sessions: null, door: null, shown: { session: S, model: undefined, fresh: false, settled: false } });
    await answer(2, { ok: true, model: model(2), door: DOOR });
    expect(store.state().shown?.model).toBeUndefined(); // the old pairing's read is not applied
    expect(pending).toHaveLength(3); // and the reset reads nothing itself
    store.opened(); // the next pairing's connection
    store.ready([summary(S, 3)], DOOR);
    expect(pending).toHaveLength(4);
    await answer(3, { ok: true, model: model(3), door: DOOR });
    expect(store.state().shown).toMatchObject({ model: model(3), fresh: true, settled: true });
  });

  it('retries no read of a pairing that ended (B5)', async () => {
    const { store, pending, answer } = harness();
    store.show(S);
    await answer(0, { ok: false, why: 'unproven' });
    store.reset();
    vi.advanceTimersByTime(READ_RETRY_MS * 2);
    expect(pending).toHaveLength(1);
  });

  it('an adoption’s read belongs to the session on screen: a read of the one left before does not hold it back', async () => {
    const { store, pending, answer } = harness();
    store.show(S); // its read held
    store.show(T);
    await answer(1, { ok: true, model: model(1, T), door: DOOR });
    expect(store.state().shown).toMatchObject({ session: T, settled: true });
    store.adopted(T);
    expect(pending.map((read) => read.session)).toEqual([S, T, T]); // read at once: nothing of T's is out
    await answer(0, { ok: true, model: model(1), door: DOOR }); // the read of the session left
    await answer(2, { ok: true, model: model(2, T), door: DOOR });
    expect(store.state().shown).toMatchObject({ session: T, model: model(2, T), settled: true });
    store.adopted(T);
    store.adopted(T); // while that read is out: one more once it lands
    expect(pending).toHaveLength(4);
    store.show(S);
    store.show(T); // and back: the queue was T's, and T's read is what it waits for
    expect(pending.map((read) => read.session)).toEqual([S, T, T, T, S, T]);
    await answer(3, { ok: true, model: model(2, T), door: DOOR });
    await answer(5, { ok: true, model: model(3, T), door: DOOR });
    expect(store.state().shown).toMatchObject({ session: T, model: model(3, T), settled: true });
  });

  it('leaves the later read standing when two finish in the other order', async () => {
    const { store, answer } = harness();
    store.show(S);
    store.changed(S, summary(S, 2)); // a second read of the same session
    await answer(1, { ok: true, model: model(2), door: DOOR });
    await answer(0, { ok: true, model: model(1), door: DOOR });
    expect(store.state().shown?.model).toEqual(model(2));
  });

  it('after a snapshot, holds the model unread again until the read started after it is applied', async () => {
    const { store, pending, answer } = harness();
    store.show(S);
    await answer(0, { ok: true, model: model(1), door: DOOR });
    store.changed(S, summary(S, 1)); // a read out before the snapshot
    store.ready([summary(S, 2)], DOOR);
    expect(store.state().shown?.fresh).toBe(false);
    expect(pending).toHaveLength(3);
    await answer(1, { ok: true, model: model(2), door: DOOR }); // the older read: applied, but not the snapshot's
    expect(store.state().shown).toMatchObject({ model: model(2), fresh: false });
    await answer(2, { ok: true, model: model(3), door: DOOR });
    expect(store.state().shown).toMatchObject({ model: model(3), fresh: true });
  });

  it('takes the summaries of each snapshot and each change, and reads only for the session on screen', async () => {
    const { store, pending } = harness();
    store.show(S);
    store.ready([summary(S, 2), summary(T, 1)], DOOR);
    store.changed(T, summary(T, 3));
    store.changed('5eed0000-0000-4000-8000-0000000000a3', summary('5eed0000-0000-4000-8000-0000000000a3', 1));
    store.changed(S, null);
    expect(store.state().sessions).toEqual([summary(T, 3), summary('5eed0000-0000-4000-8000-0000000000a3', 1)]);
    expect(pending.map((read) => read.session)).toEqual([S, S, S]);
  });

  it('drops a read of a session no longer on screen', async () => {
    const { store, answer } = harness();
    store.show(S);
    store.show(T);
    await answer(0, { ok: true, model: model(1), door: DOOR });
    expect(store.state().shown).toMatchObject({ session: T, model: undefined, fresh: false });
    store.show(null);
    expect(store.state().shown).toBeNull();
  });

  it('reads again after a read that failed, while the session is on screen and nothing newer was asked', async () => {
    const { store, pending, answer } = harness();
    store.show(S);
    await answer(0, { ok: false, why: 'failed' });
    expect(store.state().shown?.fresh).toBe(false);
    vi.advanceTimersByTime(READ_RETRY_MS);
    expect(pending).toHaveLength(2);
    await answer(1, { ok: true, model: null, door: DOOR });
    expect(store.state().shown).toMatchObject({ session: S, model: null, fresh: true });
  });

  it('tells its listeners of every change', async () => {
    const { store, answer } = harness();
    const told = vi.fn();
    const off = store.subscribe(told);
    store.show(S);
    store.ready([], DOOR);
    await answer(1, { ok: true, model: model(1), door: DOOR });
    expect(told.mock.calls.length).toBeGreaterThanOrEqual(3);
    const before = store.state();
    expect(store.state()).toBe(before); // a state is one object until it changes
    off();
  });
});
