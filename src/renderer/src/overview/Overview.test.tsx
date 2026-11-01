import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { PreloadBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { activeTab, currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { fillStores, pageScenario, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { Overview } from './Overview';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { formatClock } from '@shared/app/date-format'; // L129
import type { AppSessionId } from '@shared/graph/ids'; // P5 O7 M6
import { addressOf } from '@shared/machine/address';
import { item, remoteRow } from '../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { Toolbar } from '../app/Toolbar';
import { registerRemoteOpener } from '../sessions/remote-openers';
import { useAttention } from '../stores/attention';
import { useMachines } from '../stores/machines';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => pageScenario(nine).sessions.find((r) => r.title.text === title)!.appId; // P5 O6 M2: the page's id
const requests: Record<string, SessionEvent> = Object.assign({}, ...nine.attention.map((a) => a.requests));
const offs: (() => void)[] = [];

const group = (name: string) => screen.getByRole('listitem', { name });
const cardTitles = (el: HTMLElement) => within(el).getAllByRole('article').map((a) => a.getAttribute('aria-label'));
const card = (title: string) => screen.getByRole('article', { name: title });

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  window.maws = fakeClient({ 'attention.request': ({ requestId }: { requestId: string }) => ({ event: requests[requestId] ?? null }) }).client as unknown as PreloadBridge;
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('overview board', () => {
  it('groups cards: Needs you first, then the projects in sidebar order, then other sessions', () => {
    render(<Overview paneIndex={0} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Needs you · 3',
      'MAWS',
      'codex_somersault',
      'claude-usage-menubar',
      'This Mac', // P5 O6 M5 (T3): the sessions of no project are their machine's
    ]);
    expect(cardTitles(group('Needs you'))).toEqual(['Fix sidebar drag', 'Sidebar interaction pass', 'Quota reset recovery']);
    expect(cardTitles(group('claude-usage-menubar'))).toEqual(['Usage reset countdown', 'Settings idle probe']);
  });

  it('omits exited sessions that are read', () => {
    render(<Overview paneIndex={0} />);
    expect(screen.queryByRole('article', { name: 'Trace stream reconnects' })).toBeNull();
    expect(screen.queryByRole('article', { name: 'SDK wire inventory' })).toBeNull();
    expect(screen.queryByRole('article', { name: 'Workstation north star' })).toBeNull();
  });

  it('a Needs-you card shows its request preview inline', async () => {
    render(<Overview paneIndex={0} />);
    const fix = card('Fix sidebar drag');
    expect(await within(fix).findByText('git log --oneline')).toBeTruthy();
    expect(within(fix).getByText('Bash')).toBeTruthy();
    expect(within(fix).getByText('MAWS')).toBeTruthy(); // the project, named in the Needs-you group
    expect(within(fix).queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('a working card shows its activity, child agents, context and cost since seen', () => {
    render(<Overview paneIndex={0} />);
    const charter = card('Charter + research');
    for (const text of ['Running bun test', '2 agents', 'ctx 41%', '$0.00 since seen']) expect(within(charter).getByText(text)).toBeTruthy();
  });

  it('a working card with a previous answer shows both lines', () => {
    render(<Overview paneIndex={0} />);
    const usage = card('Usage reset countdown');
    const lines = within(usage).getAllByTestId(/^card-(activity|answer)$/);
    expect(lines.map((l) => l.dataset.testid)).toEqual(['card-activity', 'card-answer']);
    expect(lines[0].textContent).toMatch(/^Running curl/);
    expect(lines[1].textContent).toMatch(/^The request succeeded/);
  });

  it('the idle, read, live session reads Idle over its last answer', () => {
    render(<Overview paneIndex={0} />);
    const idle = card('Settings idle probe');
    expect(within(idle).getByTestId('card-activity').textContent).toBe('Idle');
    expect(within(idle).getByTestId('card-answer').textContent).toMatch(/^Settings loaded/);
  });

  it('the foreign-live card shows its holder and has no controls', () => {
    render(<Overview paneIndex={0} />);
    const foreign = card('Somersault terminal run');
    expect(cardTitles(group('codex_somersault'))).toContain('Somersault terminal run');
    expect(within(foreign).getByTestId('card-activity').textContent).toBe('Terminal · pid 7135');
    expect(within(foreign).queryAllByRole('button')).toEqual([]);
    expect(foreign.querySelectorAll('[tabindex], a, input, textarea, select')).toHaveLength(0);
  });

  it('a click opens the session; a ⌘-click opens it in the split', async () => {
    const user = userEvent.setup();
    render(<Overview paneIndex={0} />);
    await user.click(within(card('Charter + research')).getByText('Charter + research'));
    expect(activeTab(useLayout.getState().main)).toMatchObject({ appSessionId: idOf('Charter + research') });
    fireEvent.click(within(card('Settings idle probe')).getByText('Settings idle probe'), { metaKey: true });
    expect(currentSet(useLayout.getState().main).panes).toHaveLength(2);
    expect(currentSet(useLayout.getState().main).panes[1]?.activeTabId).toBe(`session:${idOf('Settings idle probe')}`);
  });

  it('arrow keys move focus across cards, Enter opens, ⌘Enter opens in the split', async () => {
    const user = userEvent.setup();
    render(<Overview paneIndex={0} />);
    const cards = screen.getAllByRole('article');
    expect(cards.filter((c) => c.tabIndex === 0)).toEqual([cards[0]]);
    cards[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cards[1]);
    await user.keyboard('{ArrowRight}{ArrowLeft}{ArrowUp}');
    expect(document.activeElement).toBe(cards[0]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(cards.at(-1));
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(cards[0]);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(activeTab(useLayout.getState().main)).toMatchObject({ appSessionId: idOf('Sidebar interaction pass') });
  });

  it('⌘Enter on a focused card opens it in the split', async () => {
    const user = userEvent.setup();
    useLayout.getState().openSession(idOf('Settings idle probe')); // a tab beside which to split (an empty pane takes the session itself)
    render(<Overview paneIndex={0} />);
    card('Charter + research').focus();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(currentSet(useLayout.getState().main).panes[1]?.activeTabId).toBe(`session:${idOf('Charter + research')}`);
  });

  it('an empty board reads "Nothing live or unread" with a new-session action', async () => {
    const user = userEvent.setup();
    resetShellStores();
    useSessions.setState({ loaded: true });
    fillStores(scenarioFile('empty'));
    render(<Overview paneIndex={0} />);
    expect(screen.getByText('Nothing live or unread')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'New chat' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    let asked = 0;
    offs.push(
      registerSessionCreator(async () => {
        asked++;
        return null;
      }),
    );
    await act(async () => {});
    expect(button.disabled).toBe(false);
    await user.click(button);
    expect(asked).toBe(1);
  });

  // Debt wave 5 (the cold first paint): the board shows what it has while the discovery pass reads, and says so.
  it('while the store is being indexed, says how far it has come above the cards it has, or in place of the empty board', () => {
    act(() => useSessions.getState().applyScanProgress({ scanned: 1200, total: 3274 }));
    const { unmount } = render(<Overview paneIndex={0} />);
    expect(screen.getByRole('status').textContent).toBe('Indexing sessions · 1,200 of 3,274');
    expect(cardTitles(group('Needs you'))).toEqual(['Fix sidebar drag', 'Sidebar interaction pass', 'Quota reset recovery']);
    act(() => useSessions.getState().applyScanProgress({ scanned: 3274, total: 3274 }));
    expect(screen.queryByRole('status')).toBeNull();
    unmount();

    resetShellStores();
    fillStores(scenarioFile('empty'));
    act(() => useSessions.getState().applyScanProgress({ scanned: 0, total: 3274 }));
    render(<Overview paneIndex={0} />);
    expect(screen.getByRole('status').textContent).toBe('Indexing sessions · 0 of 3,274');
    expect(screen.queryByText('Nothing live or unread')).toBeNull();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeTruthy();
  });
});

// C12 start: the released mark on a card (C12 execution document, Interfaces "Surfaces of the budget"): the card stays on
// the board in its idle presentation with one muted word.
// P5 O7 M6 (M6c fix wave 1): "Overview and attention span machines": a session on another machine with no tab open,
// counted in the toolbar, has its card in the Needs-you group from its listing and its item, and opens through its lane's
// opener; a greyed machine's is counted nowhere and has none.
describe('another machine’s waiting session', () => {
  const b1 = addressOf(OTHER_MACHINE, 'b1' as AppSessionId);
  const waiting = item(b1, 'permission', '2026-09-28T01:00:00Z', { summary: 'Bash: pnpm deploy --prod', id: addressOf(OTHER_MACHINE, 'att-b1') as never });
  const waitingCount = () => Number(/Overview, (\d+) waiting/.exec(screen.getByRole('button', { name: /^Overview/ }).getAttribute('aria-label') ?? '')?.[1] ?? 0);
  beforeEach(() => {
    useMachines.getState().applyRoster([
      { ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: '2026-11-01T00:00:00Z', generation: 0 },
      { ref: OTHER_MACHINE, name: 'Studio', local: false, state: 'up', since: '2026-11-01T00:00:00Z', generation: 1 },
    ]);
    useSessions.setState({ listed: new Map([[b1, { ...remoteRow(OTHER_MACHINE, 'b1', { title: 'Studio build' }), appId: b1 }]]), listedMachines: new Set([OTHER_MACHINE]) });
  });
  afterEach(() => {
    act(() => useAttention.getState().applyRemote({ machine: OTHER_MACHINE, items: [], greyed: false }));
    useMachines.setState({ roster: 'unread', machines: new Map(), loaded: new Set() });
  });

  it('is counted in the toolbar, carded in Needs you from its listing, and opened through its lane’s opener with no tab before', async () => {
    const opened: AppSessionId[] = [];
    offs.push(registerRemoteOpener('B', (listed) => opened.push(listed.appId)));
    render(<><Toolbar /><Overview paneIndex={0} /></>);
    const before = waitingCount();
    act(() => useAttention.getState().applyRemote({ machine: OTHER_MACHINE, items: [waiting], greyed: false }));
    expect(waitingCount()).toBe(before + 1);
    expect(screen.getByRole('heading', { name: 'Needs you · 4' })).toBeTruthy();
    expect(cardTitles(group('Needs you'))[0]).toBe('Studio build'); // the oldest wait
    const remote = card('Studio build');
    expect(remote.dataset.card).toBe(b1);
    expect(within(remote).getByTestId('card-activity').textContent).toBe('Waiting for approval');
    expect(within(remote).getByTestId('card-summary').textContent).toBe('Bash: pnpm deploy --prod');
    expect(within(remote).getByText('Studio')).toBeTruthy(); // its machine, in the project's place
    expect(activeTab(useLayout.getState().main)).toBeNull();
    await userEvent.setup().click(within(remote).getByText('Studio build'));
    expect(opened).toEqual([b1]);
    remote.focus();
    fireEvent.keyDown(remote, { key: 'Enter' });
    expect(opened).toEqual([b1, b1]);
  });

  it('a greyed machine’s session is neither counted nor carded', () => {
    render(<><Toolbar /><Overview paneIndex={0} /></>);
    const before = waitingCount();
    act(() => useAttention.getState().applyRemote({ machine: OTHER_MACHINE, items: [waiting], greyed: true }));
    expect(waitingCount()).toBe(before);
    expect(screen.getByRole('heading', { name: 'Needs you · 3' })).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Studio build' })).toBeNull();
  });
});

describe('a released session’s card', () => {
  const AT_RELEASE = new Date(2026, 8, 29, 14, 2).toISOString();
  it('stays on the board, idle, with the muted word released', () => {
    const id = idOf('Settings idle probe');
    const digest = useSessions.getState().digests.get(id)!;
    act(() => useSessions.getState().applyDigest({ ...digest, released: { at: AT_RELEASE, reason: 'budget', limitKiB: 8 * 1024 * 1024 }, revision: digest.revision + 1 }, TEST_MACHINE));
    render(<Overview paneIndex={0} />);
    const released = card('Settings idle probe');
    expect(within(released).getByTestId('card-activity').textContent).toBe('Idle');
    expect(within(released).getByText('released').getAttribute('title')).toBe(`Released at ${formatClock(Date.parse(AT_RELEASE))} to stay under the 8 GB memory budget · Send resumes it`);
    expect(cardTitles(group('Needs you'))).not.toContain('Settings idle probe');
  });
});
// C12 end
