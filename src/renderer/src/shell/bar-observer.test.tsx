// UX wave U10b (O-43): the observer behind the bar's raised surface (`drawsBesideTheBox` in FloatingPill.tsx), measured.
// It watches the bar's surface; a session streaming its answer redraws nothing there, so its callback and the bar's
// renders stay bounded however many deltas arrive. Counts, not times.
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
  return (n: number) => {
    for (let i = 0; i < n; i += 1) {
      const delta = b.emit('assistant.block.delta', { apiMessageId: api('m1'), blockIndex: 0, blockType: 'text', textDelta: `word${i} `, thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
      act(() => push([delta]));
    }
  };
}

const surfaceWatch = () => {
  const surface = screen.getByRole('region', { name: 'Chat' }).querySelector('[data-bar-surface]');
  return watches.find((watch) => watch.target === surface)!;
};

it('the bar’s observer watches its surface, and a streamed answer runs it and redraws the bar a bounded number of times', async () => {
  const view = mount();
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message', hidden: true })).toBeTruthy());
  const stream = await streamingTranscript();
  const watch = surfaceWatch();
  const before = { runs: watch.runs, renders: marks.reads };
  stream(N);
  await act(async () => {});
  expect(useTranscriptStore.getState().entries[A]?.rows.length ?? 0, 'the deltas reached the transcript').toBeGreaterThan(0);
  expect({ options: watch.options, runs: watch.runs - before.runs, renders: marks.reads - before.renders }).toEqual({});
  view.unmount();
});
