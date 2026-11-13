// P2-E1 (M1): the comment card's store (P2-E1 document, D3): one card per window, the latest open winning; a card's
// target from its anchor; a card opened for a host instance is that host's, and one opened without (the re-dock) is
// claimed once, by the first host that accepts it, or closed when nobody has claimed it after CLAIM_DEADLINE_MS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { deliverableUrl } from '@shared/maws/deliverable';
import { artifactUrl } from '@shared/artifacts/scheme'; // P3-L (M5b)
import { fileLineAnchor } from '../../tools/code/anchor/anchor';
import { laneAState } from '../../lane-a/test-support/lane-a-state';
import { applyLaneAState, dismissPendingSend, holdPendingSend, resetLaneAStore } from '../../stores/lane-a';
import { CLAIM_DEADLINE_MS, cardGone, claimCard, closeCard, discardComment, dropSession, dropSubject, flightRefused, launchFlight, leaveCard, notePlace, openCard, passKey, placeNoteOf, registerCardHost, resetPlaceNotes, SENT_NOTE_MS, setCommentText, setPassToMain, targetOf, useCommentCard } from './store';

const PARENT = 'a1111111-1111-4111-8111-111111111111' as AppSessionId;
const RECORD = '00000000-0000-4000-8000-000000000001';
const ANCHOR: Anchor = { kind: 'artifact-element', locator: '#hero', label: 'Dashboard v2 › h1#hero', pageUrl: artifactUrl(RECORD, 14, 'index.html') };
const LEGACY: Anchor = { ...ANCHOR, pageUrl: deliverableUrl(PARENT, RECORD, 2) }; // stored before P3-L's cutover
const RECT = { x: 10, y: 20, width: 100, height: 30 };

const open = () => useCommentCard.getState().open;

beforeEach(() => useCommentCard.setState({ open: null }));
afterEach(() => vi.useRealTimers());

describe('targetOf', () => {
  // P3-L (M6b; Decision Log 4): an anchor stored before the cutover names E2's `maws-deliverable://<id>/<app>/<n>`: the
  // record's id is the artifact's, n its n-th version by revision (place n, never revision n), its host the artifact's
  it('reads a legacy deliverable page into its artifact and the place of its version; any other anchor names none', () => {
    expect(targetOf(LEGACY)).toEqual({ kind: 'artifact-page', artifactId: RECORD, revision: null, version: 2 });
    openCard(LEGACY, { appSessionId: PARENT });
    expect(open()?.host).toBe('artifact-page');
    expect(targetOf({ ...ANCHOR, pageUrl: 'https://example.com/' })).toBeNull();
    expect(targetOf({ ...ANCHOR, pageUrl: 'maws-deliverable://not-a-record/App-1/2' })).toBeNull();
    expect(targetOf(fileLineAnchor('/r/x.ts', 3))).toBeNull();
  });

  // P3-L (M5b, Decision Log 10): a page on the artifact store's scheme is the `artifact-page` host's
  it('reads an artifact store page into its artifact and revision, and its card is the artifact-page host’s', () => {
    const page: Anchor = { ...ANCHOR, pageUrl: artifactUrl(RECORD, 14, 'index.html') };
    expect(targetOf(page)).toEqual({ kind: 'artifact-page', artifactId: RECORD, revision: 14 });
    expect(targetOf({ ...page, pageUrl: 'maws-artifact://not-an-id/14/index.html' })).toBeNull();
    openCard(page, { appSessionId: PARENT });
    expect(open()?.host).toBe('artifact-page');
    expect(open()?.target).toEqual({ kind: 'artifact-page', artifactId: RECORD, revision: 14 });
  });

  // P2-E2: a page element names its page; a card opened from it with no placement is the browser's
  it('reads a browser element’s page as a browser target, and its card is the browser host’s', () => {
    const page: Anchor = { kind: 'browser-element', locator: '#increment', label: 'button “Increment”', pageUrl: 'http://127.0.0.1:4000/comment.html', css: '#increment' };
    expect(targetOf(page)).toEqual({ kind: 'browser', pageUrl: 'http://127.0.0.1:4000/comment.html' });
    expect(targetOf({ ...page, pageUrl: undefined })).toBeNull();
    openCard(page, { appSessionId: PARENT, placement: { kind: 'card', host: 'browser', hostId: 'pane-1' } });
    expect(open()).toMatchObject({ host: 'browser', hostId: 'pane-1', rect: null, target: { kind: 'browser' } });
  });
});

