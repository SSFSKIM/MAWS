// E4d (Task 3.2): what this window does with main's comment-mode events (E4d execution document, Design §6 and §8): a
// `changed` moves the toggle's store and a refused pick says the element could not be named; a `picked` opens E3's
// comment composer through E5's seam on the anchor main built, for the tab's session, and says when the crop is missing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Anchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { fakeClient, type FakeClient } from '../../../../../../test/support/fake-client';
import { useNotices } from '../../../stores/notices';
import { T1, T2 } from '../../../test-support/browser';
import { registerCommentComposer } from '../../code/anchor/anchor';
import { connectBrowserComment } from './connect';
import { COMMENT_COPY } from './copy';
import { resetCommentMode, useCommentMode } from './store';

const A = 'app-a' as AppSessionId;
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

beforeEach(() => {
  resetCommentMode();
  useNotices.setState({ notices: [] });
  opened.mockReset();
  unregister = registerCommentComposer(opened);
  fake = fakeClient();
  disconnect = connectBrowserComment(fake.client);
});
afterEach(() => {
  disconnect();
  unregister();
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
  });

  it('a refused pick says the element could not be named, armed or not (the context menu’s one-shot)', () => {
    fake.event('browser.comment.changed', { tabId: T1, on: true, reason: 'armed' });
    fake.event('browser.comment.changed', { tabId: T1, on: false, reason: 'refused' });
    expect(armed()).toEqual([]);
    fake.event('browser.comment.changed', { tabId: T2, on: false, reason: 'refused' });
    expect(toasts()).toEqual([
      ['warning', COMMENT_COPY.cannotName],
      ['warning', COMMENT_COPY.cannotName],
    ]);
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

  it('stops listening when disconnected', () => {
    disconnect();
    fake.event('browser.comment.changed', { tabId: T1, on: true, reason: 'armed' });
    fake.event('browser.comment.picked', { tabId: T1, appSessionId: A, anchor: ANCHOR, crop: 'failed' });
    expect(armed()).toEqual([]);
    expect(opened).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
  });
});
