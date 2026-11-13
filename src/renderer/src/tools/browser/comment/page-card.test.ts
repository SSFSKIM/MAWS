// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M4, X-216, Interfaces §G): the window
// tells a tab's page that its comment card opened, with the open comment's css, whenever the card shows a composing
// comment of that tab's pass or moves to another; and, from the dock's `onClosed`, that it closed, unless the window's
// card still composes on that tab's page. A call that fails is ignored.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { closeCard, editComment, openCard, passKey, registerCardHost, setCommentText, useCommentCard } from '../../../side/card/store';
import { T1, T2 } from '../../../test-support/browser';
import { tellPageCardClosed, watchPageCard } from './page-card';

const A = 'app-a' as AppSessionId;
const element = (css: string): Anchor => ({ kind: 'browser-element', locator: css, label: `button “${css}”`, pageUrl: 'http://127.0.0.1:4000/comment.html', css, role: 'button', name: css });
const FIRST = element('#increment');
const SECOND = element('#decrement');

let fake: FakeClient;
let unwatch: () => void;
const offs: (() => void)[] = [];
const host = (hostId: string, subject: string, kind: 'browser' | 'artifact-page' = 'browser') => offs.push(registerCardHost(hostId, { kind, subject, holds: 'many' }));
const pick = (anchor: Anchor, hostId = 'dock-1') => openCard(anchor, { appSessionId: A, placement: { kind: 'card', host: 'browser', hostId } });
const told = () => fake.invoked('browser.comment.card');

beforeEach(() => {
  useCommentCard.setState({ open: null, passes: new Map(), notes: new Map() });
  fake = fakeClient({ 'browser.comment.card': undefined });
  unwatch = watchPageCard(fake.client);
  host('dock-1', T1);
});
afterEach(() => {
  unwatch();
  offs.splice(0).forEach((off) => off());
  useCommentCard.setState({ open: null, passes: new Map(), notes: new Map() });
});

describe('the card’s opening, told to its tab’s page', () => {
  it('tells the page the open comment’s css when the card opens on it, once however the text changes', () => {
    pick(FIRST);
    const { open } = useCommentCard.getState();
    if (open?.phase.kind === 'composing') setCommentText(open.phase.pass, open.phase.comment, 'Make it bolder');
    expect(told()).toEqual([{ tabId: T1, open: { css: '#increment' } }]);
  });

  it('tells it again when the card moves to another comment of the pass, and back', () => {
    pick(FIRST);
    const first = useCommentCard.getState().open!;
    if (first.phase.kind === 'composing') setCommentText(first.phase.pass, first.phase.comment, 'Make it bolder'); // kept in the pass
    pick(SECOND);
    const [kept] = useCommentCard.getState().passes.get(passKey('browser', T1, A))!.comments;
    editComment(passKey('browser', T1, A), kept!.id);
    expect(told()).toEqual([
      { tabId: T1, open: { css: '#increment' } },
      { tabId: T1, open: { css: '#decrement' } },
      { tabId: T1, open: { css: '#increment' } },
    ]);
  });

  it('tells nothing when the card closes (the dock’s onClosed says that), nor for a card that is not a browser page’s', () => {
    pick(FIRST);
    closeCard();
    host('page-1', 'artifact-1', 'artifact-page');
    openCard({ kind: 'artifact-element', locator: '#e1', label: 'h1', pageUrl: 'maws-artifact://artifact-1/1/index.html' }, { appSessionId: A, placement: { kind: 'card', host: 'artifact-page', hostId: 'page-1' } });
    expect(told()).toEqual([{ tabId: T1, open: { css: '#increment' } }]);
  });

  it('tells nothing for a browser comment with no css', () => {
    pick({ kind: 'browser-element', locator: '#increment', label: 'button “Increment”', pageUrl: FIRST.pageUrl });
    expect(told()).toEqual([]);
  });

  it('stops when unwatched', () => {
    unwatch();
    pick(FIRST);
    expect(told()).toEqual([]);
  });
});

describe('the card’s closing, from the dock’s onClosed', () => {
  it('tells the page its card closed when no card composes on it', () => {
    pick(FIRST);
    closeCard();
    tellPageCardClosed(T1, fake.client);
    expect(told().at(-1)).toEqual({ tabId: T1, open: null });
  });

  it('tells nothing while the window’s card still composes on that tab’s page (it moved to another comment)', () => {
    pick(FIRST);
    pick(SECOND); // the host lost the first card: its onClosed asks after the second opened
    tellPageCardClosed(T1, fake.client);
    expect(told()).toEqual([
      { tabId: T1, open: { css: '#increment' } },
      { tabId: T1, open: { css: '#decrement' } },
    ]);
  });

  it('tells the page its card closed when the card still open is no mounted host’s (the dock unmounted before its card left)', () => {
    pick(FIRST);
    offs.splice(0).forEach((off) => off());
    tellPageCardClosed(T1, fake.client);
    expect(told().at(-1)).toEqual({ tabId: T1, open: null });
  });

  it('tells a tab’s page its card closed while the window’s card composes on another tab', () => {
    host('dock-2', T2);
    pick(FIRST, 'dock-2');
    tellPageCardClosed(T1, fake.client);
    expect(told().at(-1)).toEqual({ tabId: T1, open: null });
  });

  it('ignores a call that fails (the tab closed)', async () => {
    const failing = fakeClient();
    tellPageCardClosed(T1, failing.client);
    await expect(failing.fail('browser.comment.card', 'unknown browser tab', 'invalid_input')).resolves.toBeUndefined();
  });
});
