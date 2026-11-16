// UX wave U1b M5, fix wave 3 (the architect's ruling on the third review pass): which sessions are in front, the
// contract of a remembered request (`show-waiting.ts`): the sessions whose transcript the person can see now. The table
// walks every state in which a session's transcript is not visible, for each of its two carriers, the tab on screen and
// the floating card, and the session is left out in each. Every id is invented.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { useFloatingCard } from '../shell/floating';
import { useLayout } from '../stores/layout';
import { mainShowing } from '../test-support/panel';
import { resetShellStores } from '../test-support/shell-stores';
import * as showing from './show-waiting';

const A = at('app-front-a' as AppSessionId);
const B = at('app-front-b' as AppSessionId);
const FILE: TabRef = { id: `file:${TEST_MACHINE}:/notes.md`, kind: 'file', machine: TEST_MACHINE, path: '/notes.md', line: null, appSessionId: null, pinned: false };
const inFront = () => (showing as { sessionsInFront?: () => AppSessionId[] }).sessionsInFront!();
const panel = (over: Partial<typeof LAYOUT_DEFAULTS.regions.panel>) => ({ ...LAYOUT_DEFAULTS.regions, panel: { ...LAYOUT_DEFAULTS.regions.panel, width: 444, ...over } });
const surface = (...ids: AppSessionId[]) => new Map(ids.map((id) => [id, { tabs: [{ id: 'terminal-1', toolId: 'terminal', pinned: false }], activeTabId: 'terminal-1' }]));

// The two carriers of A's transcript: its tab on screen (the panel docked), and the floating card over the panel's tool.
const CARRIERS = {
  tab: () => {
    useLayout.setState({ main: mainShowing(A), regions: panel({}), panelBySession: surface(A) });
    useFloatingCard.setState({ closed: false });
  },
  card: () => {
    useLayout.setState({ main: mainShowing(A), regions: panel({ floating: true }), panelBySession: surface(A, B) });
    useFloatingCard.setState({ closed: false });
  },
} as const;

type Carrier = keyof typeof CARRIERS;
// Each state in which A's transcript is not visible, reached from the carriers it applies to (closing the card hides
// nothing a tab shows).
const BOTH: Carrier[] = ['tab', 'card'];
const HIDDEN: [string, () => void, Carrier[]][] = [
  ['a destination page', () => useLayout.getState().openDestination({ kind: 'library' }), BOTH],
  ['the Overview', () => useLayout.getState().setOverviewOpen(true), BOTH],
  ['the card closed', () => useFloatingCard.setState({ closed: true }), ['card']],
  ['the card showing another session', () => useLayout.setState({ main: mainShowing(B) }), ['card']],
  ['the tab changed to another session', () => useLayout.setState({ main: mainShowing(A, B) }), BOTH],
  ['the tab changed to a tab that is no session', () => useLayout.setState((s) => ({ main: { ...s.main, panes: [{ tabs: [...s.main.panes[0].tabs, FILE], activeTabId: FILE.id }] } })), BOTH],
  ['the panel maximized over the main area', () => useLayout.setState((s) => ({ regions: { ...s.regions, panel: { ...s.regions.panel, maximized: true, floating: false } } })), BOTH],
];
const rows = HIDDEN.flatMap(([state, hide, carriers]) => carriers.map((carrier) => [carrier, state, hide] as const));

beforeEach(() => resetShellStores());

describe('the sessions in front', () => {
  it.each(BOTH)('hold A carried by its %s', (carrier) => {
    CARRIERS[carrier]();
    expect(inFront()).toContain(A);
  });

  it.each(rows)('leave A out when its %s is hidden by %s', (carrier, _, hide) => {
    CARRIERS[carrier]();
    hide();
    expect(inFront()).not.toContain(A);
  });
});
