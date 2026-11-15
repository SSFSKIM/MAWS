import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { EMPTY_STRIP, type Strip, type TabRef } from '@shared/ipc/schema/layout';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { A, B, resetPanelStores, sessionTab } from '../test-support/panel';
import { cardColumnNow } from './shell-view';

// A split's two panes, each showing one tab, focus on `focused`. A column placed or not is what pads the main area, so a
// focus move inside a split must not change it while a session is in view (#692: the press that moved focus also moved the
// pane's header out from under the pointer).
const document: TabRef = { id: 'diagnostics', kind: 'diagnostics', pinned: false };
const split = (left: TabRef, right: TabRef, focused: 0 | 1): Strip => ({ ...EMPTY_STRIP, panes: [{ tabs: [left], activeTabId: left.id }, { tabs: [right], activeTabId: right.id }], focusedPane: focused });
const single = (tab: TabRef): Strip => ({ ...EMPTY_STRIP, panes: [{ tabs: [tab], activeTabId: tab.id }], focusedPane: 0 });
const WIDE = 1440;
const column = (main: Strip) => {
  useLayout.setState({ main });
  const { session, sessionTab: speaks, placed, shown } = cardColumnNow(useLayout.getState(), WIDE);
  return { session, speaks, placed, shown };
};
const SPEAKS_OF = (session: AppSessionId | null) => ({ session, speaks: session !== null, placed: session !== null, shown: session !== null });

describe('cardColumnNow across the panes of a split', () => {
  beforeEach(() => {
    resetPanelStores();
    useSessions.setState({ records: new Map([[A, {} as SessionRecord], [B, {} as SessionRecord]]) });
  });

  it('a session beside a document: the column is the session’s with either pane focused', () => {
    expect(column(split(sessionTab(A), document, 0))).toEqual(SPEAKS_OF(A));
    expect(column(split(sessionTab(A), document, 1))).toEqual(SPEAKS_OF(A));
  });

  it('the same with the document in the first pane', () => {
    expect(column(split(document, sessionTab(A), 0))).toEqual(SPEAKS_OF(A));
    expect(column(split(document, sessionTab(A), 1))).toEqual(SPEAKS_OF(A));
  });

  it('a session beside a document the column cannot speak of is not placed', () => {
    useSessions.setState({ records: new Map() });
    expect(column(split(sessionTab(A), document, 1))).toMatchObject({ speaks: false, placed: false, shown: false });
  });

  it('two sessions: the focused pane’s wins, as before', () => {
    expect(column(split(sessionTab(A), sessionTab(B), 0)).session).toBe(A);
    expect(column(split(sessionTab(A), sessionTab(B), 1)).session).toBe(B);
  });

  it('two documents: no column', () => {
    const other: TabRef = { id: 'channel:p', kind: 'channel', project: 'p', pinned: false };
    expect(column(split(document, other, 0))).toMatchObject({ session: null, speaks: false, placed: false, shown: false });
  });

  it('a single pane is as before: its own tab decides', () => {
    expect(column(single(sessionTab(A)))).toEqual(SPEAKS_OF(A));
    expect(column(single(document))).toMatchObject({ session: null, placed: false, shown: false });
  });
});
