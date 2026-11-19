// "Attach selection to chat", the hand-over (UX wave U6b-5a, M2; docs/doperpowers/plans/2026-11-17-ux-wave-U6b-5-rest-
// of-keyboard.md, S1, decisions 8 and 30 to 33), for a session on this Mac. One attach's block goes to whoever is the
// authority over the session's draft (a mounted composer, else the store), at most once, keeping what the person typed,
// and says `added` only once the authority holds it. Each case that holds an answer open uses a store with the real
// store's rule for `replaces` (`test-support/attach.tsx`), so a write the test lets land changes what a later read
// answers; each ends on the three claims: the authority's final document holds exactly one block of the attach, it holds
// what the person typed, and the outcome was said once, at the end, and not before.
import { act, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DRAFT_CLAIM, STALE_DRAFT_WORDS, type Draft } from '@shared/ipc/schema/session';
import { REQUEST_TIMEOUT_MS } from '@shared/host/host-supervisor';
import { REMOTE_ACT_PENDING_MS } from '@shared/machine/remote-pending';
import { at } from '../../../../test/support/machine';
import { resetReaderRows } from '../lane-b/reader-rows';
import { useSetup } from '../sessions/store';
import { resetCatalogStore } from '../stores/catalog';
import { resetComposerStore } from '../stores/composer';
import { useSessions } from '../stores/sessions';
import { attachedIn, attachOf, draftStore, heldSends, heldWrite, holdsOnce, mountComposer, settle, staleRounds, textOf, TIMEOUT, type DraftStoreFake } from '../test-support/attach';
import { ATTACH_DEADLINE_COMMANDS, ATTACH_ROUNDS, attachDeadlineMs, COMMAND_BOUND_HERE_MS, type AttachOutcome } from './attach-pasted';
import { forgetSubmissions } from './editor/controller';
import { docOf, paragraph, textNode, type ComposerDoc } from './editor/doc';
import { resetRemoteDrafts } from './editor/drafts';

const S = at('app-attach-here' as AppSessionId);
const S2 = at('app-attach-control' as AppSessionId);
const SET = 'session.drafts.set' as const;
const GET = 'session.drafts.get' as const;
const EARLIER = docOf([paragraph(textNode('earlier words'))]);
const TYPED = ' typed words';
const STALE = { ok: false as const, error: { code: 'internal' as const, message: STALE_DRAFT_WORDS } };
const added: AttachOutcome = { kind: 'added' };
const unconfirmed: AttachOutcome = { kind: 'unconfirmed' };
const refused = (why: Extract<AttachOutcome, { kind: 'refused' }>['why']): AttachOutcome => ({ kind: 'refused', why });

const attach = (store: DraftStoreFake, session: AppSessionId = S) => attachOf(store, session);

beforeEach(() => {
  resetComposerStore();
  resetCatalogStore();
  resetRemoteDrafts();
  resetReaderRows();
});
afterEach(() => {
  cleanup();
  forgetSubmissions();
  useSetup.setState({ intents: new Map() });
  useSessions.setState({ records: new Map(), engine: new Map() });
  vi.useRealTimers();
});

