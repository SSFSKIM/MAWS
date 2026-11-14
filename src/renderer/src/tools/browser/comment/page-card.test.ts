// UX wave U5a (docs/doperpowers/plans/2026-11-12-ux-wave-U5a-comment-card.md, M4, X-216, Interfaces §G): the window
// tells a tab's page that its comment card opened, with the open comment's css, whenever the card shows a composing
// comment of that tab's pass or moves to another; and retires each opening it told with that tab's close, on the store's
// transition, when that card is no longer the window's open card. A call that fails is ignored.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { closeCard, editComment, enterThread, openCard, passKey, registerCardHost, setCommentText, useCommentCard } from '../../../side/card/store';
import { T1, T2 } from '../../../test-support/browser';
import { watchPageCard } from './page-card';

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

  it('tells nothing for a card that is not a browser page’s', () => {
    host('page-1', 'artifact-1', 'artifact-page');
    openCard({ kind: 'artifact-element', locator: '#e1', label: 'h1', pageUrl: 'maws-artifact://artifact-1/1/index.html' }, { appSessionId: A, placement: { kind: 'card', host: 'artifact-page', hostId: 'page-1' } });
    expect(told()).toEqual([]);
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

describe('the card’s closing, retiring the opening told', () => {
  it('tells the page its card closed when the card goes, once', () => {
    pick(FIRST);
    closeCard();
    closeCard();
    expect(told()).toEqual([
      { tabId: T1, open: { css: '#increment' } },
      { tabId: T1, open: null },
    ]);
  });

  it('a move to another comment of the same tab is the new opening only; the last close retires it', () => {
    pick(FIRST);
    pick(SECOND);
    closeCard();
    expect(told()).toEqual([
      { tabId: T1, open: { css: '#increment' } },
      { tabId: T1, open: { css: '#decrement' } },
      { tabId: T1, open: null },
    ]);
  });

  it('a card replaced by another tab’s tells the first tab’s page its card closed, then the second its opening', () => {
    host('dock-2', T2);
    pick(FIRST);
    pick(SECOND, 'dock-2');
    closeCard();
    expect(told()).toEqual([
      { tabId: T1, open: { css: '#increment' } },
      { tabId: T1, open: null },
      { tabId: T2, open: { css: '#decrement' } },
      { tabId: T2, open: null },
    ]);
  });

  it('the card turning into its side thread is the same card, still open in the strip: the page is told its close when it goes', () => {
    pick(FIRST);
    enterThread(useCommentCard.getState().open!.serial, 'app-child' as AppSessionId, 'Make it bolder');
    expect(told()).toEqual([{ tabId: T1, open: { css: '#increment' } }]);
    closeCard();
    expect(told().at(-1)).toEqual({ tabId: T1, open: null });
  });

  it('a card replaced by one that is not a browser page’s retires the opening told', () => {
    pick(FIRST);
    host('page-1', 'artifact-1', 'artifact-page');
    openCard({ kind: 'artifact-element', locator: '#e1', label: 'h1', pageUrl: 'maws-artifact://artifact-1/1/index.html' }, { appSessionId: A, placement: { kind: 'card', host: 'artifact-page', hostId: 'page-1' } });
    expect(told().at(-1)).toEqual({ tabId: T1, open: null });
  });

  it('ignores a call that fails (the tab closed)', async () => {
    unwatch();
    const failing = fakeClient();
    unwatch = watchPageCard(failing.client);
    pick(FIRST);
    await expect(failing.fail('browser.comment.card', 'unknown browser tab', 'invalid_input')).resolves.toBeUndefined();
  });
});
