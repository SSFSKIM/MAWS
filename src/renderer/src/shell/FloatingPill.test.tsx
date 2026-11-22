// WR #59: exercise the compact surface with the real Composer/EditorController, including session changes and
// the compact-to-expanded swap. A slot probe cannot catch a draft or keyboard owner surviving the wrong boundary.
// UX wave U10b (O-43; its execution document §F.3, §F.4, M7): the compact surface is the bar, the composer's box alone.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { MachineState } from '@shared/ipc/schema/machines';
import { addressOf } from '@shared/machine/address';
import { LAYOUT_DEFAULTS, type TabRef } from '@shared/ipc/schema/layout';
import type { Draft } from '@shared/ipc/schema/session';
import { humanTurn, record, status, T0 } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { at, OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import type { PreloadBridge } from '@shared/ipc/schema';
import { registerSlot, resetSlots } from '../app/slots';
import { Composer } from '../composer/Composer';
import { ComposerAppKeys, focusedSession } from '../composer/ComposerAppKeys';
import { docOf, paragraph, textNode } from '../composer/editor/doc';
import { connectKeys } from '../keymap/dispatcher';
import { itemFor, permission, type RequestEvent } from '../request-card/test-requests';
import { useAttention } from '../stores/attention';
import { queueComposerAttachment, resetComposerStore, useComposerStore } from '../stores/composer';
import { useMachines } from '../stores/machines';
import { sendToSession } from '../session/controls/controls-for';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { mainShowing, ref } from '../test-support/panel';
import { resetShellStores } from '../test-support/shell-stores';
import { FloatingCardLayer, SplitCardLayer } from './FloatingCard';
import { chatPresentation, hideChat, useFloatingCard } from './floating';
import { drawsBesideTheBox } from './FloatingPill';
import { accessibleText } from '../test-support/accessible-text';

// P5 O6 M2: the page holds addresses; the fake `window.maws` (main) is asked with, and keys its drafts by, the bare ids
const BARE_A = 'app-a' as AppSessionId;
const BARE_B = 'app-b' as AppSessionId;
const A = at(BARE_A);
const B = at(BARE_B);
const tab = (id: AppSessionId): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
const message = () => screen.getByRole('textbox', { name: 'Message', hidden: true }) as HTMLElement & { editor: Editor };
const compact = () => screen.getByRole('region', { name: 'Chat' });
let queued: QueueEntry[] = [];
let fake: ReturnType<typeof fakeClient>;
let query: QueryClient;
let drafts: Map<AppSessionId, Draft | null>;
let disconnect: () => void;

beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  drafts = new Map();
  queued = [];
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fake = fakeClient({
    'session.queue.list': () => ({ entries: queued, paused: false, pauseReason: null }),
    'session.history.list': { entries: [] },
    'session.drafts.get': ({ appSessionId }: { appSessionId: AppSessionId }) => drafts.get(appSessionId) ?? null,
    'session.drafts.set': ({ appSessionId, draft }: { appSessionId: AppSessionId; draft: Draft | null }) => { drafts.set(appSessionId, draft); },
    'session.history.append': undefined,
    'session.send': { messageUuid: null, disposition: 'sent', queueId: 'q-1' },
    'session.interrupt': { stillQueued: [], cancelled: [] },
  });
  window.maws = fake.client as unknown as PreloadBridge;
  // A selected surface, not the now-floating summary cards, gives the panel float something to stand over.
  // Keep the pinned terminal selected for both sessions so switching A/B tests the same live card boundary.
  const terminal = ref('terminal:shared00', true);
  useLayout.setState({
    main: mainShowing(A),
    panelPinned: [terminal],
    panelBySession: new Map([A, B].map((id) => [id, { tabs: [], activeTabId: terminal.id }])),
  });
  useSessions.setState({ records: new Map([[A, record(A)], [B, record(B)]]), engine: new Map([[A, status(A)], [B, status(B)]]) });
  useFloatingCard.setState({ closed: true, pillTakesFocus: false, column: null, columnDrag: null, pillHost: null });
  registerSlot('composer', Composer);
  disconnect = connectKeys();
  // happy-dom has no layout; either layer is a 1000 x 700 host.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
});
afterEach(() => {
  disconnect();
  cleanup();
  resetSlots();
  query.clear();
  delete (window as { maws?: unknown }).maws;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mount(host: 'panel' | 'split' = 'panel') {
  if (host === 'panel') useLayout.getState().setPanel({ floating: true });
  useFloatingCard.setState({ closed: true });
  const body = document.body.appendChild(document.createElement('div'));
  return render(<QueryClientProvider client={query}>
    <ComposerAppKeys />
    <button>Elsewhere</button>
    {host === 'panel' ? <FloatingCardLayer body={{ current: body }} /> : <SplitCardLayer />}
  </QueryClientProvider>);
}

async function stop() {
  await act(async () => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: '.', code: 'Period', metaKey: true, bubbles: true, cancelable: true }));
  });
}

