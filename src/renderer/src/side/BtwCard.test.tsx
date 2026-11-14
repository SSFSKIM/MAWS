// The `/btw` card (UX wave U4a, M7; decision 26; the child's O-20): a typed `/btw <question>` opens a small card over
// the session's pane in place of the Side pane's question view; while the answer is awaited it reads the transcript's
// live thinking words, counting; the answer appears in the card; the card folds to a chip that shows the waiting line or
// a dot for an answer not seen, and closes. Its state is the window's, per session, never stored. The three routes ask
// as they did: a session MAWS runs here (`session.sideQuestion`), one on another machine (the same command; the
// waiting line counts on this window's clock there), a terminal session (its bridge's `laneA.btw`).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperationEvent } from '@shared/engine/operations';
import type { AppSessionId } from '@shared/graph/ids';
import { REMOTE_UNAVAILABLE } from '@shared/ipc/remote-unavailable';
import type { PreloadBridge } from '@shared/ipc/schema';
import { addressOf, bareOf } from '@shared/machine/address';
import type { SideExchange } from '@shared/side/question';
import { digest, record, remoteRow, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import { heardRefusal, resetRemoteSurfaces } from '../artifacts/remote-surfaces';
import { laneAState } from '../lane-a/test-support/lane-a-state';
import { resetLaneAWatches } from '../lane-a/watches';
import { resetRemoteLaneBStore } from '../lane-b/remote-session';
import { applyLaneAState, resetLaneAStore } from '../stores/lane-a';
import { useMachines } from '../stores/machines';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { A, B, mainShowing, panelOf, resetPanelStores } from '../test-support/panel';
import { preloadOf } from '../test-support/preload-of';
import { SIDE_TOOL_ID } from './actions';
import { applyBtw } from './btw';
import { BtwCard } from './BtwCard';
import { BtwWidget } from './BtwWidget';
import { registerSidePane } from './register';
import { btwCardOf, btwUnseen, onSideOperation, openBtwCard, resetSideQuestions, sidePaneOf, useBtwCards, useSidePane } from './store';

const A_ID = bareOf(A);
const T = Date.parse('2026-11-13T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const exchange = (over: Partial<SideExchange>): SideExchange => ({ id: 'op-1', question: 'What word?', state: 'answered', response: 'ZEBRA', synthetic: false, error: null, askedAt: '2026-11-13T09:59:00.000Z', answeredAt: '2026-11-13T09:59:02.000Z', ...over });
const pending = (over: Partial<SideExchange> = {}): SideExchange => exchange({ state: 'pending', response: null, answeredAt: null, ...over });
const completion = (parent: AppSessionId, opId: string, outcome: OperationEvent['outcome']): OperationEvent => ({ appSessionId: parent, opId, command: 'session.sideQuestion', late: false, outcome });
const answered = (response: string): OperationEvent['outcome'] => ({ ok: true, value: { response, synthetic: false } });

const card = () => document.querySelector<HTMLElement>('[data-btw-card]');
const chip = () => document.querySelector<HTMLElement>('[data-btw-chip]');
const waiting = (within: ParentNode = document) => [...within.querySelectorAll('[data-btw-waiting]')].map((line) => line.textContent);
const field = () => screen.getByRole('textbox', { name: 'Ask a side question' }) as HTMLTextAreaElement;
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

let fake: FakeClient;
function listing(exchanges: SideExchange[], more: Parameters<typeof fakeClient>[0] = {}) {
  fake = fakeClient({ 'side.question.list': { exchanges }, ...more });
  window.maws = fake.client as unknown as PreloadBridge;
}
function withProcess(id: AppSessionId, process: 'ready' | 'exited') {
  const s = useSessions.getState();
  useSessions.setState({ records: new Map(s.records).set(id, record(id)), engine: new Map(s.engine).set(id, status(id, { process } as never)) });
}

beforeEach(() => {
  resetPanelStores();
  resetSideQuestions();
  useSidePane.setState({ panes: new Map() });
  useNotices.setState({ notices: [] });
  registerSidePane();
  listing([]);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as { maws?: unknown }).maws;
});

describe('the /btw card', () => {
  it('draws nothing while its session’s card is closed; a typed /btw opens it and reveals no Side pane', async () => {
    withProcess(A, 'ready');
    render(<BtwCard appSessionId={A} />);
    expect(card()).toBeNull();
    expect(chip()).toBeNull();
    await act(async () => void (await applyBtw(A, 'why does it fail?')));
    expect(btwCardOf(useBtwCards.getState(), A).view).toBe('open');
    expect(within(card()!).getByRole('heading', { name: 'Side chat' })).toBeTruthy();
    expect(within(card()!).getByText('why does it fail?')).toBeTruthy();
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: A_ID, question: 'why does it fail?' }]);
    expect(panelOf(A)?.tabs.some((t) => t.toolId === SIDE_TOOL_ID) ?? false).toBe(false);
    expect(sidePaneOf(useSidePane.getState(), A).view).toBeNull();
    expect(document.activeElement).not.toBe(field()); // typed in the composer: the keyboard stays where it was
  });

  it('reads the transcript’s waiting words while the answer is awaited, counting from when it was asked: 8s, then “Still thinking” from ten', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(T);
    listing([pending({ askedAt: iso(T - 8_000) })]);
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await settle();
    expect(waiting()).toEqual(['Thinking · 8s']);
    act(() => vi.advanceTimersByTime(4_000));
    expect(waiting()).toEqual(['Still thinking · 12s']);
    act(() => onSideOperation(completion(A, 'op-1', answered('ZEBRA'))));
    await screen.findByText('ZEBRA');
    expect(waiting()).toEqual([]); // the line stops at the answer
  });

  it('never counts below zero: a question whose time is ahead of this window’s reads 0s', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(T);
    listing([pending({ askedAt: iso(T + 5_000) })]);
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await settle();
    expect(waiting()).toEqual(['Thinking · 0s']);
  });

  it('a failure ends the waiting line with its reason and Retry, which asks again', async () => {
    withProcess(A, 'ready');
    listing([pending()]);
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await settle();
    expect(waiting()).toHaveLength(1);
    act(() => onSideOperation(completion(A, 'op-1', { ok: false, error: { code: 'timeout', message: 'The side question timed out', engineCode: null } })));
    expect(waiting()).toEqual([]);
    expect(within(card()!).getByRole('alert').textContent).toContain('The side question timed out');
    await userEvent.click(within(card()!).getByRole('button', { name: 'Retry' }));
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: A_ID, question: 'What word?', retryOf: 'op-1' }]);
  });

  it('folds to a chip in the same corner that shows the waiting line, then a dot for an answer not seen; opening clears it', async () => {
    listing([pending()]);
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await settle();
    await userEvent.click(within(card()!).getByRole('button', { name: 'Fold side chat' }));
    expect(card()).toBeNull();
    expect(chip()!.textContent).toContain('Side chat');
    expect(waiting(chip()!)).toEqual([expect.stringMatching(/^(Thinking|Still thinking|Thinking more|Thinking some more|Deep in thought) · /)]);
    expect(chip()!.querySelector('[data-btw-unseen]')).toBeNull();
    act(() => onSideOperation(completion(A, 'op-1', answered('ZEBRA'))));
    listing([exchange({})]); // the host's log holds the answer now
    expect(waiting(chip()!)).toEqual([]);
    expect(chip()!.querySelector('[data-btw-unseen]')).not.toBeNull();
    await userEvent.click(chip()!);
    await screen.findByText('ZEBRA');
    await userEvent.click(within(card()!).getByRole('button', { name: 'Fold side chat' }));
    expect(chip()!.querySelector('[data-btw-unseen]')).toBeNull(); // seen once the card was open
  });

  // M7's review, 1: folding or closing hides the conversation and keeps a question not asked yet
  it('a question typed and not asked is still in the field after a fold and after a close, and nothing was asked', async () => {
    withProcess(A, 'ready');
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await settle();
    await userEvent.type(field(), 'half a question');
    await userEvent.click(within(card()!).getByRole('button', { name: 'Fold side chat' }));
    await userEvent.click(chip()!);
    expect(field().value).toBe('half a question');
    await userEvent.click(within(card()!).getByRole('button', { name: 'Close side chat' }));
    act(() => openBtwCard(A));
    expect(field().value).toBe('half a question');
    expect(fake.invoked('session.sideQuestion')).toEqual([]);
  });

  // M7's review, 3: a card mounted in a pane that is not on screen (a kept tab, a covered main area) sees nothing
  it('an answer that settles while the session is not on screen is unseen until it is shown, though its card is open', async () => {
    listing([pending({ question: 'Over here?' })]);
    act(() => openBtwCard(B));
    render(<BtwCard appSessionId={B} />); // mounted, as a kept tab's content is, while the window shows A
    await screen.findByText('Over here?');
    act(() => onSideOperation(completion(B, 'op-1', answered('ZEBRA'))));
    await screen.findByText('ZEBRA');
    const unseen = () => btwUnseen(btwCardOf(useBtwCards.getState(), B), sidePaneOf(useSidePane.getState(), B).exchanges ?? []);
    expect(unseen()).toBe(true);
    act(() => useLayout.setState({ main: mainShowing(B) }));
    expect(unseen()).toBe(false);
  });

  // the panel's finding 9: the guard on a promotion in flight outlives the card's fold, so a second press opens no second thread
  it('a “Continue as a side thread” in flight stays in flight across a fold: the button still reads Starting… and a second press asks nothing', async () => {
    fake = fakeClient({ 'side.question.list': { exchanges: [exchange({})] } }); // `side.thread.open` left unanswered
    window.maws = fake.client as unknown as PreloadBridge;
    withProcess(A, 'ready');
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await screen.findByText('ZEBRA');
    await userEvent.click(within(card()!).getByRole('button', { name: 'Continue as a side thread' }));
    expect(fake.invoked('side.thread.open')).toHaveLength(1);
    await userEvent.click(within(card()!).getByRole('button', { name: 'Fold side chat' }));
    await userEvent.click(chip()!);
    await screen.findByText('ZEBRA');
    const again = within(card()!).getByRole('button', { name: 'Starting…' }) as HTMLButtonElement;
    expect(again.disabled).toBe(true);
    await userEvent.click(again);
    expect(fake.invoked('side.thread.open')).toHaveLength(1);
  });

  // the panel's finding 8: a folded card mounted again (a remote session's tab reopened after its session was forgotten,
  // whose first opening says no `remote.reopened`) lists the log, so the chip says what the host holds
  it('a folded card mounted again lists the log: an answer that settled meanwhile ends the waiting line and sets the dot', async () => {
    listing([pending()]);
    act(() => openBtwCard(A));
    const first = render(<BtwCard appSessionId={A} />);
    await settle();
    await userEvent.click(within(card()!).getByRole('button', { name: 'Fold side chat' }));
    expect(waiting(chip()!)).toHaveLength(1);
    first.unmount();
    listing([exchange({})]); // answered while no pane drew the session, and no completion heard
    render(<BtwCard appSessionId={A} />);
    await settle();
    expect(fake.invoked('side.question.list')).toEqual([{ appSessionId: A_ID }]);
    expect(waiting(chip()!)).toEqual([]);
    expect(chip()!.querySelector('[data-btw-unseen]')).not.toBeNull();
  });

  // the panel's finding 10: a late answer to a question seen failed is new, though its exchange keeps its id
  it('a late answer that replaces a failure seen in the open card sets the dot on the folded chip', async () => {
    listing([exchange({ state: 'failed', response: null, error: 'The side question timed out' })]);
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await screen.findByText(/timed out/);
    await userEvent.click(within(card()!).getByRole('button', { name: 'Fold side chat' }));
    expect(chip()!.querySelector('[data-btw-unseen]')).toBeNull(); // the failure was seen
    act(() => onSideOperation({ ...completion(A, 'op-1', answered('ZEBRA')), late: true }));
    expect(sidePaneOf(useSidePane.getState(), A).exchanges).toEqual([expect.objectContaining({ id: 'op-1', state: 'answered', response: 'ZEBRA' })]);
    expect(chip()!.querySelector('[data-btw-unseen]')).not.toBeNull();
  });

  // the architect's review of finding 8: a listing asked before a completion and answered after it holds the exchange as
  // it was, pending; it never takes the place of the answer this window has applied since
  it('a listing that a completion crossed leaves the exchange answered, and the folded chip keeps its dot', async () => {
    fake = fakeClient(); // every listing answered by hand
    window.maws = fake.client as unknown as PreloadBridge;
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await act(() => fake.reply('side.question.list', { exchanges: [pending()] }));
    await userEvent.click(within(card()!).getByRole('button', { name: 'Fold side chat' }));
    expect(fake.pending('side.question.list')).toBe(1); // the chip's own listing, asked while the answer is awaited
    act(() => onSideOperation(completion(A, 'op-1', answered('ZEBRA'))));
    await act(() => fake.reply('side.question.list', { exchanges: [pending()] }));
    expect(sidePaneOf(useSidePane.getState(), A).exchanges).toEqual([expect.objectContaining({ id: 'op-1', state: 'answered', response: 'ZEBRA' })]);
    expect(waiting(chip()!)).toEqual([]);
    expect(chip()!.querySelector('[data-btw-unseen]')).not.toBeNull();
    while (fake.pending('side.question.list') > 0) await act(() => fake.reply('side.question.list', { exchanges: [exchange({})] })); // the host's log, settled before its completion went out
    expect(sidePaneOf(useSidePane.getState(), A).exchanges).toEqual([expect.objectContaining({ id: 'op-1', state: 'answered', response: 'ZEBRA' })]);
    expect(chip()!.querySelector('[data-btw-unseen]')).not.toBeNull();
  });

  it('closing while an answer is awaited loses nothing: the exchange is there at the next open, unseen until then', async () => {
    withProcess(A, 'ready');
    listing([pending()]);
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await settle();
    await userEvent.click(within(card()!).getByRole('button', { name: 'Close side chat' }));
    expect(card()).toBeNull();
    expect(chip()).toBeNull();
    act(() => onSideOperation(completion(A, 'op-1', answered('ZEBRA'))));
    listing([exchange({})]); // the host's log holds the answer now
    expect(btwUnseen(btwCardOf(useBtwCards.getState(), A), sidePaneOf(useSidePane.getState(), A).exchanges ?? [])).toBe(true);
    await act(async () => void (await applyBtw(A, 'and then?')));
    expect(within(card()!).getByText('What word?')).toBeTruthy();
    await screen.findByText('ZEBRA');
    expect(btwUnseen(btwCardOf(useBtwCards.getState(), A), sidePaneOf(useSidePane.getState(), A).exchanges ?? [])).toBe(false);
  });

  it('the field reads “Ask a quick question…” before the first exchange and “Follow up…” after; Enter asks, Shift+Enter breaks the line', async () => {
    withProcess(A, 'ready');
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await settle();
    expect(field().placeholder).toBe('Ask a quick question…');
    await userEvent.type(field(), 'First line{Shift>}{Enter}{/Shift}second');
    expect(fake.invoked('session.sideQuestion')).toEqual([]);
    expect(field().value).toBe('First line\nsecond');
    await userEvent.type(field(), '{Enter}');
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: A_ID, question: 'First line\nsecond' }]);
    expect(field().value).toBe('');
    expect(field().placeholder).toBe('Follow up…');
    expect(waiting(card()!)).toHaveLength(1); // pending at once
  });

  it('Clear starts a new side conversation; “Continue as a side thread” opens the thread from the answered exchanges', async () => {
    withProcess(A, 'ready');
    listing([exchange({})], { 'side.question.clear': {} });
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await screen.findByText('ZEBRA');
    await userEvent.type(field(), 'Now fix it.');
    await userEvent.click(within(card()!).getByRole('button', { name: 'Continue as a side thread' }));
    expect(fake.invoked('side.thread.open')).toEqual([{ appSessionId: A_ID, from: { kind: 'btw', exchanges: [{ question: 'What word?', response: 'ZEBRA' }], text: 'Now fix it.' } }]);
    await userEvent.click(within(card()!).getByRole('button', { name: 'Clear' }));
    expect(fake.invoked('side.question.clear')).toEqual([{ appSessionId: A_ID }]);
  });

  // moved from the Side pane's question view (side/SideTool.test.tsx)
  it('draws a pending question with a doubt as waiting still, the doubt said beside a Retry', async () => {
    listing([pending({ id: 'op-5', question: 'Still?', error: 'It may have been asked: its answer shows here if it was' })]);
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await screen.findByText('Still?');
    expect(waiting(card()!)).toHaveLength(1);
    const doubt = card()!.querySelector<HTMLElement>('[data-side-uncertain]')!;
    expect(doubt.textContent).toContain('It may have been asked: its answer shows here if it was');
    expect(within(doubt).getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(within(card()!).queryByRole('alert')).toBeNull();
  });

  it('on an exited session, Enter starts the session first and then asks once; opening the card acquires nothing', async () => {
    listing([exchange({})]);
    withProcess(A, 'exited');
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await screen.findByText('ZEBRA');
    expect(fake.invoked('session.acquire')).toEqual([]);
    expect(within(card()!).getByText('Starts this session')).toBeTruthy();
    await userEvent.type(field(), 'More?{Enter}');
    expect(fake.invoked('session.acquire')).toEqual([{ appSessionId: A_ID, reason: 'side' }]);
    expect(within(card()!).getByText('Starting…')).toBeTruthy();
    expect(fake.invoked('session.sideQuestion')).toEqual([]);
    await act(() => fake.reply('session.acquire', { status: 'ready', appSessionId: A_ID, launched: true, joined: false }));
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: A_ID, question: 'More?' }]);
    expect(field().value).toBe('');
    expect(fake.invoked('session.acquire')).toHaveLength(1);
  });

  it('a session a terminal holds: Enter and Retry ask nothing, the holder named; continuing as a thread stays possible', async () => {
    listing([exchange({}), exchange({ id: 'op-2', state: 'failed', response: null, error: 'The session ended' })]);
    useSessions.setState((s) => ({ records: new Map(s.records).set(A, { ...record(A), holder: { kind: 'terminal', pid: 42 } }), digests: new Map([[A, digest(A, { availability: 'foreign_held' })]]) }));
    act(() => openBtwCard(A));
    render(<BtwCard appSessionId={A} />);
    await screen.findByText('ZEBRA');
    expect(within(card()!).getByText('Held by terminal · 42')).toBeTruthy();
    await userEvent.type(field(), 'More?{Enter}');
    expect((within(card()!).getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(card()!).getByRole('button', { name: 'Continue as a side thread' }) as HTMLButtonElement).disabled).toBe(false);
    expect(fake.invoked('session.acquire')).toEqual([]);
    expect(fake.invoked('session.sideQuestion')).toEqual([]);
  });

  it('asked from a session that is not the shown one, the card is that session’s, and a toast says where the question went', async () => {
    withProcess(B, 'ready');
    useSessions.setState((s) => ({ records: new Map(s.records).set(B, { ...record(B), title: { text: 'Refactor', source: 'user' } }) }));
    await act(async () => void (await applyBtw(B, 'why?')));
    expect(btwCardOf(useBtwCards.getState(), B).view).toBe('open');
    expect(btwCardOf(useBtwCards.getState(), A).view).toBe('closed');
    expect(panelOf(B)?.tabs.some((t) => t.toolId === SIDE_TOOL_ID) ?? false).toBe(false);
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['Side question asked in the side chat of Refactor']);
    render(<BtwCard appSessionId={B} />); // there when its tab is shown
    expect(within(card()!).getByText('why?')).toBeTruthy();
  });
});