describe('a composer mounted at the press', () => {
  it('whose box can take the keyboard takes the block at the caret and the keyboard; nothing is said and nothing saved by the attach', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    const box = mountComposer(S, store.client);
    await box.restored();
    const a = attach(store);
    expect(await a.done).toEqual({ kind: 'taken' });
    expect(box.content().contains(document.activeElement)).toBe(true);
    holdsOnce(box.editor().doc(), 'earlier words');
    expect(store.writes()).toEqual([]); // the writer's pause saves it, as any typing
    expect(store.reads()).toBe(1); // the composer's own restore, no read of the attach's
  });

  it.each([
    ['a card holds its box', { covered: true }],
    ['a maximized side column covers its pane', { inert: true }],
  ])('where %s, takes the block at the end and saves at once; the line comes after the port’s answer, not before', async (_where, place) => {
    const store = draftStore(S);
    store.put(EARLIER);
    const box = mountComposer(S, store.client, place);
    await box.restored();
    store.hold(SET);
    const a = attach(store);
    const save = await heldWrite(store);
    a.holds((save.input as { draft: Draft }).draft.doc as ComposerDoc, 'earlier words');
    await settle();
    expect(a.said).toBeNull();
    expect(a.lines()).toEqual([]); // held: nothing said before the port's answer
    expect(box.content().contains(document.activeElement)).toBe(false);
    await save.answer();
    expect(await a.done).toEqual(added);
    expect(a.lines()).toHaveLength(1);
    a.holds(store.doc(), 'earlier words');
  });

  it('whose port does not keep the save ends unsaved, with the block in its box', async () => {
    const store = draftStore(S);
    const box = mountComposer(S, store.client, { covered: true, port: { load: async () => null, save: async () => false } });
    await box.restored();
    expect(await attach(store).done).toEqual(refused('unsaved'));
    holdsOnce(box.editor().doc());
  });

  it('that is sending ends busy at once, and nothing of the block is written anywhere', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    const sends = heldSends();
    const box = mountComposer(S, store.client, { onSubmit: sends.onSubmit });
    await box.restored();
    box.send();
    await waitFor(() => expect(sends.sent).toHaveLength(1));
    expect(await attach(store).done).toEqual(refused('busy'));
    expect(store.reads()).toBe(1);
    expect(store.writes()).toEqual([]);
    expect(attachedIn(box.editor().doc())).toEqual([]);
    await sends.answer(false);
  });
});

// Finding 2: the store's write held open while a composer for the session mounts and is used; each act again with the
// write released before the act instead of after it.
describe('the hand-over, a write held while a composer comes', () => {
  async function pressedWithWriteHeld() {
    const store = draftStore(S);
    store.put(EARLIER);
    store.hold(SET);
    const a = attach(store);
    const write = await heldWrite(store);
    return { store, a, write };
  }

  it.each(['after', 'before'] as const)('a composer mounts and nothing else happens (the write released %s it)', async (when) => {
    const { store, a, write } = await pressedWithWriteHeld();
    if (when === 'before') await write.answer();
    const box = mountComposer(S, store.client);
    await box.restored();
    if (when === 'after') {
      await settle();
      expect(a.said).toBeNull();
      expect(a.lines()).toEqual([]);
      await write.answer();
    }
    expect(await a.done).toEqual(added);
    await settle();
    expect(a.lines()).toHaveLength(1);
    a.holds(box.editor().doc(), 'earlier words');
    box.unmount();
    a.holds(store.doc(), 'earlier words');
  });

  it.each(['after', 'before'] as const)('a composer mounts and the person types in it (the write released %s)', async (when) => {
    const { store, a, write } = await pressedWithWriteHeld();
    if (when === 'before') await write.answer();
    const box = mountComposer(S, store.client);
    await box.restored();
    await box.type(TYPED);
    if (when === 'after') {
      await settle();
      expect(a.said).toBeNull();
      await write.answer();
    }
    expect(await a.done).toEqual(added);
    holdsOnce(box.editor().doc(), 'earlier words', TYPED);
    box.unmount();
    holdsOnce(store.doc(), 'earlier words', TYPED);
  });

  it('a composer mounts, the person types and sends (the write released after): the message holds no block, the box holds it after', async () => {
    const { store, a, write } = await pressedWithWriteHeld();
    const sends = heldSends();
    const box = mountComposer(S, store.client, { onSubmit: sends.onSubmit });
    await box.restored();
    await box.type(TYPED);
    box.send();
    await waitFor(() => expect(sends.sent).toHaveLength(1));
    await write.answer();
    await settle();
    expect(a.said).toBeNull(); // a send is in flight: the loop waits for it and says nothing
    await sends.answer(true);
    expect(await a.done).toEqual(added);
    expect(sends.sent[0]!.display).toBe(`earlier words${TYPED}`);
    expect(sends.sent[0]!.pastedContents).toEqual({});
    holdsOnce(box.editor().doc());
    box.unmount();
    holdsOnce(store.doc());
    expect(textOf(store.doc())).not.toContain('typed words'); // sent, so gone from the draft
  });

  it('a composer mounts, the person types and sends (the write released before): the block goes once, with the message', async () => {
    const { store, a, write } = await pressedWithWriteHeld();
    await write.answer();
    expect(await a.done).toEqual(added);
    const sends = heldSends();
    const box = mountComposer(S, store.client, { onSubmit: sends.onSubmit });
    await box.restored();
    await box.type(TYPED);
    box.send();
    await waitFor(() => expect(sends.sent).toHaveLength(1));
    await sends.answer(true);
    expect(Object.values(sends.sent[0]!.pastedContents)).toHaveLength(1); // the block, sent once
    expect(attachedIn(box.editor().doc())).toEqual([]);
    expect(a.lines()).toHaveLength(1);
  });

  it.each(['before', 'after'] as const)('a composer mounts, the person types, and it unmounts, its flush landing %s the held write', async (order) => {
    const { store, a, write } = await pressedWithWriteHeld();
    if (order === 'after') store.hold(SET); // the flush, held too, to land after the attach's write
    const box = mountComposer(S, store.client);
    await box.restored();
    await box.type(TYPED);
    box.unmount();
    if (order === 'after') {
      const flush = await heldWrite(store, 1);
      write.land();
      flush.land(); // in the order they were sent, as one window's commands reach its store
      await write.answer();
      await flush.answer();
    } else await write.answer(); // the flush landed first: the write is stale
    expect(await a.done).toEqual(added);
    expect(a.lines()).toHaveLength(1);
    a.holds(store.doc(), 'earlier words', TYPED);
  });

  it('a composer mounts and unmounts with the write released before: its flush keeps the block once', async () => {
    const { store, a, write } = await pressedWithWriteHeld();
    await write.answer();
    expect(await a.done).toEqual(added);
    const box = mountComposer(S, store.client);
    await box.restored();
    await box.type(TYPED);
    box.unmount();
    await settle();
    holdsOnce(store.doc(), 'earlier words', TYPED);
  });

  // The delta review: a send outlives its composer and writes the draft when it settles.
  it.each([
    ['accepted', true],
    ['refused', false],
  ] as const)('a send that outlives its composer, %s: the loop says nothing while it is held, and the draft ends holding the block once', async (_how, accepted) => {
    const { store, a, write } = await pressedWithWriteHeld();
    const sends = heldSends();
    const box = mountComposer(S, store.client, { onSubmit: sends.onSubmit });
    await box.restored();
    await box.type(TYPED);
    box.send();
    await waitFor(() => expect(sends.sent).toHaveLength(1));
    box.unmount();
    await write.answer(); // accepted: the block is kept, but a send is in flight
    await settle();
    expect(a.said).toBeNull();
    expect(a.lines()).toEqual([]);
    await sends.answer(accepted);
    expect(await a.done).toEqual(added);
    expect(a.lines()).toHaveLength(1);
    if (accepted) {
      a.holds(store.doc());
      expect(textOf(store.doc())).not.toContain('typed words');
    } else a.holds(store.doc(), 'earlier words', TYPED);
  });
});

