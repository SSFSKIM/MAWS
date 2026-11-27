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
  const store = createStore({ read: (session) => new Promise<ReadAnswer>((done) => void pending.push({ session, done })) });
  const answer = async (at: number, value: ReadAnswer) => {
    pending[at]!.done(value);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { store, pending, answer };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the store', () => {
  it('reads the session it is shown, once, and holds nothing until the read is applied', async () => {
    const { store, pending, answer } = harness();
    store.show(S);
    store.show(S);
    expect(pending.map((read) => read.session)).toEqual([S]);
    expect(store.state().shown).toEqual({ session: S, model: undefined, fresh: false });
    await answer(0, { ok: true, model: model(1), door: DOOR });
    expect(store.state().shown).toEqual({ session: S, model: model(1), fresh: true });
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
    expect(store.state().shown).toEqual({ session: S, model: model(1), fresh: false });
    store.changed(S, summary(S, 2)); // a change heard before `ready` reads, but is not the snapshot's read
    await answer(2, { ok: true, model: model(2), door: DOOR });
    expect(store.state().shown).toEqual({ session: S, model: model(2), fresh: false });
    store.ready([summary(S, 2)], DOOR);
    expect(pending).toHaveLength(4);
    await answer(3, { ok: true, model: model(2), door: DOOR });
    expect(store.state().shown).toEqual({ session: S, model: model(2), fresh: true });
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
    expect(store.state().shown).toEqual({ session: T, model: undefined, fresh: false });
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
    expect(store.state().shown).toEqual({ session: S, model: null, fresh: true });
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
