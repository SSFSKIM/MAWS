// UX wave U10b (O-43): the observer behind the bar's raised surface (`drawsBesideTheBox` in FloatingPill.tsx), measured.
// It watches the bar's surface; a session streaming its answer redraws nothing there (the compact pane draws no
// transcript), so neither its callback nor the bar runs while deltas arrive; typing in the box runs it at most once a
// keystroke. Counts, not times.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionEvent } from '@shared/graph/events';
import type { PreloadBridge } from '@shared/ipc/schema';
import { humanTurn, record, status } from '../../../../test/support/builders';
import { fakeClient } from '../../../../test/support/fake-client';
import { at } from '../../../../test/support/machine';
import { registerSlot, resetSlots } from '../app/slots';
import { Composer } from '../composer/Composer';
import { resetComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { useTranscriptStore } from '../stores/transcript';
import { mainShowing, ref } from '../test-support/panel';
import { resetShellStores } from '../test-support/shell-stores';
import { api, builder } from '../transcript/model/test-events';
import type { TranscriptSource } from '../transcript/source/types';
import { FloatingCardLayer } from './FloatingCard';
import { useFloatingCard } from './floating';

// Each render of the bar reads its session's mark once: the count of those reads is the count of the bar's renders.
const marks = vi.hoisted(() => ({ reads: 0 }));
vi.mock('./SessionMark', async (original) => {
  const real = await original<typeof import('./SessionMark')>();
  return { ...real, useSessionMark: (id: AppSessionId) => { marks.reads += 1; return real.useSessionMark(id); } };
});

const A = at('app-a' as AppSessionId);
const N = 50;
const K = 20;

// Every observer the page makes, with what it observes, how often its callback ran and whether it was disconnected.
type Watch = { target: Node | null; options: MutationObserverInit | null; runs: number; disconnected: boolean };
let watches: Watch[] = [];
const Native = globalThis.MutationObserver;
class CountingObserver extends Native {
  private readonly watch: Watch;
  constructor(callback: MutationCallback) {
    const watch: Watch = { target: null, options: null, runs: 0, disconnected: false };
    super((records, observer) => {
      watch.runs += 1;
      callback(records, observer);
    });
    this.watch = watch;
    watches.push(watch);
  }
  override observe(target: Node, options?: MutationObserverInit) {
    this.watch.target = target;
    this.watch.options = options ?? null;
    super.observe(target, options);
  }
  override disconnect() {
    this.watch.disconnected = true;
    super.disconnect();
  }
}

let query: QueryClient;
beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  watches = [];
  marks.reads = 0;
  vi.stubGlobal('MutationObserver', CountingObserver);
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fake = fakeClient({
    'session.queue.list': { entries: [], paused: false, pauseReason: null },
    'session.history.list': { entries: [] },
    'session.drafts.get': null,
    'session.drafts.set': undefined,
  });
  window.maws = fake.client as unknown as PreloadBridge;
  const terminal = ref('terminal:shared00', true);
  useLayout.setState({ main: mainShowing(A), panelPinned: [terminal], panelBySession: new Map([[A, { tabs: [], activeTabId: terminal.id }]]) });
  // the session is working: a turn of its own is open while its answer streams
  useSessions.setState({ records: new Map([[A, record(A)]]), engine: new Map([[A, status(A, { engineState: 'running', turn: humanTurn })]]) });
  useLayout.getState().setPanel({ floating: true });
  useFloatingCard.setState({ closed: true, pillTakesFocus: false, column: null, columnDrag: null, pillHost: null });
  registerSlot('composer', Composer);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
});
afterEach(() => {
  cleanup();
  resetSlots();
  query.clear();
  delete (window as { maws?: unknown }).maws;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function mount() {
  const body = document.body.appendChild(document.createElement('div'));
  return render(<QueryClientProvider client={query}><FloatingCardLayer body={{ current: body }} /></QueryClientProvider>);
}

// The session's transcript, attached as the app attaches it, with the batches the test pushes.
async function streamingTranscript() {
  let push: (events: SessionEvent[]) => void = () => {};
  const source: TranscriptSource = { subscribe: (listener) => { push = listener; return () => {}; }, snapshot: () => Promise.resolve([]) };
  await act(() => useTranscriptStore.getState().attach(A, source));
  const b = builder();
  b.turn('u1');
  act(() => push(b.events.splice(0)));
  // one delta per task, as the wire delivers them, so each would be its own mutation delivery
  return async (n: number) => {
    for (let i = 0; i < n; i += 1) {
      const delta = b.emit('assistant.block.delta', { apiMessageId: api('m1'), blockIndex: 0, blockType: 'text', textDelta: `word${i} `, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
      await act(async () => push([delta]));
    }
  };
}

const surfaceWatch = () => {
  const surface = screen.getByRole('region', { name: 'Chat' }).querySelector('[data-bar-surface]');
  return watches.find((watch) => watch.target === surface)!;
};

const message = () => screen.getByRole('textbox', { name: 'Message', hidden: true }) as HTMLElement & { editor: { commands: { insertContent(text: string): boolean } } };

it('the bar’s observer watches its surface, and an answer streaming above it runs it and redraws the bar no times', async () => {
  mount();
  await waitFor(() => expect(message()).toBeTruthy());
  const stream = await streamingTranscript();
  const watch = surfaceWatch();
  expect(watch.options).toEqual({ subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });
  const before = { runs: watch.runs, renders: marks.reads };
  await stream(N);
  expect(useTranscriptStore.getState().entries[A]?.rows.length ?? 0, 'the deltas reached the transcript').toBeGreaterThan(0);
  expect({ runs: watch.runs - before.runs, renders: marks.reads - before.renders }, `${N} streamed deltas`).toEqual({ runs: 0, renders: 0 });

  // the counts are live: a mark redraws the bar (its button, outside the surface), and typing in the box runs the observer
  act(() => useSessions.setState({ records: new Map([[A, { ...record(A), unread: true }]]) }));
  expect(marks.reads - before.renders, 'the mark redraws the bar').toBeGreaterThan(0);
  expect(watch.runs, 'the mark is outside the surface').toBe(before.runs);
  await act(async () => void message().editor.commands.insertContent('a'));
  expect(watch.runs - before.runs, 'a keystroke in the box runs the observer').toBeGreaterThan(0);
});

// The architect's ruling of 2026-11-15: typing in the box runs the observer, at most once per keystroke, and never
// redraws the bar.
it('typing in the bar’s box runs its observer at most once per keystroke and redraws the bar no times', async () => {
  mount();
  await waitFor(() => expect(message()).toBeTruthy());
  const watch = surfaceWatch();
  const before = { runs: watch.runs, renders: marks.reads };
  const type = () => act(async () => void message().editor.commands.insertContent('a')); // a keystroke per task
  await type();
  const first = watch.runs - before.runs;
  for (let i = 1; i < K; i += 1) await type();
  expect(message().textContent).toBe('a'.repeat(K));
  expect({ first, rest: watch.runs - before.runs - first }).toEqual({});
  expect(marks.reads - before.renders, `${K} keystrokes`).toBe(0);
});

it('the bar’s observer is disconnected when the bar goes', async () => {
  mount();
  await waitFor(() => expect(message()).toBeTruthy());
  const watch = surfaceWatch();
  expect(watch.disconnected).toBe(false);
  act(() => useFloatingCard.setState({ closed: false })); // the card takes the bar's place
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Chat' })).toBeNull());
  expect(watch.disconnected).toBe(true);
});
