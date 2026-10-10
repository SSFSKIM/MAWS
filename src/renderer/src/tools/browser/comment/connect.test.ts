// E4d (Task 3.2): what this window does with main's comment-mode events (E4d execution document, Design §6 and §8): a
// `changed` moves the toggle's store and a refused pick says the element could not be named; a `picked` opens E3's
// comment composer through E5's seam on the anchor main built, for the tab's session, and says when the crop is missing.
// With no sheet over the page, what a refused or unavailable arm says is a line in the tab's chrome, never a toast: the
// toast viewport covers a panel's page, which would freeze it to a still picture (Decision Log 35).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { useNotices } from '../../../stores/notices';
import { browserTab, T1, T2, T3 } from '../../../test-support/browser';
import { registerCommentComposer } from '../../code/anchor/anchor';
import { noticeText } from '../chrome/Notices';
import { browser, resetBrowser } from '../store';
import { connectBrowserComment } from './connect';
import { COMMENT_COPY } from './copy';
import { registerDock } from './dock';
import { resetCommentMode, useCommentMode } from './store';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const ANCHOR: Anchor = {
  kind: 'browser-element',
  locator: '#increment',
  label: 'button “Increment”',
  pageUrl: 'http://127.0.0.1:4000/comment.html',
  screenshot: { path: '/u/browser/crops/b_000000000001-1-abcd.png', width: 192, height: 60 },
  css: '#increment',
  role: 'button',
  name: 'Increment',
  a11y: 'main > region “A form” > button “Increment”',
  box: { x: 248, y: 312, width: 96, height: 30 },
};

let fake: FakeClient;
let disconnect: () => void;
let unregister: () => void;
const opened = vi.fn();
const toasts = () => useNotices.getState().notices.filter((n) => n.kind === 'toast').map((n) => [n.level, n.text]);
const armed = () => [...useCommentMode.getState().armed];
const notices = () => browser.getState().notices.map(({ appSessionId, tabId, kind }) => ({ appSessionId, tabId, kind }));

beforeEach(() => {
  resetCommentMode();
  resetBrowser();
  browser.setState({
    sessions: new Map([
      [A, { tabs: [browserTab(T1, A)], selected: T1 }],
      [B, { tabs: [browserTab(T2, B)], selected: T2 }],
    ]),
  });
  useNotices.setState({ notices: [] });
  opened.mockReset();
  unregister = registerCommentComposer(opened);
  fake = fakeClient();
  disconnect = connectBrowserComment(fake.client);
});
afterEach(() => {
  disconnect();
  unregister();
  resetBrowser();
});