// Finding 3: a write whose answer is not definite is settled by a read, or the person is told MAWS could not confirm.
describe('an answer that is not definite', () => {
  it('a write that landed and was answered timeout is found by the next read, and not written again', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    store.hold(SET);
    const a = attach(store);
    const write = await heldWrite(store);
    write.land();
    await write.answer(TIMEOUT);
    expect(await a.done).toEqual(added);
    expect(store.writes()).toHaveLength(1);
    holdsOnce(store.doc(), 'earlier words');
  });

  it('a write that was lost is written again, once; the lost one landing late is refused', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    store.hold(SET);
    const a = attach(store);
    const write = await heldWrite(store);
    await write.answer(TIMEOUT); // never landed
    expect(await a.done).toEqual(added);
    expect(store.writes()).toHaveLength(2);
    expect(write.land().ok).toBe(false); // it named the revision the second write replaced
    holdsOnce(store.doc(), 'earlier words');
  });

  it.each(['landed', 'lost'] as const)('a write answered timeout (%s) with every later read failing ends unconfirmed, and the block is never there twice', async (fate) => {
    const store = draftStore(S);
    store.put(EARLIER);
    store.hold(SET);
    const a = attach(store);
    const write = await heldWrite(store);
    if (fate === 'landed') write.land();
    store.failReads({ ok: false, error: { code: 'host_unavailable', message: 'the service is not running' } });
    await write.answer(TIMEOUT);
    expect(await a.done).toEqual(unconfirmed);
    if (fate === 'lost') {
      expect(attachedIn(store.doc())).toEqual([]);
      write.land(); // it lands after all
    }
    holdsOnce(store.doc(), 'earlier words');
  });

  it.each(['first', 'second'] as const)('two writes of one block naming one revision, the %s landing first: one is taken', async (first) => {
    const store = draftStore(S);
    store.put(EARLIER);
    store.hold(SET, 2);
    const a = attach(store);
    const one = await heldWrite(store);
    await one.answer(TIMEOUT); // not landed: the next round reads the same revision and names it
    const two = await heldWrite(store, 1);
    expect((two.input as { replaces: string }).replaces).toBe((one.input as { replaces: string }).replaces);
    if (first === 'first') {
      one.land();
      await two.answer(); // stale now; the next round's read finds the block
    } else {
      await two.answer();
      expect(one.land().ok).toBe(false);
    }
    expect(await a.done).toEqual(added);
    expect(store.accepted()).toBe(1);
    holdsOnce(store.doc(), 'earlier words');
  });
});

