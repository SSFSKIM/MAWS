// UX wave U1b, the branch review's fix wave (the architect's ruling of 2026-11-15 UTC): no painted frame shows a prompt's
// decision buttons without the pane's chords taken. A permission prompt at a transcript's end binds its three chords
// (`keys="pane"`, Interfaces §F) only for the keys its body says it has; a press its grace takes answers nothing, and
// does not fall through to the composer as a Stop. So the body says which keys it has in the commit that draws its
// buttons, before the window can paint that commit.
//
// The page here is the session's composer in its pane beside the end card. The card is drawn by a plain state update (no
// event and no store started it, as a list's own measuring draws a row), so React runs that commit in a task of its
// scheduler, asks the window for a paint, and runs the commit's passive effects in a later task. The decision row's menus
// are stubbed: Radix's popper and presence set state while they mount, which makes React flush the commit's passive
// effects at once, and that incidental flush is no contract of the card's. An Esc arrives in the first moment after the
// commit, while the buttons are on screen. Every command and id is invented.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { Profiler, useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { PreloadBridge } from '@shared/ipc/schema';
import { REGISTRY } from '@shared/ipc/registry';
import { addressingOf, bareOf } from '@shared/machine/address';
import { humanTurn, record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../test/support/machine';
import { Composer } from '../composer/Composer';
import { resetDictationStore } from '../composer/dictation/store';
import { resetTakeBack } from '../composer/queue/take-back';
import { connectKeys } from '../keymap/dispatcher';
import { useAttention } from '../stores/attention';
import { resetComposerStore } from '../stores/composer';
import { useHosts } from '../stores/hosts';
import { resetLaneAStore } from '../stores/lane-a';
import { useLayout } from '../stores/layout';
import { resetQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { hostStatus } from '../test-support/host-status';
import { preloadOf } from '../test-support/preload-of';
import { layOutPrompts } from '../test-support/prompt-layout';
import { resetShellStores } from '../test-support/shell-stores';
import { connectRequestCard } from './index';
import { RequestCard } from './RequestCard';
import { itemFor, permission } from './test-requests';

vi.mock('radix-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('radix-ui')>();
  const Drawn = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { ...actual, DropdownMenu: { ...actual.DropdownMenu, Root: Drawn, Trigger: Drawn, Portal: () => null } };
});

const APP = at('app-first-paint' as AppSessionId);
const addressing = addressingOf(REGISTRY);
const ESCAPE = { key: 'Escape', code: 'Escape' };
const event = permission({ requestId: 'req-first-paint' as never, toolUseId: 'toolu_first_paint' as never, input: { command: 'make check' } });
const prompt = itemFor(event, APP, { summary: 'Bash: make check' });

let fake: FakeClient;
let layout: ReturnType<typeof layOutPrompts>;
let offs: (() => void)[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance'] });
  vi.advanceTimersByTime(10_000);
  resetShellStores();
  resetComposerStore();
  resetQueueStore();
  resetLaneAStore();
  resetDictationStore();
  useHosts.setState({ supervisor: hostStatus() });
  fake = fakeClient({
    'session.answer': { outcome: 'delivered' },
    'session.queue.list': { entries: [], paused: false, pauseReason: null },
    'session.history.list': { entries: [] },
    'session.drafts.get': null,
    'session.drafts.set': undefined,
    'session.history.append': undefined,
    'session.send': { messageUuid: null, disposition: 'sent', queueId: 'q-1' },
    'session.interrupt': { stillQueued: [], cancelled: [] },
    'session.listModels': { models: [] },
    'session.listPermissionRules': { state: { rules: [], workspaceDirectories: [], originalCwd: '/work/app-first-paint', managedOnly: false } },
    'engine.models': { models: [], source: 'cached', at: '2026-09-29T09:00:00.000Z' },
  });
  window.maws = preloadOf(fake);
  layout = layOutPrompts();
  offs = [connectKeys(), connectRequestCard()];
  // the session runs a turn, in pane 0, which holds the keyboard
  const s = useSessions.getState();
  const page = addressing.output('session.get').lift(record(bareOf(APP)), TEST_MACHINE)! as SessionRecord;
  const engine = addressing.output('engine.sessions').lift([status(bareOf(APP), { engineState: 'running', turn: humanTurn })], TEST_MACHINE)[0]! as EngineSessionStatus;
  useSessions.setState({ records: new Map(s.records).set(APP, page), engine: new Map(s.engine).set(APP, engine), recordsVersion: s.recordsVersion + 1 });
  useLayout.setState((l) => ({ main: { ...l.main, panes: [{ tabs: [{ id: `session:${APP}`, kind: 'session', appSessionId: APP, pinned: false }], activeTabId: `session:${APP}` }], focusedPane: 0, splitRatio: 0.5 } }) as never);
  act(() => useAttention.getState().applySnapshot([prompt], TEST_MACHINE));
});
afterEach(() => {
  offs.forEach((off) => off());
  cleanup();
  resetTakeBack();
  delete (window as { maws?: PreloadBridge }).maws;
  layout.restore();
  vi.useRealTimers();
});

// Draws its children once the function handed to `onReady` is called: a plain state update, outside any event or store.
function Revealed({ onReady, children }: { onReady: (reveal: () => void) => void; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  useEffect(() => onReady(() => setShown(true)), [onReady]);
  return shown ? children : null;
}

const editor = () => within(screen.getByRole('region', { name: 'pane 0' })).queryByRole('textbox', { name: 'Message', hidden: true });

it('an Esc in the composer at the first paint of a prompt’s buttons is taken and answers nothing: no Stop', async () => {
  const seen: { reveal: (() => void) | null; pressed: KeyboardEvent | null; queued: boolean } = { reveal: null, pressed: null, queued: false };
  // at the commit that first draws the buttons, an Esc queued for the moment that commit's task is done
  const atFirstPaint = () => {
    if (seen.queued || document.querySelector('[data-decision-buttons]') === null) return;
    seen.queued = true;
    queueMicrotask(() => {
      const press = new KeyboardEvent('keydown', { ...ESCAPE, bubbles: true, cancelable: true });
      seen.pressed = press;
      editor()!.dispatchEvent(press);
    });
  };
  render(
    <Profiler id="pane" onRender={atFirstPaint}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <section data-pane={0} aria-label="pane 0">
          <Revealed onReady={(reveal) => (seen.reveal = reveal)}>
            <div className="transcript-row" tabIndex={-1}>
              <RequestCard item={prompt} request={event} placement="inline" region="end" keys="pane" paneIndex={null} />
            </div>
          </Revealed>
          <Composer appSessionId={APP} paneIndex={0} />
        </section>
      </QueryClientProvider>
    </Profiler>,
  );
  await waitFor(() => expect(editor()).toBeTruthy());
  await waitFor(() => expect(seen.reveal).not.toBeNull());
  act(() => editor()!.focus());
  // outside act, as the window runs: React schedules the render, the paint and the passive effects as it does there
  const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const before = environment.IS_REACT_ACT_ENVIRONMENT;
  environment.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    seen.reveal!();
    for (let i = 0; i < 20 && seen.pressed === null; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  } finally {
    environment.IS_REACT_ACT_ENVIRONMENT = before;
  }
  expect(seen.pressed, 'the Esc arrived at the first paint of the buttons').not.toBeNull();
  await act(async () => {});
  expect(fake.invoked('session.interrupt'), 'no Stop').toEqual([]);
  expect(fake.invoked('session.answer'), 'no answer').toEqual([]);
  expect(seen.pressed!.defaultPrevented, 'the prompt took it').toBe(true);
});