describe('the palette’s /btw', () => {
  it('a pick (or a bare /btw) on a session that can take a question opens the card with its field focused, and closes the dialog unseen', async () => {
    withProcess(A, 'ready');
    const close = vi.fn();
    render(
      <>
        <BtwCard appSessionId={A} />
        <BtwWidget appSessionId={A} args="" close={close} />
      </>,
    );
    expect(close).toHaveBeenCalledTimes(1);
    expect(btwCardOf(useBtwCards.getState(), A).view).toBe('open');
    expect(document.activeElement).toBe(within(card()!).getByRole('textbox', { name: 'Ask a side question' }));
    expect(fake.invoked('session.sideQuestion')).toEqual([]);
  });

  it('with a question the widget asks it in the card; a session that cannot take one yet keeps the dialog', async () => {
    withProcess(A, 'ready');
    const close = vi.fn();
    render(<BtwWidget appSessionId={A} args=" why? " close={close} />);
    expect(close).toHaveBeenCalledTimes(1);
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: A_ID, question: 'why?' }]);
    expect(btwCardOf(useBtwCards.getState(), A).view).toBe('open');
    cleanup();
    withProcess(B, 'exited');
    const kept = vi.fn();
    render(<BtwWidget appSessionId={B} args="" close={kept} />);
    expect(kept).not.toHaveBeenCalled();
    expect(btwCardOf(useBtwCards.getState(), B).view).toBe('closed');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy();
  });
});