it('follows panel selection with a separate editor, draft persistence and submission for each session', async () => {
  drafts.set(BARE_B, { doc: docOf([paragraph(textNode('Beta draft'))]), attachments: [], updatedAt: T0 });
  mount();
  await waitFor(() => expect(fake.invoked('session.drafts.get')).toHaveLength(1));
  act(() => void message().editor.commands.insertContent('Alpha private draft'));
  act(() => useLayout.setState({ main: mainShowing(B) }));
  await waitFor(() => expect(message().editor.getText()).toBe('Beta draft'));
  expect(compact().querySelector('[data-composer]')?.getAttribute('data-composer')).toBe(B);
  fireEvent.click(within(compact()).getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(fake.invoked('session.send')).toEqual([{ appSessionId: BARE_B, content: 'Beta draft' }]));
  act(() => useLayout.setState({ main: mainShowing(A) }));
  await waitFor(() => expect(message().editor.getText()).toBe('Alpha private draft'));
});

it.each(['pointer', 'keyboard'] as const)('routes compact %s interaction to its pane without expanding; tab/sidebar selection still targets normally', async (interaction) => {
  const [a, b] = [tab(A), tab(B)];
  useLayout.setState({ main: { ...LAYOUT_DEFAULTS.main, panes: [{ tabs: [a], activeTabId: a.id }, { tabs: [b], activeTabId: b.id }], focusedPane: 1, splitRatio: 0.5, floating: { sessionTabId: a.id } } });
  useSessions.setState({ engine: new Map([[A, status(A, { engineState: 'running', turn: humanTurn })], [B, status(B, { engineState: 'running', turn: humanTurn })]]) });
  mount('split');
  await waitFor(() => expect(message()).toBeTruthy());
  act(() => {
    if (interaction === 'pointer') fireEvent.pointerDown(message(), { button: 0 });
    else message().focus();
  });
  expect(focusedSession()).toBe(A);
  expect(useFloatingCard.getState().closed).toBe(true);
  expect(screen.queryByRole('region', { name: 'Session card' })).toBeNull();
  await stop();
  expect(fake.invoked('session.interrupt').at(-1)).toMatchObject({ appSessionId: BARE_A });

  // Tab selection may leave the DOM editor focused until its next input; the layout target must still win.
  act(() => useLayout.getState().activateTab(b.id));
  expect(focusedSession()).toBe(B);
  await stop();
  expect(fake.invoked('session.interrupt').at(-1)).toMatchObject({ appSessionId: BARE_B });
  expect(useFloatingCard.getState().closed).toBe(true);
  // A sidebar selection of the floated session deliberately opens it, unlike typing in the compact surface.
  act(() => useLayout.getState().openSession(A));
  expect(currentSet(useLayout.getState().main).focusedPane).toBe(0);
  expect(useFloatingCard.getState().closed).toBe(false);
  expect(await screen.findByRole('region', { name: 'Session card' })).toBeTruthy();
});

function request(kind: 'permission' | 'question'): RequestEvent {
  const p = permission();
  if (kind === 'permission') return p;
  return {
    id: p.id, sessionId: p.sessionId, at: p.at, seq: p.seq, agentId: p.agentId, parentToolUseId: p.parentToolUseId,
    kind: 'question.requested', requestId: p.requestId, toolUseId: p.toolUseId,
    questions: [{ question: 'Which branch should I use?', header: 'Branch', options: [{ label: 'Current', description: null, preview: null }], multiSelect: false }],
  };
}

