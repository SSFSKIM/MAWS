// "Attach selection to chat" for a session on another machine (UX wave U6b-5a, M2; S1 and decision 33; findings 3 and 4
// and the re-check): the document a round appends to is the newest this window holds that the machine has not taken
// (`unsavedRemoteDraft`), else what the machine answered; the revision it names is always the machine's answer in that
// round; the write goes once, in the session's order (`saveRemoteDraftOnce`); and the last read is judged on the
// machine's own answer, only with no save of the session still out. A send that outlives its composer is followed
// through the real remote queue (`lane-b/remote-drafts.ts`).
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { Draft } from '@shared/ipc/schema/session';
import { addressOf } from '@shared/machine/address';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { heardReaderRows, resetReaderRows } from '../lane-b/reader-rows';
import { REMOTE_DRAFT_RETRY_MS, unsavedRemoteDraft } from '../lane-b/remote-drafts';
import { resetRemoteLaneBStore, useRemoteLaneB } from '../lane-b/remote-session';
import { resetCatalogStore } from '../stores/catalog';
import { resetComposerStore } from '../stores/composer';
import { attachedIn, attachOf, draftStore, heldSends, holdsOnce, mountComposer, NOT_OFFERED, settle, staleRounds, textOf, TIMEOUT, type DraftStoreFake } from '../test-support/attach';
import { ATTACH_ROUNDS, type AttachOutcome } from './attach-pasted';
import { forgetSubmissions, ipcDrafts } from './editor/controller';
import { docOf, paragraph, textNode, type ComposerDoc } from './editor/doc';
import { rememberingRemoteDrafts, resetRemoteDrafts } from './editor/drafts';

const R = addressOf(OTHER_MACHINE, 'app-attach-there' as AppSessionId);
const R2 = addressOf(OTHER_MACHINE, 'app-attach-there-too' as AppSessionId);
const SET = 'session.drafts.set' as const;
const GET = 'session.drafts.get' as const;
const EARLIER = docOf([paragraph(textNode('earlier words'))]);
const TYPED = ' typed words';
const added: AttachOutcome = { kind: 'added' };
const unconfirmed: AttachOutcome = { kind: 'unconfirmed' };
const refused = (why: Extract<AttachOutcome, { kind: 'refused' }>['why']): AttachOutcome => ({ kind: 'refused', why });
const attach = (store: DraftStoreFake, session: AppSessionId = R) => attachOf(store, session);
const over = (session: AppSessionId = R, rule?: 'this-build' | 'build-f') => draftStore(session, { overLink: true, ...(rule && { rule }) });
const lastWritten = (store: DraftStoreFake) => (store.writes().at(-1)!.draft as Draft).doc as ComposerDoc;
const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

beforeEach(() => {
  resetComposerStore();
  resetCatalogStore();
  resetRemoteDrafts();
  resetReaderRows();
  useRemoteLaneB.setState({ states: new Map([[R, {} as never], [R2, {} as never]]) }); // lane B sessions on another machine
});
afterEach(() => {
  cleanup();
  forgetSubmissions();
  resetRemoteLaneBStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a session on another machine (finding 4)', () => {
  it.each(['this-build', 'build-f'] as const)('with a draft never written there, names none and is taken (a store of %s)', async (rule) => {
    const store = over(R, rule);
    expect(await attach(store).done).toEqual(added);
    expect(store.writes().map((write) => write.replaces)).toEqual([null]);
    holdsOnce(store.doc());
  });

  it('after an ordinary save that failed, appends to the window’s newer document, names the machine’s revision, and retires that save', async () => {
    fakeClock();
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // the queue says it was not kept, as it does
    const store = over();
    store.put(EARLIER);
    const kept = store.revision();
    const port = rememberingRemoteDrafts(ipcDrafts(store.client, R), R, () => true, store.client);
    store.hold(SET);
    void port.save({ doc: docOf([paragraph(textNode('newer words'))]), attachments: [], updatedAt: '2026-11-17T10:30:00.000Z' });
    await settle();
    await store.held(SET)[0]!.answer(TIMEOUT); // not taken there: the window holds the newer document, and will send it again
    expect(unsavedRemoteDraft(R)).not.toBeUndefined();
    const a = attach(store);
    await settle();
    expect(await a.done).toEqual(added);
    const ours = store.writes().at(-1)!;
    expect(ours.replaces).toBe(kept);
    holdsOnce(store.doc(), 'newer words');
    await vi.advanceTimersByTimeAsync(REMOTE_DRAFT_RETRY_MS * 2);
    expect(store.writes()).toHaveLength(2); // the failed save is not sent again after it
    holdsOnce(store.doc(), 'newer words');
  });

  it('after a stale answer asks the machine again in the next round, one read a round', async () => {
    const store = over();
    store.put(EARLIER);
    let device: string | null = null;
    store.afterNextRead(() => {
      store.put(docOf([paragraph(textNode('from another device'))]));
      device = store.revision();
    });
    expect(await attach(store).done).toEqual(added);
    expect(store.reads()).toBe(2);
    expect(store.writes()).toHaveLength(2);
    expect(store.writes()[1]!.replaces).toBe(device); // what the machine answered in that round, not this window's memory
    holdsOnce(store.doc(), 'from another device');
  });

  it('a machine that keeps no drafts for this member is no-store, with nothing sent; the control is taken', async () => {
    const store = over();
    heardReaderRows(R, NOT_OFFERED as never);
    expect(await attach(store).done).toEqual(refused('no-store'));
    expect(store.reads()).toBe(0);
    expect(store.writes()).toEqual([]);
    resetReaderRows();
    expect(await attach(store).done).toEqual(added);
    const refusing = over(R2);
    refusing.refuseDrafts(); // learnt from the read itself
    expect(await attach(refusing, R2).done).toEqual(refused('no-store'));
    expect(refusing.writes()).toEqual([]);
  });

  it('a machine that does not answer is unreachable', async () => {
    const store = over();
    store.failReads({ ok: false, error: { code: 'host_unavailable', message: 'the machine is offline' } });
    expect(await attach(store).done).toEqual(refused('unreachable'));
    expect(store.writes()).toEqual([]);
  });
});