describe('connectBrowserComment', () => {
  it('a changed event moves the toggle’s store, per tab', () => {
    fake.event('browser.comment.changed', { tabId: T1, on: true, reason: 'armed' });
    expect(armed()).toEqual([T1]);
    fake.event('browser.comment.changed', { tabId: T2, on: true, reason: 'armed' });
    fake.event('browser.comment.changed', { tabId: T1, on: false, reason: 'other' });
    expect(armed()).toEqual([T2]);
    fake.event('browser.comment.changed', { tabId: T2, on: false, reason: 'escape' });
    expect(armed()).toEqual([]);
    expect(toasts()).toEqual([]);
    expect(notices()).toEqual([]);
  });

  it('a tab whose page never confirmed the arm, or never answered a menu pick, says Comment is unavailable in its chrome (Decision Log 34, 35)', () => {
    fake.event('browser.comment.changed', { tabId: T1, on: false, reason: 'unavailable' });
    expect(armed()).toEqual([]);
    expect(notices()).toEqual([{ appSessionId: A, tabId: T1, kind: 'commentUnavailable' }]);
    expect(noticeText({ kind: 'commentUnavailable' })).toBe('Comment isn’t available on this page');
    expect(toasts()).toEqual([]);
  });

  it('a refused pick says in the tab’s chrome that the element could not be named, armed or not (the context menu’s one-shot)', () => {
    fake.event('browser.comment.changed', { tabId: T1, on: true, reason: 'armed' });
    fake.event('browser.comment.changed', { tabId: T1, on: false, reason: 'refused' });
    expect(armed()).toEqual([]);
    fake.event('browser.comment.changed', { tabId: T2, on: false, reason: 'refused' });
    expect(notices()).toEqual([
      { appSessionId: A, tabId: T1, kind: 'commentCannotName' },
      { appSessionId: B, tabId: T2, kind: 'commentCannotName' },
    ]);
    expect(noticeText({ kind: 'commentCannotName' })).toBe(COMMENT_COPY.cannotName);
    expect(toasts()).toEqual([]);
  });

  it('a tab this window does not list has no chrome here to say it in: nothing is raised', () => {
    fake.event('browser.comment.changed', { tabId: T3, on: false, reason: 'refused' });
    fake.event('browser.comment.changed', { tabId: T3, on: false, reason: 'unavailable' });
    expect(notices()).toEqual([]);
    expect(toasts()).toEqual([]);
  });

  it('a pick opens E3’s composer on main’s anchor for the tab’s session, its crop attached, no toast', () => {
    fake.event('browser.comment.picked', { tabId: T1, appSessionId: A, anchor: ANCHOR, crop: 'attached' });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith(ANCHOR, { appSessionId: A });
    expect(toasts()).toEqual([]);
  });

  it('a pick with no crop opens the composer all the same; a crop too large or failed says the comment goes without one', () => {
    const bare: Anchor = { ...ANCHOR };
    delete bare.screenshot;
    fake.event('browser.comment.picked', { tabId: T1, appSessionId: A, anchor: bare, crop: 'none' });
    expect(toasts()).toEqual([]);
    fake.event('browser.comment.picked', { tabId: T1, appSessionId: A, anchor: bare, crop: 'tooLarge' });
    fake.event('browser.comment.picked', { tabId: T1, appSessionId: A, anchor: bare, crop: 'failed' });
    expect(opened.mock.calls).toEqual([
      [bare, { appSessionId: A }],
      [bare, { appSessionId: A }],
      [bare, { appSessionId: A }],
    ]);
    expect(toasts()).toEqual([
      ['warning', COMMENT_COPY.cropTooLarge],
      ['warning', COMMENT_COPY.cropFailed],
    ]);
  });

  // P2-E2: the pane holding the tab's view docks the card; the page stays on screen, so a missing crop is a chrome line
  it('a pick on a tab a pane of this window holds opens the card in that pane’s dock, a missing crop said in the chrome', () => {
    const undock = registerDock(T1, 'pane-1');
    try {
      fake.event('browser.comment.picked', { tabId: T1, appSessionId: A, anchor: ANCHOR, crop: 'attached' });
      expect(opened).toHaveBeenLastCalledWith(ANCHOR, { appSessionId: A, placement: { kind: 'card', host: 'browser', hostId: 'pane-1' } });
      fake.event('browser.comment.picked', { tabId: T1, appSessionId: A, anchor: ANCHOR, crop: 'tooLarge' });
      fake.event('browser.comment.picked', { tabId: T1, appSessionId: A, anchor: ANCHOR, crop: 'failed' });
      expect(notices()).toEqual([
        { appSessionId: A, tabId: T1, kind: 'commentCropTooLarge' },
        { appSessionId: A, tabId: T1, kind: 'commentCropFailed' },
      ]);
      expect(noticeText({ kind: 'commentCropTooLarge' })).toBe(COMMENT_COPY.cropTooLarge);
      expect(noticeText({ kind: 'commentCropFailed' })).toBe(COMMENT_COPY.cropFailed);
      expect(toasts()).toEqual([]);
      // another tab, no dock: the sheet
      fake.event('browser.comment.picked', { tabId: T2, appSessionId: B, anchor: ANCHOR, crop: 'none' });
      expect(opened).toHaveBeenLastCalledWith(ANCHOR, { appSessionId: B });
    } finally {
      undock();
    }
  });

  it('a dock is the latest registration, and a disposer removes only its own', () => {
    const first = registerDock(T1, 'pane-1');
    const second = registerDock(T1, 'pane-2');
    first();
    fake.event('browser.comment.picked', { tabId: T1, appSessionId: A, anchor: ANCHOR, crop: 'none' });
    expect(opened).toHaveBeenLastCalledWith(ANCHOR, { appSessionId: A, placement: { kind: 'card', host: 'browser', hostId: 'pane-2' } });
    second();
    fake.event('browser.comment.picked', { tabId: T1, appSessionId: A, anchor: ANCHOR, crop: 'none' });
    expect(opened).toHaveBeenLastCalledWith(ANCHOR, { appSessionId: A });
  });

  it('stops listening when disconnected', () => {
    disconnect();
    fake.event('browser.comment.changed', { tabId: T1, on: true, reason: 'armed' });
    fake.event('browser.comment.picked', { tabId: T1, appSessionId: A, anchor: ANCHOR, crop: 'failed' });
    fake.event('browser.comment.changed', { tabId: T1, on: false, reason: 'refused' });
    expect(armed()).toEqual([]);
    expect(opened).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
    expect(notices()).toEqual([]);
  });
});