it.each([
  ['permission', true], ['question', true], ['permission', false], ['question', false],
] as const)('a fresh %s expands with focus handed over only when compact owned it (%s)', async (kind, ownedFocus) => {
  mount();
  await waitFor(() => expect(message()).toBeTruthy());
  act(() => void message().editor.commands.insertContent('Draft retained across expansion'));
  const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
  act(() => (ownedFocus ? message() : elsewhere).focus());
  const event = request(kind);
  const bare = itemFor(event, A);
  const item = { ...bare, id: at(bare.id) };
  act(() => useAttention.setState({ bySession: new Map([[A, [item]]]), requests: new Map([[item.id, event]]) }));
  const card = await screen.findByRole('region', { name: 'Session card' });
  // UX wave U1b: the request is drawn in the session's transcript, never in the composer's place, so the card's own
  // composer takes the keyboard the compact one held
  expect(card.querySelector('[data-docked-frame]')).toBeNull();
  await waitFor(() => expect(ownedFocus ? card.contains(document.activeElement) && message().contains(document.activeElement) : document.activeElement === elsewhere).toBe(true));
  expect(useComposerStore.getState().focusOnMount.has(A)).toBe(false);
  await waitFor(() => expect(message().editor.getText()).toBe('Draft retained across expansion'));
});

// ---- UX wave U10b (O-43; §F.3, §F.4, M7): the bar --------------------------------------------------------------------

const surfaceOf = (bar: HTMLElement) => bar.querySelector<HTMLElement>('[data-bar-surface]')!;
const boxOf = (bar: HTMLElement) => bar.querySelector<HTMLElement>('[data-composer-box]')!;
const precedes = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

it('is the composer’s box alone: no toolbar in the accessibility tree, no title button, Open conversation and Hide chat; 484 px', async () => {
  mount();
  await waitFor(() => expect(message()).toBeTruthy());
  const bar = compact();
  expect([bar.dataset.pane, bar.dataset.compactSession, bar.dataset.chatPresentation]).toEqual(['card', A, 'bar']);
  expect(within(bar).queryByRole('toolbar'), 'the toolbar is not in the accessibility tree').toBeNull();
  expect(bar.querySelector('[role="toolbar"]')?.closest('[hidden]'), 'it stays mounted, hidden, as under a docked card').not.toBeNull();
  expect(within(bar).queryByRole('button', { name: 'Show session card' }), 'no title button').toBeNull();
  expect(within(bar).getByRole('button', { name: 'Open conversation' }).title).toBe(useSessions.getState().records.get(A)!.title.text);
  expect(within(bar).getByRole('button', { name: 'Hide chat' })).toBeTruthy();
  expect(bar.style.width).toBe('484px');
  expect([bar.style.right, bar.style.bottom]).toEqual(['16px', '16px']);
  expect(bar.style.getPropertyValue('--measure-pad'), 'the composer column has no side padding in the bar').toBe('0px');
  expect(boxOf(bar).className).toContain('border-border-strong');
  expect(boxOf(bar).className, 'the box carries the float’s border and shadow').toContain('shadow-float');
  expect(surfaceOf(bar).hasAttribute('data-raised'), 'nothing above the box: no surface').toBe(false);
});