// The delta review: while a write of the block is unaccounted for, no end is a refusal. The control in each: the same
// refusal with no write unaccounted for ends as that refusal.
describe('an unaccounted write at every exit', () => {
  async function afterAWrite(session: AppSessionId, answer: 'timeout' | 'stale', between: (store: DraftStoreFake) => Promise<void> | void) {
    const store = draftStore(session);
    store.put(EARLIER);
    store.hold(SET);
    const a = attach(store, session);
    const write = await heldWrite(store);
    await between(store);
    await write.answer(answer === 'timeout' ? TIMEOUT : STALE);
    return { store, outcome: await a.done };
  }

  it('a composer mounts and answers closed', async () => {
    const mount = (session: AppSessionId) => async (store: DraftStoreFake) => void (await mountComposer(session, store.client, { disabled: 'read only' }).restored());
    expect((await afterAWrite(S, 'timeout', mount(S))).outcome).toEqual(unconfirmed);
    expect((await afterAWrite(S2, 'stale', mount(S2))).outcome).toEqual(refused('closed'));
  });

  it('a composer mounts and answers unsaved', async () => {
    const mount = (session: AppSessionId) => async (store: DraftStoreFake) => void (await mountComposer(session, store.client, { port: { load: async () => null, save: async () => false } }).restored());
    expect((await afterAWrite(S, 'timeout', mount(S))).outcome).toEqual(unconfirmed);
    expect((await afterAWrite(S2, 'stale', mount(S2))).outcome).toEqual(refused('unsaved'));
  });

  it('the next round’s write is refused because a message is being taken back', async () => {
    const stage = (store: DraftStoreFake) => store.put({ ...EARLIER, attrs: { ...EARLIER.attrs, takeBack: { name: 'n-1', by: 'uuid', at: '2026-11-17T10:00:00.000Z' } } });
    const held = await afterAWrite(S, 'timeout', stage);
    expect(held.outcome).toEqual(unconfirmed);
    const control = await afterAWrite(S2, 'stale', stage);
    expect(control.outcome).toEqual(refused('taking-back'));
    expect(control.store.accepted()).toBe(0);
  });

  it('the next round’s read answers an unknown session', async () => {
    expect((await afterAWrite(S, 'timeout', (store) => store.forget())).outcome).toEqual(unconfirmed);
    expect((await afterAWrite(S2, 'stale', (store) => store.forget())).outcome).toEqual(refused('unknown'));
  });
});

