import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { accessibleDescription } from '../test-support/accessible-text';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { formatClock } from '@shared/app/date-format'; // L129
import type { AppSessionId } from '@shared/graph/ids'; // P5 O7 M6
import { addressOf, bareOf } from '@shared/machine/address';
import { item, record, remoteRow } from '../../../../test/support/builders';
import { OTHER_MACHINE } from '../../../../test/support/machine';
import { Toolbar } from '../app/Toolbar';
import { registerRemoteOpener } from '../sessions/remote-openers';
import { useAttention } from '../stores/attention';
import { useMachines } from '../stores/machines';
import { ipc } from '../ipc/client'; // the question sheet's C3 M4
import { CLASH, FIXTURE, sheetOf } from '../sheet/test-support/questions';
import { connectSheets, resetSheetStore } from '../stores/sheet';
import { SHEET_WORDS } from '../sheet';
import { preloadOf } from '../test-support/preload-of';
import type { SheetLine } from '@shared/sheet/model';
import { vi } from 'vitest';
vi.mock('../transcript/view/markdown/Markdown', () => ({ Markdown: ({ markdown }: { markdown: string }) => <div data-markdown="">{markdown}</div> }));

const nine = scenarioFile('nine-sessions');
const idOf = (title: string) => pageScenario(nine).sessions.find((r) => r.title.text === title)!.appId; // P5 O6 M2: the page's id
const requests: Record<string, SessionEvent> = Object.assign({}, ...nine.attention.map((a) => a.requests));
const offs: (() => void)[] = [];

const group = (name: string) => screen.getByRole('listitem', { name });
const cardTitles = (el: HTMLElement) => within(el).getAllByRole('article').map((a) => a.getAttribute('aria-label'));
const card = (title: string) => screen.getByRole('article', { name: title });

beforeEach(() => {
  resetShellStores();
  resetSheetStore();
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
    // the word cut (W104): the Needs-you heading is for assistive technology alone; the projects' are drawn
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.classList.contains('sr-only'))).toEqual([true, false, false, false, false]);
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

  // the word cut (W110): context, cost since seen and child agents are the card's tooltip and description, no footer
  it('a working card shows its activity; its child agents, context and cost since seen are its description', () => {
    render(<Overview paneIndex={0} />);
    const charter = card('Charter + research');
    expect(within(charter).getByText('Running bun test')).toBeTruthy();
    expect(accessibleDescription(charter)).toBe('ctx 41% · $0.00 since seen · 2 agents');
    for (const text of ['2 agents', 'ctx 41%', 'since seen']) expect(charter.textContent).not.toContain(text);
  });

  // UX wave U8c-2 (M4 decision 10): a card names the branch recorded for the working folder, where the agent is.
  it('a card names the branch of the folder the agent works in', () => {
    const charter = nine.sessions.find((r) => r.title.text === 'Charter + research')!.appId;
    act(() => fillStores({ ...nine, sessions: nine.sessions.map((r) => (r.appId === charter ? { ...r, branch: 'master', agentFolder: { checkout: '/work/wt', cwd: '/work/wt', branch: 'w1', linked: true } } : r)) }));
    render(<Overview paneIndex={0} />);
    expect(within(card('Charter + research')).getByText('⎇ w1')).toBeTruthy();
  });

  it('a working card with a previous answer shows both lines', () => {
    render(<Overview paneIndex={0} />);
    const usage = card('Usage reset countdown');
    const lines = within(usage).getAllByTestId(/^card-(activity|answer)$/);
    expect(lines.map((l) => l.dataset.testid)).toEqual(['card-activity', 'card-answer']);
    expect(lines[0].textContent).toMatch(/^Running curl/);
    expect(lines[1].textContent).toMatch(/^The request succeeded/);
  });

  it('the idle, read, live session has no activity line over its last answer (the word cut, W107)', () => {
    render(<Overview paneIndex={0} />);
    const idle = card('Settings idle probe');
    expect(within(idle).queryByTestId('card-activity')).toBeNull();
    expect(within(idle).getByTestId('card-answer').textContent).toMatch(/^Settings loaded/);
  });

  it('the foreign-live card shows its holder and has no controls', () => {
    render(<Overview paneIndex={0} />);
    const foreign = card('Somersault terminal run');
    expect(cardTitles(group('codex_somersault'))).toContain('Somersault terminal run');
    expect(within(foreign).getByTestId('card-activity').textContent).toBe('Running in Terminal'); // the word cut (W75)
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

  // P5 O7 M10 (a busy remote session's state): with a tab open here its record is held, with no digest; its card reads
  // its listing's state, in its glyph and its activity line
  it('a record of it, with no digest, is carded by its listing’s state', () => {
    useSessions.setState({
      records: new Map([...useSessions.getState().records, [b1, record(b1, { title: { text: 'Studio build', source: 'user' }, unread: true })]]),
      listed: new Map([[b1, { ...remoteRow(OTHER_MACHINE, 'b1', { title: 'Studio build', state: 'busy' }), appId: b1 }]]),
    });
    render(<Overview paneIndex={0} />);
    expect(within(card('Studio build')).getByRole('img', { name: 'Working' })).toBeTruthy();
    expect(within(card('Studio build')).getByTestId('card-activity').textContent).toBe('Working');
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
    expect(within(released).queryByTestId('card-activity')).toBeNull();
    expect(within(released).getByText('released').getAttribute('title')).toBe(`Released at ${formatClock(Date.parse(AT_RELEASE))} to stay under the 8 GB memory budget · Send resumes it`);
    expect(cardTitles(group('Needs you'))).not.toContain('Settings idle probe');
  });
});
// C12 end