describe('the /btw card for a session on another machine', () => {
  const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  const R_ID = bareOf(R);
  beforeEach(() => {
    resetRemoteSurfaces();
    resetRemoteLaneBStore();
    useMachines.getState().applyRoster([{ ref: OTHER_MACHINE, name: 'mini', local: false, state: 'up', since: '2026-10-31T10:00:00.000Z', generation: 1, carrier: 'relay' }]);
    useSessions.setState({ engine: new Map([[R, status(R)]]), listed: new Map([[R, { ...remoteRow(OTHER_MACHINE, 'app-r'), appId: R }]]), listedMachines: new Set([OTHER_MACHINE]) });
  });
  afterEach(() => {
    resetRemoteSurfaces();
    useSessions.setState({ engine: new Map(), listed: new Map(), listedMachines: new Set() });
  });
  const remoteListing = (exchanges: SideExchange[]) => {
    fake = fakeClient({ 'side.question.list': { exchanges } });
    window.maws = { ...(fake.client as unknown as PreloadBridge), localMachine: TEST_MACHINE };
  };

  it('asks the machine, and counts the wait from when this window first held it pending, never from the other machine’s clock', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(T);
    remoteListing([pending({ id: 'op-7', question: 'Over there?', askedAt: iso(T - 3_600_000) })]); // its clock an hour off ours
    act(() => openBtwCard(R));
    render(<BtwCard appSessionId={R} />);
    await settle();
    expect(waiting()).toEqual(['Thinking · 0s']);
    act(() => vi.advanceTimersByTime(3_000));
    expect(waiting()).toEqual(['Thinking · 3s']);
    fireEvent.change(field(), { target: { value: 'And here?' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await settle();
    expect(fake.invoked('session.sideQuestion')).toEqual([{ appSessionId: R_ID, question: 'And here?' }]);
  });

  it('a question asked from this window keeps its count when the machine’s entry takes its place', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(T);
    fake = fakeClient(); // every listing answered by hand
    window.maws = { ...(fake.client as unknown as PreloadBridge), localMachine: TEST_MACHINE };
    act(() => openBtwCard(R));
    render(<BtwCard appSessionId={R} />);
    await act(() => fake.reply('side.question.list', { exchanges: [] }));
    fireEvent.change(field(), { target: { value: 'Over there?' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await settle();
    act(() => vi.advanceTimersByTime(5_000));
    expect(waiting()).toEqual(['Thinking · 5s']);
    await act(() => fake.reply('session.sideQuestion', { opId: 'op-8' }));
    await act(() => fake.reply('side.question.list', { exchanges: [pending({ id: 'op-8', question: 'Over there?', askedAt: iso(T - 3_600_000) })] }));
    expect(waiting()).toEqual(['Thinking · 5s']);
  });

  // moved from side/BtwView-remote.test.tsx
  it('greys Continue as a side thread with the declared reason, and Clear once the machine was heard not offering it', async () => {
    remoteListing([exchange({}), exchange({ id: 'op-2', question: 'Again?', state: 'failed', response: null, error: 'The side question failed' })]);
    act(() => openBtwCard(R));
    render(<BtwCard appSessionId={R} />);
    await screen.findByText('ZEBRA');
    const promote = within(card()!).getByRole('button', { name: 'Continue as a side thread' });
    expect(promote).toHaveProperty('disabled', true);
    expect(promote.title).toBe(REMOTE_UNAVAILABLE['side.thread.open']);
    const clear = within(card()!).getByRole('button', { name: 'Clear' });
    expect(clear).toHaveProperty('disabled', false);
    act(() => heardRefusal('side.question.clear', { issues: { refusal: 'not-offered' } }, OTHER_MACHINE, TEST_MACHINE));
    expect(clear).toHaveProperty('disabled', true);
    expect(clear.title).toBe('mini doesn’t offer this');
  });

  it('greys Enter and Retry once the machine was heard not offering side questions, and asks nothing', async () => {
    remoteListing([exchange({}), exchange({ id: 'op-2', question: 'Again?', state: 'failed', response: null, error: 'The side question failed' })]);
    act(() => openBtwCard(R));
    render(<BtwCard appSessionId={R} />);
    await screen.findByText('ZEBRA');
    act(() => heardRefusal('session.sideQuestion', { issues: { refusal: 'not-offered' } }, OTHER_MACHINE, TEST_MACHINE));
    fireEvent.change(field(), { target: { value: 'Still there?' } });
    expect(within(card()!).getByText('mini doesn’t offer this')).toBeTruthy();
    expect(within(card()!).getByRole('button', { name: 'Retry' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(field(), { key: 'Enter' });
    fireEvent.click(within(card()!).getByRole('button', { name: 'Retry' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(fake.invoked('session.sideQuestion')).toEqual([]);
  });
});

describe('the /btw card for a terminal session', () => {
  const L = at('app-side-l' as AppSessionId); // the page's ids are addresses (P5 O6 M2)
  beforeEach(() => {
    resetLaneAStore();
    resetLaneAWatches();
    useSessions.setState({ engine: new Map(), digests: new Map(), records: new Map([[L, record(L, { holder: { kind: 'terminal', pid: 4242 } })]]) });
    applyLaneAState(L, laneAState(L));
  });

  it('asks through the bridge and draws the answer from its op’s end, never the host’s listing', async () => {
    fake = fakeClient({ 'laneA.btw': { state: 'done', result: { started: true, id: 'cmd-9' } }, 'laneA.watch': { watch: 'w-1' }, 'laneA.unwatch': undefined });
    window.maws = preloadOf(fake); // the bridge's events reach the renderer's own client
    await act(async () => void (await applyBtw(L, 'why?')));
    render(<BtwCard appSessionId={L} />);
    expect(within(card()!).getByText('why?')).toBeTruthy();
    expect(waiting(card()!)).toHaveLength(1);
    await settle();
    const msg = (body: unknown) => ({ project: '', machine: 'm', session: 'eng-1', kind: 'op', sub: 'w-1', n: 1, body });
    act(() => fake.event('laneA.plane', { appSessionId: bareOf(L) /* main's bare id */, watch: 'w-1', messages: [msg({ rpc: 'cmd-9', op: 'btw', phase: 'end', id: 'cmd-9', text: 'Because.' })] }));
    await screen.findByText('Because.');
    expect(waiting(card()!)).toEqual([]);
    expect(fake.invoked('side.question.list')).toEqual([]);
  });
});