// The re-check: a write in the claim form that is unaccounted for stays so, since a claim can come true again after a
// clear; a write naming a revision is accounted for by a later accepted write.
describe('a claim that is unaccounted for', () => {
  async function claimThenClear(store: DraftStoreFake, session: AppSessionId) {
    store.hold(SET, 2); // the first write, and the second round's
    const a = attach(store, session);
    const first = await heldWrite(store);
    await first.answer(TIMEOUT); // not landed
    const second = await heldWrite(store, 1);
    store.hold(SET); // the composer's flush
    const box = mountComposer(session, store.client);
    await box.restored();
    await box.type('x');
    await settle();
    await act(async () => box.editor().clear()); // the person empties the box: its write is a clear
    box.unmount();
    const flush = await heldWrite(store, 2);
    expect((flush.input as { draft: Draft | null }).draft).toBeNull();
    second.land();
    flush.land();
    store.hold(GET); // the third round's read, during which a composer comes and goes
    await second.answer();
    await waitFor(() => expect(store.held(GET)).toHaveLength(1));
    const passing = mountComposer(session, store.client);
    await passing.restored();
    passing.unmount();
    await store.held(GET)[0]!.answer();
    await flush.answer();
    return { a, first };
  }

  it('ends unconfirmed, not changed, when the last read shows an empty draft; the claim landing late holds the block once', async () => {
    const store = draftStore(S);
    store.put(null); // a draft cleared before the attach
    const { a, first } = await claimThenClear(store, S);
    expect((first.input as { replaces: string }).replaces).toBe(DRAFT_CLAIM);
    expect(await a.done).toEqual(unconfirmed);
    expect(attachedIn(store.doc())).toEqual([]);
    expect(first.land().ok).toBe(true); // the claim comes true again after the clear
    holdsOnce(store.doc());

    // The control: the same sequence with the first write naming a revision ends changed, and that write cannot land.
    const control = draftStore(S2);
    control.put(EARLIER);
    const named = await claimThenClear(control, S2);
    expect((named.first.input as { replaces: string }).replaces).not.toBe(DRAFT_CLAIM);
    expect(await named.a.done).toEqual(refused('changed'));
    expect(named.first.land().ok).toBe(false);
    expect(attachedIn(control.doc())).toEqual([]);
  });
});

describe('a composer that mounts during the last read', () => {
  it.each(['shows the block', 'shows none'] as const)('ends unconfirmed whatever the read answers (it %s)', async (shows) => {
    const store = draftStore(S);
    store.put(EARLIER);
    staleRounds(store, ATTACH_ROUNDS, (round) => {
      if (round === ATTACH_ROUNDS) store.hold(GET);
    });
    const a = attach(store);
    await waitFor(() => expect(store.held(GET)).toHaveLength(1));
    if (shows === 'shows the block') store.put((store.writes().at(-1)!.draft as Draft).doc as ComposerDoc);
    const box = mountComposer(S, store.client);
    await box.restored();
    await store.held(GET)[0]!.answer();
    expect(await a.done).toEqual(unconfirmed);
    box.unmount();
  });
});

describe('the last read', () => {
  it('after three stale rounds is a fourth read and no fourth write; no block there and none unaccounted for is changed', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    staleRounds(store, ATTACH_ROUNDS);
    expect(await attach(store).done).toEqual(refused('changed'));
    expect(store.reads()).toBe(ATTACH_ROUNDS + 1);
    expect(store.writes()).toHaveLength(ATTACH_ROUNDS);
    expect(store.accepted()).toBe(0);
    expect(attachedIn(store.doc())).toEqual([]);
  });

  it('with the block there is added', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    staleRounds(store, ATTACH_ROUNDS - 1, (round) => {
      if (round === ATTACH_ROUNDS - 1) store.afterNextRead(() => store.put((store.writes().at(-1)!.draft as Draft).doc as ComposerDoc)); // another writer keeps the block
    });
    expect(await attach(store).done).toEqual(added);
    expect(store.writes()).toHaveLength(ATTACH_ROUNDS);
    holdsOnce(store.doc());
  });

  it('with the third round’s write answered timeout and no block there is unconfirmed', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    staleRounds(store, ATTACH_ROUNDS - 1, (round) => {
      if (round === ATTACH_ROUNDS - 1) store.hold(SET, 2); // the second round's write lands stale; the third's is held
    });
    const a = attach(store);
    const second = await heldWrite(store);
    await second.answer();
    const third = await heldWrite(store, 1);
    await third.answer(TIMEOUT);
    expect(await a.done).toEqual(unconfirmed);
  });

  it('that fails is unconfirmed', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    staleRounds(store, ATTACH_ROUNDS, (round) => {
      if (round === ATTACH_ROUNDS) store.failReads({ ok: false, error: { code: 'internal', message: 'the index could not be read' } });
    });
    expect(await attach(store).done).toEqual(unconfirmed);
  });
});

