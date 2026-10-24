// WR #59: exercise the compact surface with the real Composer/EditorController, including session changes and
// the compact-to-expanded swap. A slot probe cannot catch a draft or keyboard owner surviving the wrong boundary.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { LAYOUT_DEFAULTS, NO_PROJECT, type TabRef } from '@shared/ipc/schema/layout';
import type { Draft } from '@shared/ipc/schema/session';
import { humanTurn, record, status, T0 } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { registerSlot, resetSlots } from '../app/slots';
import { Composer } from '../composer/Composer';
import { ComposerAppKeys, focusedSession } from '../composer/ComposerAppKeys';
import { docOf, paragraph, textNode } from '../composer/editor/doc';
import { connectKeys } from '../keymap/dispatcher';
import { itemFor, permission, type RequestEvent } from '../request-card/test-requests';
import { useAttention } from '../stores/attention';
import { resetComposerStore, useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { mainShowing, ref } from '../test-support/panel';
import { resetShellStores } from '../test-support/shell-stores';
import { FloatingCardLayer, SplitCardLayer } from './FloatingCard';
import { useFloatingCard } from './floating';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const tab = (id: AppSessionId): TabRef => ({ id: `session:${id}`, kind: 'session', appSessionId: id, pinned: false });
const message = () => screen.getByRole('textbox', { name: 'Message', hidden: true }) as HTMLElement & { editor: Editor };
const compact = () => screen.getByRole('region', { name: 'Compact session composer' });
let fake: ReturnType<typeof fakeClient>;
let query: QueryClient;
let drafts: Map<AppSessionId, Draft | null>;
let disconnect: () => void;

beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  drafts = new Map();
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fake = fakeClient({
    'session.queue.list': { entries: [], paused: false, pauseReason: null },
    'session.history.list': { entries: [] },
    'session.drafts.get': ({ appSessionId }: { appSessionId: AppSessionId }) => drafts.get(appSessionId) ?? null,
    'session.drafts.set': ({ appSessionId, draft }: { appSessionId: AppSessionId; draft: Draft | null }) => { drafts.set(appSessionId, draft); },
    'session.history.append': undefined,
    'session.send': { messageUuid: null, disposition: 'sent', queueId: 'q-1' },
    'session.interrupt': { stillQueued: [], cancelled: [] },
  });
  window.maws = fake.client;
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
  drafts.set(B, { doc: docOf([paragraph(textNode('Beta draft'))]), attachments: [], updatedAt: T0 });
  mount();
  await waitFor(() => expect(fake.invoked('session.drafts.get')).toHaveLength(1));
  act(() => void message().editor.commands.insertContent('Alpha private draft'));
  act(() => useLayout.setState({ main: mainShowing(B) }));
  await waitFor(() => expect(message().editor.getText()).toBe('Beta draft'));
  expect(compact().querySelector('[data-composer]')?.getAttribute('data-composer')).toBe(B);
  fireEvent.click(within(compact()).getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(fake.invoked('session.send')).toEqual([{ appSessionId: B, content: 'Beta draft' }]));
  act(() => useLayout.setState({ main: mainShowing(A) }));
  await waitFor(() => expect(message().editor.getText()).toBe('Alpha private draft'));
});

it.each(['pointer', 'keyboard'] as const)('routes compact %s interaction to its pane without expanding; tab/sidebar selection still targets normally', async (interaction) => {
  const [a, b] = [tab(A), tab(B)];
  useLayout.setState({ main: { ...LAYOUT_DEFAULTS.main, sets: { [NO_PROJECT]: { panes: [{ tabs: [a], activeTabId: a.id }, { tabs: [b], activeTabId: b.id }], focusedPane: 1, splitRatio: 0.5, floating: { sessionTabId: a.id } } } } });
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
  expect(fake.invoked('session.interrupt').at(-1)).toMatchObject({ appSessionId: A });

  // Tab selection may leave the DOM editor focused until its next input; the layout target must still win.
  act(() => useLayout.getState().activateTab(b.id));
  expect(focusedSession()).toBe(B);
  await stop();
  expect(fake.invoked('session.interrupt').at(-1)).toMatchObject({ appSessionId: B });
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
  const item = itemFor(event, A);
  act(() => useAttention.setState({ bySession: new Map([[A, [item]]]), requests: new Map([[item.id, event]]) }));
  const card = await screen.findByRole('region', { name: 'Session card' });
  const frame = card.querySelector<HTMLElement>('[data-docked-frame]')!;
  expect(frame).not.toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(ownedFocus ? frame : elsewhere));
  expect(useComposerStore.getState().focusOnMount.has(A)).toBe(false);
  await waitFor(() => expect(message().editor.getText()).toBe('Draft retained across expansion'));
});