// The question sheet's C3 M4 (§H; frame 5): where the card would mount a request card for a sheet question, the session's
// sheet questions together mount one compact sheet, a stopped session's too; the transcript's Markdown as text.
describe('a session whose sheet questions wait', () => {
  const SHEET = sheetOf([CLASH, FIXTURE]);
  const asked = (appSessionId: AppSessionId, question: string, minute: number) =>
    item(appSessionId, 'async_input', `2026-09-28T07:0${minute}:00.000Z`, { id: addressOf(TEST_MACHINE, `sheet:${SHEET.session}:${question}`) as never, request: { requestId: question as never, toolUseId: 'toolu_sheet' as never, taskId: null, agentId: null } });

  function scene(holder: 'none' | 'self') {
    const id = idOf('Fix sidebar drag');
    const summary = { session: SHEET.session, appSessionId: bareOf(id), title: null, live: holder !== 'none', seq: 1, open: 2, queued: 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false };
    window.maws = fakeClient({ 'sheet.list': { sessions: [summary], door: { known: false } }, 'sheet.read': { model: SHEET, door: { known: false } } }).client as unknown as PreloadBridge;
    if (holder === 'none') act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(id, { ...s.records.get(id)!, holder: { kind: 'none' } }) })));
    act(() => useAttention.getState().applyChanged({ appSessionId: id, items: [asked(id, 'q4', 1), asked(id, 'q7', 2)] }, TEST_MACHINE));
    offs.push(connectSheets(ipc));
    return id;
  }

  it.each(['self', 'none'] as const)('mounts one compact sheet a session, its questions folded to their lines (holder %s)', async (holder) => {
    scene(holder);
    render(<Overview paneIndex={0} />);
    const fix = card('Fix sidebar drag');
    await waitFor(() => expect(fix.querySelectorAll('[data-sheet-in-place]')).toHaveLength(1));
    expect(fix.querySelectorAll('[data-sheet-session][data-density="compact"]')).toHaveLength(1);
    expect([...fix.querySelectorAll('[data-sheet-question]')].map((q) => q.getAttribute('data-sheet-question'))).toEqual(['q4', 'q7']);
    expect(fix.querySelectorAll('[data-request-card]')).toHaveLength(0);
  });

  // M4's re-review: a running session accepts the last answer sent from its card; nothing of it waits, and the card keeps
  // its sheet, which reads the outcome accepted until it is delivered
  it('keeps a running session’s compact sheet once the last answer sent from it is accepted, its outcome in view', async () => {
    const id = idOf('Fix sidebar drag');
    let model = sheetOf([FIXTURE]);
    const summary = (accepted: boolean) => ({ session: model.session, appSessionId: bareOf(id), title: null, live: true, seq: accepted ? 2 : 1, open: accepted ? 0 : 1, queued: 0, pending: accepted ? 1 : 0, hidden: 0, oldestAskedAt: null, unreadable: false });
    const door = { known: true, available: true };
    const fake = fakeClient({
      'sheet.list': { sessions: [summary(false)], door },
      'sheet.read': () => ({ model, door }),
      'sheet.put': ({ lines }: { lines: SheetLine[] }) => ({ ok: true, results: lines.map((line) => ({ key: line.key, state: 'queued' })) }),
    });
    window.maws = preloadOf(fake);
    act(() => useAttention.getState().applyChanged({ appSessionId: id, items: [asked(id, 'q7', 1)] }, TEST_MACHINE));
    offs.push(connectSheets(ipc));
    render(<Overview paneIndex={0} />);
    const fix = () => card('Fix sidebar drag');
    await waitFor(() => expect(fix().querySelector('[data-sheet-question="q7"]')).not.toBeNull());
    fireEvent.click(within(fix()).getByRole('button', { name: /q7/ }));
    fireEvent.click(within(fix()).getByRole('radio', { name: 'Replace it' }));
    fireEvent.click(within(fix()).getByRole('button', { name: SHEET_WORDS.send(1) }));
    await waitFor(() => expect(fake.invoked('sheet.put')).toHaveLength(1));
    const [answer] = (fake.invoked('sheet.put') as { lines: SheetLine[] }[])[0]!.lines;
    // the session's next step applies it: the question closes, its outcome pending delivery
    const outcome = { key: answer!.key, kind: 'answer', id: 'q7', by: 'maws', at: '2026-11-23T10:00:00.000Z', acceptedAt: '2026-11-23T10:00:01.000Z', acrossStop: false, recipient: 'main', revision: 1, taken: false, picks: ['Replace it'], text: '', images: [], places: [1],
      question: { askedAt: FIXTURE.askedAt, asker: FIXTURE.asker, header: FIXTURE.header, multiSelect: false, options: FIXTURE.options.map((option) => option.label), question: FIXTURE.question } };
    model = sheetOf([], { seq: 2, pending: [outcome as never], sent: [{ key: answer!.key, state: 'accepted', verdict: 'applied', kind: 'answer', id: 'q7', at: '2026-11-23T10:00:01.000Z' }] });
    act(() => {
      useAttention.getState().applyChanged({ appSessionId: id, items: [] }, TEST_MACHINE);
      fake.event('sheet.changed', { session: model.session, summary: summary(true) });
    });
    await waitFor(() => expect(fix().querySelector('[data-sheet-outcome="q7"]')?.textContent).toContain(SHEET_WORDS.accepted));
    expect(fix().querySelectorAll('[data-sheet-in-place]'), 'the sheet stays where the answer was sent').toHaveLength(1);
    expect(fix().querySelector('[data-sheet-question]'), 'nothing of it open').toBeNull();
  });

  // M4's review: a stopped session's one question answered from its card is queued and waits no more; the card keeps its
  // sheet, which reads the answer queued with Take back; taken back, the question is open and waits again
  it('keeps a stopped session’s compact sheet once its one question is answered from it: queued with Take back, which opens it again', async () => {
    const id = idOf('Fix sidebar drag');
    let model = sheetOf([FIXTURE]);
    const summary = (queued: boolean) => ({ session: model.session, appSessionId: bareOf(id), title: null, live: false, seq: 1, open: queued ? 0 : 1, queued: queued ? 1 : 0, pending: 0, hidden: 0, oldestAskedAt: null, unreadable: false });
    const door = { known: true, available: true };
    const fake = fakeClient({
      'sheet.list': { sessions: [summary(false)], door },
      'sheet.read': () => ({ model, door }),
      'sheet.put': ({ lines }: { lines: SheetLine[] }) => ({ ok: true, results: lines.map((line) => ({ key: line.key, state: 'queued' })) }),
    });
    window.maws = preloadOf(fake); // the fake under the real client, so its events reach the store lifted
    act(() => useSessions.setState((s) => ({ records: new Map(s.records).set(id, { ...s.records.get(id)!, holder: { kind: 'none' } }) })));
    const waiting = asked(id, 'q7', 1);
    act(() => useAttention.getState().applyChanged({ appSessionId: id, items: [waiting] }, TEST_MACHINE));
    offs.push(connectSheets(ipc));
    render(<Overview paneIndex={0} />);
    const fix = () => card('Fix sidebar drag'); // the card moves out of the Needs-you group once nothing of it waits
    await waitFor(() => expect(fix().querySelector('[data-sheet-question="q7"]')).not.toBeNull());
    const puts = () => fake.invoked('sheet.put') as { lines: SheetLine[] }[];
    // what the service does with each line: the answer queued on the question, which no longer waits; the retract cancels it
    const changed = (queued: boolean) =>
      act(() => {
        useAttention.getState().applyChanged({ appSessionId: id, items: queued ? [] : [waiting] }, TEST_MACHINE);
        fake.event('sheet.changed', { session: model.session, summary: summary(queued) });
      });

    fireEvent.click(within(fix()).getByRole('button', { name: /q7/ })); // unfold the compact card
    fireEvent.click(within(fix()).getByRole('radio', { name: 'Replace it' }));
    fireEvent.click(within(fix()).getByRole('button', { name: SHEET_WORDS.send(1) }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    const answer = puts()[0]!.lines[0]!;
    model = sheetOf([{ ...FIXTURE, queued: { key: answer.key, kind: 'answer', picks: ['Replace it'], text: '', images: [], revision: 1, by: 'maws' } }], { sent: [{ key: answer.key, state: 'queued', kind: 'answer', id: 'q7' }] });
    changed(true);
    await waitFor(() => expect(within(fix()).getByText(SHEET_WORDS.queued)).toBeTruthy());
    expect(fix().querySelectorAll('[data-sheet-in-place]'), 'the sheet stays where the answer was sent').toHaveLength(1);

    fireEvent.click(within(fix()).getByRole('button', { name: SHEET_WORDS.takeBack }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    const retract = puts()[1]!.lines[0]!;
    expect(retract).toMatchObject({ kind: 'retract', target: answer.key });
    model = sheetOf([FIXTURE], { sent: [{ key: answer.key, state: 'queued', kind: 'answer', id: 'q7', cancelled: true }, { key: retract.key, state: 'queued', kind: 'retract', target: answer.key }] });
    changed(false);
    await waitFor(() => expect(within(fix()).queryByText(SHEET_WORDS.queued)).toBeNull());
    expect(fix().querySelectorAll('[data-sheet-in-place]')).toHaveLength(1);
    expect(fix().querySelector('[data-sheet-question="q7"]'), 'open again, its line in the card').not.toBeNull();
  });
});
