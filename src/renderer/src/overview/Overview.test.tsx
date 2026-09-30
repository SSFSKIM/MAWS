import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { MawsBridge } from '@shared/ipc/schema';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerSessionCreator } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { activeTab } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { fillStores, resetShellStores, scenarioFile } from '../test-support/shell-stores';
import { Overview } from './Overview';

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => nine.sessions.find((r) => r.title.text === title)!.appId;
const requests: Record<string, SessionEvent> = Object.assign({}, ...nine.attention.map((a) => a.requests));
const offs: (() => void)[] = [];

const group = (name: string) => screen.getByRole('listitem', { name });
const cardTitles = (el: HTMLElement) => within(el).getAllByRole('article').map((a) => a.getAttribute('aria-label'));
const card = (title: string) => screen.getByRole('article', { name: title });

beforeEach(() => {
  resetShellStores();
  fillStores(nine);
  window.maws = fakeClient({ 'attention.request': ({ requestId }: { requestId: string }) => ({ event: requests[requestId] ?? null }) }).client;
});
afterEach(() => {
  cleanup();
  offs.splice(0).forEach((off) => off());
  delete (window as { maws?: MawsBridge }).maws;
});

describe('overview board', () => {
  it('groups cards: Needs you first, then the projects in sidebar order, then other sessions', () => {
    render(<Overview paneIndex={0} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Needs you · 3',
      'MAWS',
      'codex_somersault',
      'claude-usage-menubar',
      'Other sessions',
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
    act(() => useLayout.getState().activateTab('overview'));
    fireEvent.click(within(card('Settings idle probe')).getByText('Settings idle probe'), { metaKey: true });
    expect(useLayout.getState().main.panes).toHaveLength(2);
    expect(useLayout.getState().main.panes[1]?.activeTabId).toBe(`session:${idOf('Settings idle probe')}`);
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
    render(<Overview paneIndex={0} />);
    card('Charter + research').focus();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(useLayout.getState().main.panes[1]?.activeTabId).toBe(`session:${idOf('Charter + research')}`);
  });

  it('focusCard from the sidebar focuses and reveals the card, once', () => {
    render(<Overview paneIndex={0} />);
    const target = card('Quota reset recovery');
    let revealed = 0;
    target.scrollIntoView = () => void revealed++;
    act(() => useLayout.getState().focusCard(idOf('Quota reset recovery')));
    expect(document.activeElement).toBe(target);
    expect(revealed).toBe(1);
    expect(useLayout.getState().focusedCardAppId).toBeNull();
  });

  it('an empty board reads "Nothing live or unread" with a new-session action', async () => {
    const user = userEvent.setup();
    resetShellStores();
    useSessions.setState({ loaded: true });
    fillStores(scenarioFile('empty'));
    render(<Overview paneIndex={0} />);
    expect(screen.getByText('Nothing live or unread')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'New session' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    let asked = 0;
    offs.push(registerSessionCreator(async () => (asked++, null)));
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
    expect(screen.getByRole('button', { name: 'New session' })).toBeTruthy();
  });
});

// C12 start: the released mark on a card (C12 execution document, Interfaces "Surfaces of the budget"): the card stays on
// the board in its idle presentation with one muted word.
describe('a released session’s card', () => {
  it('stays on the board, idle, with the muted word released', () => {
    const id = idOf('Settings idle probe');
    const digest = useSessions.getState().digests.get(id)!;
    act(() => useSessions.getState().applyDigest({ ...digest, released: { at: new Date(2026, 8, 29, 14, 2).toISOString(), limitKiB: 8 * 1024 * 1024 }, revision: digest.revision + 1 }));
    render(<Overview paneIndex={0} />);
    const released = card('Settings idle probe');
    expect(within(released).getByTestId('card-activity').textContent).toBe('Idle');
    expect(within(released).getByText('released').getAttribute('title')).toBe('Released at 14:02 to stay under the 8 GB memory budget · Send resumes it');
    expect(cardTitles(group('Needs you'))).not.toContain('Settings idle probe');
  });
});
// C12 end
