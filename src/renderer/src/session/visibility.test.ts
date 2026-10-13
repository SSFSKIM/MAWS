import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { connectVisibility } from './visibility';
import { hideSideChild, showSideChild, useSidePane } from '../side/store'; // E3
import { hideCardThread, showCardThread, useCommentCard } from '../side/card/store'; // P2-E1
import { closeCard, openCard, useFloatingCard } from '../shell/floating'; // P3-G

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;

let fake: FakeClient;
let stop: () => void;
let focused = true;
let visibility: DocumentVisibilityState = 'visible';

const sent = () => fake.invoked('session.setVisible');

beforeEach(() => {
  resetShellStores();
  useSessions.setState({ records: new Map([[A, record('app-a')], [B, record('app-b')]]) });
  focused = true;
  visibility = 'visible';
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  fake = fakeClient({ 'session.setVisible': undefined });
  stop = connectVisibility(fake.client);
});
afterEach(() => {
  stop();
  vi.restoreAllMocks();
  useSidePane.setState({ panes: new Map() }); // E3
  useCommentCard.setState({ open: null, shownThread: null }); // P2-E1
  useFloatingCard.setState({ closed: false }); // P3-G
});

describe('session visibility', () => {
  it('is sent true once when a session tab becomes active, and false when another tab takes over', () => {
    expect(sent()).toEqual([]);
    useLayout.getState().openSession(A);
    expect(sent()).toEqual([{ appSessionId: A, visible: true }]);
    useLayout.getState().setSidebar({ width: 260 }); // an unrelated change sends nothing
    useLayout.getState().activateTab(`session:${A}`);
    expect(sent()).toHaveLength(1);
    useLayout.getState().openSession(B);
    expect(sent().slice(1)).toEqual([
      { appSessionId: A, visible: false },
      { appSessionId: B, visible: true },
    ]);
  });

  it('is false for every visible session when the window blurs, and true again on focus', () => {
    useLayout.getState().openSession(A);
    useLayout.getState().openSession(B, { split: true });
    expect(sent()).toEqual([
      { appSessionId: A, visible: true },
      { appSessionId: B, visible: true },
    ]);
    focused = false;
    window.dispatchEvent(new Event('blur'));
    expect(sent().slice(2)).toEqual([
      { appSessionId: A, visible: false },
      { appSessionId: B, visible: false },
    ]);
    focused = true;
    window.dispatchEvent(new Event('focus'));
    expect(sent().slice(4)).toEqual([
      { appSessionId: A, visible: true },
      { appSessionId: B, visible: true },
    ]);
  });

  it('is false when the page hides', () => {
    useLayout.getState().openSession(A);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sent()).toEqual([
      { appSessionId: A, visible: true },
      { appSessionId: A, visible: false },
    ]);
  });

  it('is false while the right panel is maximized over the main region', () => {
    useLayout.getState().openSession(A);
    useLayout.getState().setPanel({ maximized: true });
    expect(sent().at(-1)).toEqual({ appSessionId: A, visible: false });
  });

  // P3-G (§D1.3): the floating panel covers the main area as a maximized one does; the open card draws the shown session
  // on screen, the pill does not (so a turn ending behind it marks it unread).
  it('counts the floating card’s session while the card is open, not as a pill, and the main pane again once collapsed', () => {
    useLayout.getState().openSession(A);
    useLayout.getState().openSession(B, { split: true });
    expect(sent()).toEqual([
      { appSessionId: A, visible: true },
      { appSessionId: B, visible: true },
    ]);
    useLayout.getState().setPanel({ floating: true }); // B's pane is focused: the card draws B
    expect(sent().slice(2)).toEqual([{ appSessionId: A, visible: false }]);
    closeCard();
    expect(sent().slice(3)).toEqual([{ appSessionId: B, visible: false }]);
    openCard();
    expect(sent().slice(4)).toEqual([{ appSessionId: B, visible: true }]);
    useLayout.getState().setPanel({ collapsed: true }); // floating ends; both panes show again
    expect(sent().slice(5)).toEqual([{ appSessionId: A, visible: true }]);
  });

  it('reports an unstarted session only once its record arrives', () => {
    const NEW = 'app-new' as AppSessionId;
    useLayout.getState().openSession(NEW);
    expect(sent()).toEqual([]);
    useSessions.getState().applyChanged({ record: record('app-new'), cause: 'live', revision: 5 } as never);
    expect(sent()).toEqual([{ appSessionId: NEW, visible: true }]);
  });

  // E3: a side thread the Side pane draws counts as on screen while the panel is open beside its visible parent
  it('counts the side pane’s child while the panel is open and its parent shown; not when the panel collapses or the pane stops', () => {
    const CHILD = 'app-child' as AppSessionId;
    useSessions.setState({ records: new Map([[A, record('app-a')], [B, record('app-b')], [CHILD, record('app-child')]]) });
    useLayout.getState().setPanel({ collapsed: false });
    useLayout.getState().openSession(A);
    showSideChild(A, CHILD);
    expect(sent()).toEqual([
      { appSessionId: A, visible: true },
      { appSessionId: CHILD, visible: true },
    ]);
    useLayout.getState().setPanel({ collapsed: true });
    expect(sent().slice(2)).toEqual([{ appSessionId: CHILD, visible: false }]);
    useLayout.getState().setPanel({ collapsed: false });
    expect(sent().slice(3)).toEqual([{ appSessionId: CHILD, visible: true }]);
    showSideChild(B, CHILD); // B's pane draws it, but B is not shown: nothing changes
    hideSideChild(A, CHILD);
    expect(sent().slice(4)).toEqual([{ appSessionId: CHILD, visible: false }]);
  });

  // M3's review (M4): a maximized panel covers the main area but shows the pane, so the child it draws is on screen
  it('counts the side pane’s child while the panel is maximized (its parent covered), and drops it when the panel collapses', () => {
    const CHILD = 'app-child' as AppSessionId;
    useSessions.setState({ records: new Map([[A, record('app-a')], [CHILD, record('app-child')]]) });
    useLayout.getState().setPanel({ collapsed: false });
    useLayout.getState().openSession(A);
    showSideChild(A, CHILD);
    expect(sent()).toEqual([
      { appSessionId: A, visible: true },
      { appSessionId: CHILD, visible: true },
    ]);
    useLayout.getState().setPanel({ maximized: true });
    expect(sent().slice(2)).toEqual([{ appSessionId: A, visible: false }]);
    useLayout.getState().setPanel({ collapsed: true }); // the main area shows again; the pane does not
    expect(sent().slice(3)).toEqual([
      { appSessionId: CHILD, visible: false },
      { appSessionId: A, visible: true },
    ]);
  });

  it('counts the side pane’s child while a file tab of its parent is the shown tab (the panel shows that session)', () => {
    const CHILD = 'app-child' as AppSessionId;
    useSessions.setState({ records: new Map([[A, record('app-a')], [CHILD, record('app-child')]]) });
    useLayout.getState().setPanel({ collapsed: false });
    useLayout.getState().openTab({ kind: 'file', path: '/work/a.ts', line: null, appSessionId: A });
    showSideChild(A, CHILD);
    expect(sent()).toEqual([{ appSessionId: CHILD, visible: true }]);
  });

  // P2-E1: a thread a comment card shows (published while its host is on screen) is on screen, so its unread mark clears
  // as the Side pane's does; the window's focus still rules
  it('counts the thread a comment card shows while the card publishes it, and not once it stops or the window blurs', () => {
    const CHILD = 'app-child' as AppSessionId;
    useSessions.setState({ records: new Map([[A, record('app-a')], [CHILD, record('app-child')]]) });
    showCardThread(A, CHILD);
    expect(sent()).toEqual([{ appSessionId: CHILD, visible: true }]);
    focused = false;
    window.dispatchEvent(new Event('blur'));
    expect(sent().slice(1)).toEqual([{ appSessionId: CHILD, visible: false }]);
    focused = true;
    window.dispatchEvent(new Event('focus'));
    expect(sent().slice(2)).toEqual([{ appSessionId: CHILD, visible: true }]);
    hideCardThread(CHILD);
    expect(sent().slice(3)).toEqual([{ appSessionId: CHILD, visible: false }]);
  });
});