describe('the store’s round', () => {
  it('appends to a newer draft another writer kept between its read and its write, naming that one', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    const first = store.revision();
    store.afterNextRead(() => store.put(docOf([paragraph(textNode('newer words'))])));
    const a = attach(store);
    expect(await a.done).toEqual(added);
    const [stale, taken] = store.writes();
    expect(stale!.replaces).toBe(first);
    expect(taken!.replaces).not.toBe(first);
    holdsOnce(store.doc(), 'newer words');
    expect(textOf(store.doc())).not.toContain('earlier words');
  });

  it('names a draft’s revision, and the claim form where none is kept, cleared or never written', async () => {
    const kept = draftStore(S);
    kept.put(EARLIER);
    const revision = kept.revision();
    expect(await attach(kept).done).toEqual(added);
    expect(kept.writes()[0]!.replaces).toBe(revision);

    const never = draftStore(S);
    expect(await attach(never).done).toEqual(added);
    expect(never.writes()[0]!.replaces).toBe(DRAFT_CLAIM);
    holdsOnce(never.doc());

    const cleared = draftStore(S);
    cleared.put(null);
    expect(await attach(cleared).done).toEqual(added);
    expect(cleared.writes()[0]!.replaces).toBe(DRAFT_CLAIM);
    holdsOnce(cleared.doc());
  });

  it('a stage kept is taking back: one write, no further round, nothing kept', async () => {
    const store = draftStore(S);
    store.put({ ...EARLIER, attrs: { ...EARLIER.attrs, takeBack: { name: 'n-1', by: 'uuid', at: '2026-11-17T10:00:00.000Z' } } });
    expect(await attach(store).done).toEqual(refused('taking-back'));
    expect(store.writes()).toHaveLength(1);
    expect(store.reads()).toBe(1);
    expect(store.accepted()).toBe(0);
    const control = draftStore(S);
    control.put(EARLIER);
    expect(await attach(control).done).toEqual(added); // the control: without the stage the same write is taken
  });

  it('a session with no row is unknown, and nothing is written', async () => {
    const store = draftStore(S);
    store.forget();
    expect(await attach(store).done).toEqual(refused('unknown'));
    expect(store.writes()).toEqual([]);
    const control = draftStore(S);
    expect(await attach(control).done).toEqual(added);
  });

  it('a service that does not answer is unreachable, and nothing is written', async () => {
    const store = draftStore(S);
    store.failReads({ ok: false, error: { code: 'host_unavailable', message: 'the service is not running' } });
    expect(await attach(store).done).toEqual(refused('unreachable'));
    expect(store.writes()).toEqual([]);
    store.failReads(null);
    expect(await attach(store).done).toEqual(added); // the control
  });
});

// The named question: a terminal can belong to a session that has not started, in three ways.
describe('a session that has not started', () => {
  const intent = { appSessionId: S } as never;
  const record = { appId: S, title: { text: 'A chat' }, holder: { kind: 'self' } } as never;
  const status = { process: 'exited' } as never;
  it.each([
    ['before any start', { intent: true, record: false, engine: false }],
    ['while it starts', { intent: true, record: true, engine: false }],
    ['after a start that failed', { intent: true, record: false, engine: true }],
  ])('%s is refused where the store is the authority, with nothing read', async (_way, held) => {
    useSetup.setState({ intents: new Map(held.intent ? [[S, intent]] : []) });
    useSessions.setState({ records: new Map(held.record ? [[S, record]] : []), engine: new Map(held.engine ? [[S, status]] : []) });
    const store = draftStore(S);
    expect(await attach(store).done).toEqual(refused('not-started'));
    expect(store.reads()).toBe(0);
    expect(store.writes()).toEqual([]);
    const box = mountComposer(S, store.client, { port: { load: async () => null, save: async () => true } });
    await box.restored();
    expect(await attach(store).done).toEqual({ kind: 'taken' }); // its mounted composer takes it, as a paste
    holdsOnce(box.editor().doc());
  });
});

