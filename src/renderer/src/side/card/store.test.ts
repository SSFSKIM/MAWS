// P2-E1 (M1): the comment card's store (P2-E1 document, D3): one card per window, the latest open winning; a card's
// target from its anchor; a card opened for a host instance is that host's, and one opened without (the re-dock) is
// claimed once, by the first host that accepts it, or closed when nobody has claimed it after CLAIM_DEADLINE_MS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { deliverableUrl } from '@shared/maws/deliverable';
import { artifactUrl } from '@shared/artifacts/scheme'; // P3-L (M5b)
import { fileLineAnchor } from '../../tools/code/anchor/anchor';
import { CLAIM_DEADLINE_MS, cardGone, claimCard, closeCard, openCard, targetOf, useCommentCard } from './store';

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
