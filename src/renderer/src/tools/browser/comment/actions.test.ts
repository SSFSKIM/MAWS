// E4d (Task 3.3): a page anchor's opener (E4d execution document, Design §10; Decision Log 15): the Browser tool opens
// the URL in the session's browser through its own reuse path, revealed only when that session is the one shown (the
// panel rule, with a toast saying where otherwise); a side thread's page opens in its parent's browser, where the
// commented tab lives; a URL the browser refuses is said, not opened.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record } from '../../../../../../test/support/builders';
import { registerPanelTool } from '../../../panel/host';
import { useLayout } from '../../../stores/layout';
import { activeTab, sessionOfTab } from '../../../stores/layout-model';
import { useNotices } from '../../../stores/notices';
import { useSessions } from '../../../stores/sessions';
import { installFakeMain, ok } from '../../../test-support/code';
import { A, B, C, panelOf, resetPanelStores } from '../../../test-support/panel';
import { browserTab, T1 } from '../../../test-support/browser';
import { browserTool } from '../BrowserTool';
import { browserSessionOf, openBrowserUrl } from './actions';
import { COMMENT_COPY } from './copy';

const URL = 'http://127.0.0.1:4000/comment.html';
const THREAD = 'side-thread' as AppSessionId;

let main: ReturnType<typeof installFakeMain>;
const browserTabs = (id: AppSessionId) => (panelOf(id)?.tabs ?? []).filter((t) => t.toolId === browserTool.id);
const toasts = () => useNotices.getState().notices.map((n) => n.text);

beforeEach(() => {
  resetPanelStores();
  useNotices.setState({ notices: [] });
  const records = new Map(useSessions.getState().records);
  records.set(THREAD, { ...record(THREAD), lineage: { kind: 'side-thread', parentAppSessionId: B, parentEngineSessionId: null, openedBy: 'comment' } });
  useSessions.setState({ records });
  registerPanelTool(browserTool);
  main = installFakeMain((name, input) => (name === 'browser.tabs.open' ? ok({ tab: browserTab(T1, input.appSessionId as AppSessionId, { url: URL }), reused: false }) : ok()));
});
afterEach(() => {
  delete (window as { maws?: unknown }).maws;
});

describe('browserSessionOf', () => {
  it('answers the parent for a side thread and the session itself otherwise', () => {
    expect(browserSessionOf(THREAD)).toBe(B);
    expect(browserSessionOf(A)).toBe(A);
    expect(browserSessionOf('unknown' as AppSessionId)).toBe('unknown');
  });
});

describe('openBrowserUrl', () => {
  it('on the shown session, opens the Browser tool on the URL through main’s reuse path, activated, without a toast', () => {
    openBrowserUrl(A, URL);
    expect(main.callsOf('browser.tabs.open')).toEqual([{ appSessionId: A, url: URL, select: true, reuse: 'url' }]);
    expect(browserTabs(A)).toHaveLength(1);
    expect(panelOf(A)!.activeTabId).toBe(browserTabs(A)[0]!.id);
    expect(toasts()).toEqual([]);
  });

  it('a second open of the same page goes through the same tool and asks main to reuse its tab again', () => {
    openBrowserUrl(A, URL);
    openBrowserUrl(A, URL);
    expect(browserTabs(A)).toHaveLength(1);
    expect(main.callsOf('browser.tabs.open')).toEqual([
      { appSessionId: A, url: URL, select: true, reuse: 'url' },
      { appSessionId: A, url: URL, select: true, reuse: 'url' },
    ]);
  });

  it('on a session that is not shown, adds the tool to that session’s panel without activating it, and says where', () => {
    openBrowserUrl(C, URL);
    expect(main.callsOf('browser.tabs.open')).toEqual([{ appSessionId: C, url: URL, select: true, reuse: 'url' }]);
    expect(browserTabs(C)).toHaveLength(1);
    expect(panelOf(C)!.activeTabId).not.toBe(browserTabs(C)[0]!.id);
    expect(sessionOfTab(activeTab(useLayout.getState().main))).toBe(A); // the panel rule: the main view stays where it was
    expect(toasts()).toEqual([COMMENT_COPY.openedElsewhere(C)]); // the builder's title is the id
  });

  it('a side thread’s page opens in its parent’s browser', () => {
    openBrowserUrl(THREAD, URL);
    expect(main.callsOf('browser.tabs.open')).toEqual([{ appSessionId: B, url: URL, select: true, reuse: 'url' }]);
    expect(browserTabs(THREAD)).toEqual([]);
    expect(browserTabs(B)).toHaveLength(1);
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'not a url'])('a URL the browser refuses is said and opens nothing: %s', (url) => {
    openBrowserUrl(A, url);
    expect(main.callsOf('browser.tabs.open')).toEqual([]);
    expect(browserTabs(A)).toEqual([]);
    expect(toasts()).toEqual([COMMENT_COPY.cannotOpen(url)]);
  });
});