// The re-check's bound on the whole hand-over, with the suite's fake clock.
describe('the deadline', () => {
  it('is eight times a command’s bound: the store’s seven commands at their worst and one bound for a wait', () => {
    expect(ATTACH_DEADLINE_COMMANDS).toBe(8);
    expect(COMMAND_BOUND_HERE_MS).toBe(REQUEST_TIMEOUT_MS); // main's bound on a host-owned command, which the renderer cannot import
    expect(attachDeadlineMs(false)).toBe(8 * REQUEST_TIMEOUT_MS); // 80 s
    expect(attachDeadlineMs(true)).toBe(8 * REMOTE_ACT_PENDING_MS); // eight minutes
  });

  async function sendingForever(store: DraftStoreFake) {
    const sends = heldSends();
    const box = mountComposer(S, store.client, { onSubmit: sends.onSubmit });
    await box.restored();
    await box.type(TYPED);
    box.send();
    expect(sends.sent).toHaveLength(1); // the submission is handed in the same turn
    return box;
  }

  it('cuts a wait on a send that never settles: busy when no write of the block was sent, said only then', async () => {
    vi.useFakeTimers();
    const store = draftStore(S);
    store.put(EARLIER);
    store.hold(GET);
    const a = attach(store);
    await settle();
    await sendingForever(store);
    await store.held(GET)[0]!.answer(); // a composer came: the round is not believed, and nothing is written
    await vi.advanceTimersByTimeAsync(attachDeadlineMs(false) - 1);
    expect(a.said).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(a.said).toEqual(refused('busy'));
    expect(store.writes()).toEqual([]);
  });

  it('is unconfirmed when a write of the block was sent', async () => {
    vi.useFakeTimers();
    const store = draftStore(S);
    store.put(EARLIER);
    store.hold(SET);
    const a = attach(store);
    await settle();
    const write = store.held(SET)[0]!;
    await sendingForever(store);
    await write.answer();
    await vi.advanceTimersByTimeAsync(attachDeadlineMs(false) - 1);
    expect(a.said).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(a.said).toEqual(unconfirmed);
  });

  it('cuts nothing that was due: the store’s work with every answer just under its bound ends before it', async () => {
    vi.useFakeTimers();
    const store = draftStore(S, { delayMs: REQUEST_TIMEOUT_MS - 1 });
    store.put(EARLIER);
    staleRounds(store, ATTACH_ROUNDS);
    const a = attach(store);
    await vi.advanceTimersByTimeAsync((2 * ATTACH_ROUNDS + 1) * (REQUEST_TIMEOUT_MS - 1));
    expect(a.said).toEqual(refused('changed'));
    expect(store.reads()).toBe(ATTACH_ROUNDS + 1);
  });
});

describe('a store of build F (f1852de3a), which knows no claim form', () => {
  it('takes a save naming the kept revision', async () => {
    const store = draftStore(S, { rule: 'build-f' });
    store.put(EARLIER);
    expect(await attach(store).done).toEqual(added);
    holdsOnce(store.doc(), 'earlier words');
  });

  it('reads the claim form as a revision it does not hold: stale in each round, and the last read shows no block', async () => {
    const store = draftStore(S, { rule: 'build-f' });
    expect(await attach(store).done).toEqual(refused('changed'));
    expect(store.writes().map((write) => write.replaces)).toEqual([DRAFT_CLAIM, DRAFT_CLAIM, DRAFT_CLAIM]);
    expect(store.accepted()).toBe(0);
    expect(attachedIn(store.doc())).toEqual([]);
  });
});