// P3-B (docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D9): a comment on a document's passage names the artifact
// and its thread; its card is the artifact host's, as the editor's placement says or, re-docked, by the target's kind
describe('the artifact target (P3-B)', () => {
  const comment: Anchor = { kind: 'artifact-comment', locator: 'ships quarterly', label: 'Q3 plan, Main', artifactId: 'art-1', threadId: 'k2m9x0qa' };

  it('reads an artifact-comment anchor into its artifact and thread; without both ids it names none', () => {
    expect(targetOf(comment)).toEqual({ kind: 'artifact', artifactId: 'art-1', threadId: 'k2m9x0qa' });
    expect(targetOf({ ...comment, threadId: undefined })).toBeNull();
    expect(targetOf({ ...comment, artifactId: undefined })).toBeNull();
  });

  it('opens the card for the editor that commented, and an unplaced one for the artifact host kind', () => {
    openCard(comment, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact', hostId: 'doc-host-1' } });
    expect(open()).toMatchObject({ host: 'artifact', hostId: 'doc-host-1', anchor: comment, target: { kind: 'artifact', artifactId: 'art-1', threadId: 'k2m9x0qa' }, phase: { kind: 'composing' } });
    openCard(comment, { appSessionId: PARENT, claimMode: 'panel' });
    expect(open()).toMatchObject({ host: 'artifact', hostId: null, claimMode: 'panel' });
  });
});

describe('the one card', () => {
  it('opens composing for the host that picked, with the pick’s rect; a second open replaces it', () => {
    openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact-page', hostId: 'h1', rect: RECT } });
    const first = open()!;
    expect(first).toMatchObject({ parent: PARENT, anchor: ANCHOR, host: 'artifact-page', hostId: 'h1', claimMode: null, rect: RECT, phase: { kind: 'composing' } });
    expect(first.target).toEqual(targetOf(ANCHOR));
    openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact-page', hostId: 'h2' } });
    expect(open()!.serial).not.toBe(first.serial);
    expect(open()).toMatchObject({ hostId: 'h2', rect: null });
    expect(cardGone(first.serial)).toBe(true);
    expect(cardGone(open()!.serial)).toBe(false);
  });

  it('closeCard with a serial closes that card alone', () => {
    openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact-page', hostId: 'h1' } });
    const first = open()!.serial;
    openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact-page', hostId: 'h1' } });
    closeCard(first);
    expect(open()).not.toBeNull();
    closeCard();
    expect(open()).toBeNull();
  });
});

describe('an unhosted card', () => {
  const redock = () => openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact-page' }, claimMode: 'panel' });

  it('is claimed by the first host only', () => {
    redock();
    const { serial } = open()!;
    expect(open()).toMatchObject({ hostId: null, claimMode: 'panel' });
    expect(claimCard(serial, 'h1')).toBe(true);
    expect(claimCard(serial, 'h2')).toBe(false);
    expect(claimCard(serial, 'h1')).toBe(true); // its own claim again (StrictMode's replay)
    expect(open()!.hostId).toBe('h1');
    expect(claimCard(serial + 1, 'h1')).toBe(false); // not the open card
  });

  it('closes when nobody has claimed it after the deadline; a claimed one stays', () => {
    vi.useFakeTimers();
    redock();
    vi.advanceTimersByTime(CLAIM_DEADLINE_MS - 1);
    expect(open()).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(open()).toBeNull();

    redock();
    claimCard(open()!.serial, 'h1');
    vi.advanceTimersByTime(CLAIM_DEADLINE_MS);
    expect(open()).toMatchObject({ hostId: 'h1' });
  });

  it('the deadline of a replaced card leaves its successor alone', () => {
    vi.useFakeTimers();
    redock();
    vi.advanceTimersByTime(CLAIM_DEADLINE_MS / 2);
    redock();
    vi.advanceTimersByTime(CLAIM_DEADLINE_MS / 2);
    expect(open()).not.toBeNull();
  });
});

// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, §C and decision 8): the line a host draws
// in its card's place after a send to the main conversation, by the place it belongs to
describe('the place’s note', () => {
  const KEY = { writer: 'maws/m', seq: 4 };
  const AT = '2026-11-12T10:00:00.000Z';
  const note = (place: string) => useCommentCard.getState().notes.get(place) ?? null;
  const pending = { kind: 'pending', appSessionId: PARENT, key: KEY, title: 'Q3 plan' } as const;

  beforeEach(() => {
    resetPlaceNotes();
    resetLaneAStore();
  });

  it('a sent line leaves after SENT_NOTE_MS; a newer line at the place is not taken by the older one’s timer', () => {
    vi.useFakeTimers();
    notePlace('h1', { kind: 'sent', text: 'Sent to Q3 plan', at: Date.now() });
    vi.advanceTimersByTime(SENT_NOTE_MS - 1);
    expect(note('h1')).toMatchObject({ kind: 'sent', text: 'Sent to Q3 plan' });
    notePlace('h1', { kind: 'sent', text: 'Sent to Q4 plan', at: Date.now() });
    vi.advanceTimersByTime(1);
    expect(note('h1')).toMatchObject({ text: 'Sent to Q4 plan' });
    vi.advanceTimersByTime(SENT_NOTE_MS);
    expect(note('h1')).toBeNull();
    expect(SENT_NOTE_MS).toBe(4_000);
  });

  it('a pending line follows its pending send by key: it stays through every fate but entry, then is the sent line', () => {
    vi.useFakeTimers();
    holdPendingSend(PARENT, KEY, 'the words');
    notePlace('h1', pending);
    vi.advanceTimersByTime(60_000);
    expect(note('h1')).toEqual(pending); // never leaves by itself
    applyLaneAState(PARENT, laneAState(PARENT, { deliveries: [{ key: KEY, at: AT, state: 'refused', reason: 'too busy' }] }));
    expect(note('h1')).toEqual(pending);
    applyLaneAState(PARENT, laneAState(PARENT, { deliveries: [{ key: KEY, at: AT, state: 'entered' }] }));
    expect(note('h1')).toMatchObject({ kind: 'sent', text: 'Sent to Q3 plan' });
    vi.advanceTimersByTime(SENT_NOTE_MS);
    expect(note('h1')).toBeNull();
  });

  it('a pending line leaves with its pending send when the person dismisses or resends it, and follows no other key', () => {
    const other = { writer: 'maws/m', seq: 3 };
    holdPendingSend(PARENT, other, 'the words'); // the same text, an older send
    holdPendingSend(PARENT, KEY, 'the words');
    notePlace('h1', pending);
    dismissPendingSend(PARENT, other);
    applyLaneAState(PARENT, laneAState(PARENT, { deliveries: [{ key: other, at: AT, state: 'entered' }] }));
    expect(note('h1')).toEqual(pending);
    dismissPendingSend(PARENT, KEY);
    expect(note('h1')).toBeNull();
  });

  // M3's review, finding 3: a place's line is the newest set for its subject, a key set again counting as new
  it('draws the newest line of a subject: A, then B, then A again draws A’s, a durable pending one included', () => {
    const other = 'b2222222-2222-4222-8222-222222222222' as AppSessionId;
    const a = passKey('browser', 'tab-1', PARENT);
    const b = passKey('browser', 'tab-1', other);
    const key = { writer: 'maws/m', seq: 7 };
    applyLaneAState(PARENT, laneAState(PARENT));
    holdPendingSend(PARENT, key, 'the words');
    const drawn = () => placeNoteOf(useCommentCard.getState().notes, 'browser', 'tab-1');
    notePlace(a, { kind: 'pending', appSessionId: PARENT, key, title: 'Q3 plan' });
    notePlace(b, { kind: 'sent', text: 'Sent to B', at: Date.now() });
    expect(drawn()).toMatchObject({ kind: 'sent', text: 'Sent to B' });
    notePlace(a, { kind: 'pending', appSessionId: PARENT, key, title: 'Q3 plan' });
    expect(drawn()).toMatchObject({ kind: 'pending', appSessionId: PARENT });
    notePlace(b, { kind: 'sent', text: 'Sent to B again', at: Date.now() });
    expect(drawn()).toMatchObject({ text: 'Sent to B again' });
    notePlace(a, { kind: 'sent', text: 'Sent to A', at: Date.now() });
    expect(drawn()).toMatchObject({ text: 'Sent to A' });
  });

  it('a pending send whose words entered before its line was set makes the line the sent one at once', () => {
    holdPendingSend(PARENT, KEY, 'the words');
    applyLaneAState(PARENT, laneAState(PARENT, { deliveries: [{ key: KEY, at: AT, state: 'entered' }] }));
    notePlace('h1', pending);
    expect(note('h1')).toMatchObject({ kind: 'sent', text: 'Sent to Q3 plan' });
  });
});

// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M3; §C): the pass. A composing open adds a
// comment to the pass of its host's subject; a host that keeps one unsent comment returns the person to it; a card that
// goes leaves its comment unless nothing is typed in it; a subject or a session that ends takes its passes with it.
describe('the pass', () => {
  const doc = (threadId: string): Anchor => ({ kind: 'artifact-comment', locator: 'ships quarterly', label: 'Q3 plan', artifactId: 'art-1', threadId });
  const docKey = passKey('artifact', 'art-1', PARENT);
  const offs: (() => void)[] = [];
  const host = (hostId: string, holds: 'one' | 'many', subject = 'art-1') => offs.push(registerCardHost(hostId, { kind: holds === 'one' ? 'artifact' : 'artifact-page', subject, holds }));
  beforeEach(() => resetPlaceNotes());
  afterEach(() => offs.splice(0).forEach((off) => off()));
  const texts = (key: string) => useCommentCard.getState().passes.get(key)?.comments.map((c) => c.text) ?? null;
  const editingNow = () => {
    const phase = open()?.phase;
    return phase?.kind === 'composing' ? phase.comment : null;
  };

  it('a `one` host with an unsent comment that has text opens the card on it and adds nothing; one with nothing typed is replaced', () => {
    host('d1', 'one');
    openCard(doc('t1'), { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact', hostId: 'd1' } });
    const first = editingNow();
    openCard(doc('t2'), { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact', hostId: 'd1' } });
    expect(texts(docKey), 'nothing typed in the first: the second takes its place').toEqual(['']);
    expect(editingNow()).not.toBe(first);
    setCommentText(docKey, editingNow()!, 'Monthly?');
    const typed = editingNow();
    closeCard();
    openCard(doc('t3'), { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact', hostId: 'd1' } });
    expect(texts(docKey)).toEqual(['Monthly?']);
    expect(editingNow()).toBe(typed);
  });

  it('a `many` host’s pass grows; the card that goes keeps a comment with text and drops one without', () => {
    host('p1', 'many', RECORD);
    const key = passKey('artifact-page', RECORD, PARENT);
    openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact-page', hostId: 'p1', rect: RECT } });
    setCommentText(key, editingNow()!, 'Bolder');
    openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact-page', hostId: 'p1', rect: RECT } });
    expect(texts(key)).toEqual(['Bolder', '']);
    leaveCard();
    expect(open()).toBeNull();
    expect(texts(key)).toEqual(['Bolder']);
    expect(useCommentCard.getState().passes.get(key)?.comments[0]?.rect).toEqual(RECT);
  });

  it('starts the checkbox at the surface’s default, and moves only by the pass', () => {
    host('p1', 'many', RECORD);
    const key = passKey('artifact-page', RECORD, PARENT);
    openCard(ANCHOR, { appSessionId: PARENT, destination: 'main', placement: { kind: 'card', host: 'artifact-page', hostId: 'p1' } });
    expect(useCommentCard.getState().passes.get(key)?.toMain).toBe(true);
    setPassToMain(key, false);
    expect(useCommentCard.getState().passes.get(key)?.toMain).toBe(false);
  });

  it('a subject that ends, or a session, ends its passes and the card on them; another subject’s stays', () => {
    host('p1', 'many', RECORD);
    host('p2', 'many', 'other-record');
    const key = passKey('artifact-page', RECORD, PARENT);
    const other = passKey('artifact-page', 'other-record', PARENT);
    openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact-page', hostId: 'p2' } });
    setCommentText(other, editingNow()!, 'Elsewhere');
    openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact-page', hostId: 'p1' } });
    setCommentText(key, editingNow()!, 'Bolder');
    dropSubject('artifact-page', RECORD);
    expect(texts(key)).toBeNull();
    expect(open()).toBeNull();
    expect(texts(other)).toEqual(['Elsewhere']);
    dropSession(PARENT);
    expect(texts(other)).toBeNull();
  });

  it('the person’s discard tells the pass’s mounted host; a comment in flight cannot be discarded', () => {
    const discarded: string[] = [];
    offs.push(registerCardHost('p1', { kind: 'artifact-page', subject: RECORD, holds: 'many', discarded: (c) => discarded.push(c.text) }));
    const key = passKey('artifact-page', RECORD, PARENT);
    openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact-page', hostId: 'p1' } });
    const first = editingNow()!;
    setCommentText(key, first, 'Bolder');
    openCard(ANCHOR, { appSessionId: PARENT, placement: { kind: 'card', host: 'artifact-page', hostId: 'p1' } });
    setCommentText(key, editingNow()!, 'Left');
    const flight = launchFlight(key)!;
    expect(flight.comments.map((c) => c.text)).toEqual(['Bolder', 'Left']);
    expect(launchFlight(key), 'one flight per pass').toBeNull();
    discardComment(key, first);
    expect(texts(key)).toEqual(['Bolder', 'Left']);
    flightRefused(flight, 'no');
    discardComment(key, first);
    expect(texts(key)).toEqual(['Left']);
    expect(discarded).toEqual(['Bolder']);
  });
});