// The re-check: only the machine's own answer, with no save of the session still out, says the block is not there.
describe('the last read on another machine', () => {
  it('shows the block another device kept saving between this window’s reads: added', async () => {
    const store = over();
    store.put(EARLIER);
    staleRounds(store, ATTACH_ROUNDS, (round) => {
      if (round === ATTACH_ROUNDS) store.put(lastWritten(store)); // the device's revision holds the block
    });
    expect(await attach(store).done).toEqual(added);
    expect(store.writes()).toHaveLength(ATTACH_ROUNDS);
    holdsOnce(store.doc());
  });

  it('with a clear still out in this window’s queue is unconfirmed, never changed; the control, with none out, is changed', async () => {
    fakeClock();
    const store = over();
    store.put(EARLIER);
    const port = rememberingRemoteDrafts(ipcDrafts(store.client, R), R, () => true, store.client);
    store.hold(SET);
    void port.save(null);
    await settle();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await store.held(SET)[0]!.answer(TIMEOUT); // the clear is still out: not taken, to go again
    expect(unsavedRemoteDraft(R)).toBeNull();
    staleRounds(store, ATTACH_ROUNDS, (round) => {
      if (round === ATTACH_ROUNDS) store.put(lastWritten(store)); // the machine's document holds the block
    });
    const a = attach(store);
    await settle();
    await settle();
    expect(await a.done).toEqual(unconfirmed);
    expect(attachedIn(store.doc())).toHaveLength(1);

    const control = over(R2);
    control.put(EARLIER);
    staleRounds(control, ATTACH_ROUNDS);
    const b = attach(control, R2);
    await settle();
    expect(await b.done).toEqual(refused('changed'));
    expect(attachedIn(control.doc())).toEqual([]);
  });
});

// The re-check: a send that outlives its composer, through the real queue. The send's answer and the save it makes when
// it settles are held apart; that save taken at once, answered timeout and landing late, or answered timeout and sent
// again by the queue. The assertions are made after every save still out and every resend has been released.
describe('a send that outlives its composer, on another machine', () => {
  const cases = (['taken', 'late', 'resent'] as const).flatMap((fate) => [
    ['accepted', true, fate] as const,
    ['refused', false, fate] as const,
  ]);
  it.each(cases)('%s, its save %s', async (_how, accepted, fate) => {
    fakeClock();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = over();
    store.put(EARLIER);
    store.hold(SET);
    const a = attach(store);
    await settle();
    const write = store.held(SET)[0]!;
    const sends = heldSends();
    const box = mountComposer(R, store.client, { overLink: true, onSubmit: sends.onSubmit });
    await box.restored();
    await box.type(TYPED);
    box.send();
    expect(sends.sent).toHaveLength(1);
    box.unmount();
    await write.answer(); // taken there; a composer came, and a send is in flight
    await settle();
    expect(a.said).toBeNull();
    expect(a.lines()).toEqual([]);
    store.hold(SET); // the save the send makes when it settles
    if (fate === 'resent') store.hold(GET); // the next round's read, answered after the queue has sent the save again
    await sends.answer(accepted);
    const save = store.held(SET)[1]!;
    expect((save.input as { draft: Draft | null }).draft === null).toBe(accepted);
    if (fate === 'taken') await save.answer();
    else await save.answer(TIMEOUT);
    if (fate === 'resent') {
      await vi.advanceTimersByTimeAsync(REMOTE_DRAFT_RETRY_MS);
      await settle();
      await store.held(GET)[0]!.answer();
    }
    await settle();
    await settle();
    expect(await a.done).toEqual(added);
    if (fate === 'late') save.land(); // it lands after all, on top of what is kept by then
    await vi.advanceTimersByTimeAsync(REMOTE_DRAFT_RETRY_MS * 4); // every resend the queue still had
    expect(a.lines()).toHaveLength(1);
    if (accepted) {
      a.holds(store.doc());
      expect(textOf(store.doc())).not.toContain('typed words');
    } else a.holds(store.doc(), 'earlier words', TYPED);
  });
});

// The branch panel's fix wave, G1 (scalpel-2#5): a box over the link says its save was kept only once the machine took it.
describe('a box over the link that saves at once', () => {
  it.each(['takes it', 'does not take it'] as const)('says nothing before the machine answers, then what it answered (the machine %s)', async (machine) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // the queue says a save was not kept, as it does
    const store = over();
    store.put(EARLIER);
    const box = mountComposer(R, store.client, { overLink: true, covered: true });
    await box.restored();
    store.hold(SET);
    const a = attach(store);
    await waitFor(() => expect(store.held(SET)).toHaveLength(1));
    await settle();
    expect(a.said).toBeNull();
    expect(a.lines()).toEqual([]);
    await store.held(SET)[0]!.answer(machine === 'takes it' ? undefined : { ok: false, error: { code: 'host_unavailable', message: 'the machine is offline' } });
    expect(await a.done).toEqual(machine === 'takes it' ? added : refused('unsaved'));
    expect(a.lines()).toHaveLength(1);
    box.unmount();
  });
});