// Decision Log 14 (M2's task review): each case loses the block, puts it in twice, or says a false "not added" or
// nothing, without its fix.
describe('the task review’s findings (Decision Log 14)', () => {
  it('(i) a departed composer’s save is not believed: the composer after it, typed in before its restore, ends holding the block once', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    const first = mountComposer(S, store.client, { covered: true });
    await first.restored();
    store.hold(SET); // the covered composer's immediate save
    const a = attach(store);
    const save = await heldWrite(store);
    first.unmount();
    store.hold(GET); // the next composer's restore
    const second = mountComposer(S, store.client);
    await second.type(TYPED); // before its restore answers: the restore is skipped
    await save.answer(); // the departed composer's save is kept
    await settle();
    await store.held(GET)[0]!.answer();
    expect(await a.done).toEqual(added);
    second.unmount(); // its final flush
    await settle();
    expect(a.lines()).toHaveLength(1);
    a.holds(store.doc(), TYPED);
  });

  // The re-review: a departed composer's save that was kept, with no composer after it, is unaccounted for until a
  // believed read, as an accepted store write in a round not believed is (Decision Log 17 (i)).
  it('(i) a departed composer’s kept save with none in its place: a failed read after it is unconfirmed', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    const first = mountComposer(S, store.client, { covered: true });
    await first.restored();
    store.hold(SET);
    const a = attach(store);
    const save = await heldWrite(store);
    first.unmount();
    store.failReads({ ok: false, error: { code: 'internal', message: 'the index could not be read' } });
    await save.answer(); // kept: the draft holds the block
    expect(await a.done).toEqual(unconfirmed);
    a.holds(store.doc(), 'earlier words');
    expect(a.lines()).toHaveLength(1);
  });

  it('(i) a departed composer’s kept save with none in its place: the deadline during the read after it is unconfirmed', async () => {
    vi.useFakeTimers();
    const store = draftStore(S);
    store.put(EARLIER);
    const first = mountComposer(S, store.client, { covered: true });
    await first.restored();
    store.hold(SET);
    const a = attach(store);
    await settle();
    const save = store.held(SET)[0]!;
    first.unmount();
    store.hold(GET); // the read after it never answers
    await save.answer();
    await settle();
    expect(store.held(GET)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(attachDeadlineMs(false));
    expect(a.said).toEqual(unconfirmed);
    a.holds(store.doc(), 'earlier words');
  });

  it.each(['answered late', 'lost'] as const)('(ii) a send that carried the block ends added, and the block is not put in again (the write’s reply %s)', async (reply) => {
    const store = draftStore(S);
    store.put(EARLIER);
    store.hold(SET);
    const a = attach(store);
    const write = await heldWrite(store);
    write.land(); // the store keeps the block; its reply is held
    const sends = heldSends();
    const box = mountComposer(S, store.client, { onSubmit: sends.onSubmit });
    await box.restored();
    a.holds(box.editor().doc(), 'earlier words'); // restored with the block
    box.send();
    await waitFor(() => expect(sends.sent).toHaveLength(1));
    await sends.answer(true); // the box is cleared, the block sent with the message
    await write.answer(reply === 'lost' ? TIMEOUT : undefined);
    expect(await a.done).toEqual(added);
    expect(Object.keys(sends.sent[0]!.pastedContents)).toHaveLength(1);
    expect(attachedIn(box.editor().doc())).toEqual([]);
    box.unmount();
    await settle();
    expect(attachedIn(store.doc())).toEqual([]);
    expect(a.lines()).toHaveLength(1);
  });

  it('(iii) an accepted write in a round a composer came and went under stays unaccounted for: a failed read after it is unconfirmed', async () => {
    const store = draftStore(S);
    store.put(EARLIER);
    store.hold(SET);
    const a = attach(store);
    const write = await heldWrite(store);
    const box = mountComposer(S, store.client); // untouched
    await box.restored();
    box.unmount();
    store.failReads({ ok: false, error: { code: 'internal', message: 'the index could not be read' } });
    await write.answer(); // accepted
    expect(await a.done).toEqual(unconfirmed);
    a.holds(store.doc(), 'earlier words');
    expect(a.lines()).toHaveLength(1);
  });

  describe('(vi) a rejected promise of the route', () => {
    it('a read that rejects is a failed read: not added, and nothing written', async () => {
      const store = draftStore(S);
      store.put(EARLIER);
      store.hold(GET);
      const a = attach(store);
      await waitFor(() => expect(store.held(GET)).toHaveLength(1));
      await store.held(GET)[0]!.reject(false);
      expect(await a.done).toEqual(refused('failed'));
      expect(store.writes()).toEqual([]);
      expect(a.lines()).toHaveLength(1);
    });

    it('a write that rejects having landed is found by the next read, and not written again', async () => {
      const store = draftStore(S);
      store.put(EARLIER);
      store.hold(SET);
      const a = attach(store);
      await (await heldWrite(store)).reject(true);
      expect(await a.done).toEqual(added);
      expect(store.writes()).toHaveLength(1);
      a.holds(store.doc(), 'earlier words');
      expect(a.lines()).toHaveLength(1);
    });

    it('a write that rejects with every later read failing is not definite: unconfirmed', async () => {
      const store = draftStore(S);
      store.put(EARLIER);
      store.hold(SET);
      const a = attach(store);
      const write = await heldWrite(store);
      store.failReads({ ok: false, error: { code: 'host_unavailable', message: 'the service is not running' } });
      await write.reject(false);
      expect(await a.done).toEqual(unconfirmed);
      expect(a.lines()).toHaveLength(1);
    });
  });
});