it('draws attached files and a waiting message above the box, on the raised surface', async () => {
  queued = [{ queueId: 'q-9', appSessionId: BARE_A, content: 'Then tidy the summary', createdAt: '2026-11-15T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false }];
  window.maws = { ...(fake.client as unknown as PreloadBridge), pathForFile: () => '' } as PreloadBridge; // a dropped file's path, as the preload gives it
  mount();
  await waitFor(() => expect(message()).toBeTruthy());
  queueComposerAttachment(A, { files: [new File(['%PDF-1.4'], 'hall-booking.pdf', { type: 'application/pdf' })], text: '' });
  const bar = compact();
  const files = await within(bar).findByRole('list', { name: 'attachments' });
  expect(files.textContent).toContain('hall-booking.pdf');
  const waiting = await within(bar).findByText('Then tidy the summary');
  await waitFor(() => expect(surfaceOf(bar).hasAttribute('data-raised')).toBe(true));
  for (const above of [files, waiting]) {
    expect(surfaceOf(bar).contains(above)).toBe(true);
    expect(precedes(above, boxOf(bar)), 'above the box').toBe(true);
  }
});

it('a comment sent to the session while the chat is hidden is delivered and opens nothing (UC-5)', async () => {
  mount();
  await waitFor(() => expect(message()).toBeTruthy());
  act(() => hideChat());
  expect(chatPresentation(useFloatingCard.getState())).toBe('hidden');
  expect(screen.queryByRole('region', { name: 'Chat' })).toBeNull();
  await act(async () => void (await sendToSession(A, 'Shorten the second paragraph', { origin: 'comment' })));
  expect(fake.invoked('session.send')).toEqual([expect.objectContaining({ appSessionId: BARE_A, content: 'Shorten the second paragraph' })]);
  expect(chatPresentation(useFloatingCard.getState())).toBe('hidden');
  expect(screen.queryByRole('region', { name: 'Session card' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Chat' })).toBeNull();
});

// A6's routes: the bar is the session's compact pane, so what the pane draws in the composer's place or above it is in the
// bar, on the raised surface, beside its two buttons.
it('a terminal session that cannot be driven shows the holder’s notice in the box’s place, on the raised surface, with both buttons', async () => {
  useSessions.setState({ records: new Map([[A, { ...record(A), holder: { kind: 'terminal', pid: 4242 } }], [B, record(B)]]) });
  mount();
  const bar = compact();
  const notice = await within(bar).findByRole('note');
  expect(accessibleText(notice)).toContain('Live in Terminal · read-only'); // the word cut (C128): the pid waits on the line
  expect(bar.querySelector('[data-composer]'), 'no composer in its place').toBeNull();
  await waitFor(() => expect(surfaceOf(bar).hasAttribute('data-raised')).toBe(true));
  expect(surfaceOf(bar).contains(notice)).toBe(true);
  expect(within(bar).getAllByRole('button', { name: /^(Open conversation|Hide chat)$/ })).toHaveLength(2);
});

it('a session whose machine’s link is not up shows the link’s phase words above the box, on the raised surface', async () => {
  const R = addressOf(OTHER_MACHINE, 'app-r' as AppSessionId);
  const machine = (state: MachineState['state']): MachineState => ({ ref: OTHER_MACHINE, name: 'Studio', local: false, state, since: new Date().toISOString(), generation: 0 });
  act(() => useMachines.getState().applyRoster([{ ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: new Date().toISOString(), generation: 0 }, machine('connecting')]));
  registerSlot('composer', () => <div data-testid="composer" data-composer-box="" />); // the composer's place, as a probe: its box alone
  useSessions.setState({ records: new Map([[R, record(R)]]), engine: new Map() });
  useLayout.setState({ main: mainShowing(R), panelBySession: new Map([[R, { tabs: [], activeTabId: useLayout.getState().panelPinned[0]!.id }]]) });
  mount();
  const bar = compact();
  const line = bar.querySelector<HTMLElement>('[data-link-phase]');
  expect(line?.textContent).toBe('Connecting to Studio…');
  expect(precedes(line!, within(bar).getByTestId('composer'))).toBe(true);
  await waitFor(() => expect(surfaceOf(bar).hasAttribute('data-raised')).toBe(true));
  act(() => useMachines.getState().applyRoster([{ ref: TEST_MACHINE, name: 'This Mac', local: true, state: 'up', since: new Date().toISOString(), generation: 0 }, { ...machine('up'), generation: 1, carrier: 'relay' }]));
  expect(bar.querySelector('[data-link-phase]')).toBeNull();
  await waitFor(() => expect(surfaceOf(bar).hasAttribute('data-raised'), 'the box alone again: no surface').toBe(false));
});

it('reads words or a control outside the box as something above it, and the box, what is hidden, and empty wrappers as nothing', () => {
  const root = document.createElement('div');
  root.innerHTML = '<div><div data-composer-box><p>typed text</p><button>Send</button></div><div hidden><span role="toolbar">Model</span></div><p>   </p></div>';
  expect(drawsBesideTheBox(root)).toBe(false);
  root.insertAdjacentHTML('afterbegin', '<p>Then tidy the summary</p>');
  expect(drawsBesideTheBox(root)).toBe(true);
});
