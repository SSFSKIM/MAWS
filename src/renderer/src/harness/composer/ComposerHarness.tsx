// The composer and card harness page (`#composer`; C7 execution document, M2 and Acceptance item 2): two panes, each
// showing a session's waiting request in one X4 placement (docked in the frame, in a focusable article as C5's
// Overview card holds it, in a hover card, inline), over the app's real stores and C5's real key dispatcher, with the
// engine behind them (C3's replay under MAWS_ENGINE_REPLAY=1). Main blocks navigation, so an end-to-end test cannot
// change the query within a launch: it launches its replay through `window.maws` and tells the page what to show
// through `window.__maws_cards`. `?session=<appSessionId>&placement=<placement>` sets pane 0 on load for manual use,
// and `?theme=dark` the theme. M3's editor has its own page (`#editor`). M4 adds the composer as a pane kind, over the
// layout store's panes (so the one app-level ⌘. and ⌘L resolve the focused pane as they do in the shell), with C10's
// setup intent stubbed (`intent-stub.ts`) and a stub card docked through `dockCard`. M4b shows a composer pane's
// transcript above it on request (C6's slot, with the composer's edit-and-resubmit registered as the app registers it),
// and can fail a composer's next `session.send` before it reaches main. W2: that composer sits in C5's own composer
// column, as a started session pane holds it, and `wide` spans the page so the column reaches its cap.
import { QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import { Composer, ComposerAppKeys, connectComposer, connectInlineEdit, DockedCardFrame, dockCard, WidgetDialogHost } from '../../composer';
import { setRewindWindow } from '../../composer/resubmit-seam';
import { ipc } from '../../ipc/client';
import { connectShell } from '../../ipc/events';
import { queryClient } from '../../ipc/query';
import { connectKeys } from '../../keymap/dispatcher';
import { useKeyChord } from '../../keymap/useKeyChord';
import { RequestCard } from '../../request-card';
import { ComposerColumn, SessionPane } from '../../session/SessionPane';
import { selectPendingOf, useAttention } from '../../stores/attention';
import { useLayout } from '../../stores/layout';
import { TranscriptSlot } from '../../transcript';
import type { CardsHarnessApi, HarnessPane, HarnessPlacement } from './api';
import { setStubIntent, stubLog } from './intent-stub';

declare global {
  interface Window {
    __maws_cards?: CardsHarnessApi;
  }
}

const PLACEMENTS: HarnessPlacement[] = ['docked', 'card', 'hover', 'inline'];
const at = (item: AttentionItem) => Date.parse(item.createdAt);
const oldest = (items: AttentionItem[]) => items.reduce<AttentionItem | null>((a, b) => (a === null || at(b) < at(a) ? b : a), null);

// The request a pane shows: the session's oldest pending item, else its oldest open one (an answered item stays,
// collapsed, until C3 retires it).
function useShown(appSessionId: AppSessionId): AttentionItem | null {
  const open = useAttention((s) => selectPendingOf(s, appSessionId));
  return oldest(open.filter((item) => item.state === 'pending')) ?? oldest(open);
}

function RequestPane({ appSessionId, placement, index }: { appSessionId: AppSessionId; placement: HarnessPlacement; index: 0 | 1 }) {
  const item = useShown(appSessionId);
  if (!item) return <p className="m-0 text-fg-faint">No request for {appSessionId}</p>;
  const card = <RequestCard key={item.id} item={item} request={null} placement={placement} paneIndex={index} />;
  switch (placement) {
    case 'card':
      return (
        <article tabIndex={0} aria-label={`card ${appSessionId}`} className="rounded-md border border-border bg-bg-raised p-3 outline-accent focus-visible:outline-2">
          {card}
        </article>
      );
    case 'hover':
      return (
        <div role="dialog" aria-label={`hover ${appSessionId}`} className="w-[342px] rounded-md border border-border-strong bg-bg-overlay p-4">
          {card}
        </div>
      );
    default:
      return card;
  }
}

// A region whose Enter binding only counts: it must never fire for a key pressed in the other pane.
function CounterPane({ onCount }: { onCount(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useKeyChord('request.accept', onCount, { within: ref });
  return (
    <div ref={ref} tabIndex={0} aria-label="counter" className="rounded-md border border-border p-3 text-fg-muted outline-accent focus-visible:outline-2">
      Another session · Enter counts here
    </div>
  );
}

function initialPanes(): [HarnessPane, HarnessPane] {
  const params = new URLSearchParams(location.search);
  const session = params.get('session');
  const placement = params.get('placement') as HarnessPlacement | null;
  return [session ? { appSessionId: session, placement: placement && PLACEMENTS.includes(placement) ? placement : 'docked' } : null, null];
}

// A stub card another child would dock (C10's trust card): the docked frame's chrome, focus and keys around it.
function StubCard({ appSessionId, onAccept }: { appSessionId: AppSessionId; onAccept(): void }) {
  return (
    <DockedCardFrame appSessionId={appSessionId} title="Trust this folder?" onAccept={onAccept} onDecline={null}>
      <p className="m-0">A stub card docked through dockCard.</p>
    </DockedCardFrame>
  );
}

// M4b: the composers' client, which fails a session's next `session.send` when the test asked for it.
const failSend = new Set<string>();
const composerClient: MawsBridge = {
  ...ipc,
  invoke: ((name, input) => {
    const appSessionId = (input as { appSessionId?: string } | undefined)?.appSessionId;
    if (name === 'session.send' && appSessionId !== undefined && failSend.delete(appSessionId)) return Promise.resolve({ ok: false, error: { code: 'internal', message: 'write_failed: injected by the harness' } });
    return ipc.invoke(name, input);
  }) as MawsBridge['invoke'],
};

// M4: the layout store's panes mirror the page's composer panes, so ComposerAppKeys resolves the focused pane's session.
function mirrorLayout(panes: [HarnessPane, HarnessPane]) {
  const tabsOf = (pane: HarnessPane) =>
    pane !== null && 'composer' in pane
      ? { tabs: [{ id: `session:${pane.composer}`, kind: 'session' as const, appSessionId: pane.composer as AppSessionId, pinned: false }], activeTabId: `session:${pane.composer}` }
      : { tabs: [{ id: 'overview' as const, kind: 'overview' as const, pinned: true as const }], activeTabId: 'overview' };
  useLayout.setState((s) => ({ main: { ...s.main, panes: [tabsOf(panes[0]), tabsOf(panes[1])], focusedPane: s.main.focusedPane } }));
}

export function ComposerHarness() {
  const [panes, setPanes] = useState(initialPanes);
  const counted = useRef(0);
  const stub = useRef<{ accepts: number; undock: (() => void) | null }>({ accepts: 0, undock: null });

  useEffect(() => {
    const theme = new URLSearchParams(location.search).get('theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    connectComposer(); // C5's session pane (a `shell` pane) finds the composer in its slot, as in the app
    const offs = [connectShell(), connectKeys(), connectInlineEdit(composerClient)];
    window.__maws_cards = {
      show: (next) => {
        mirrorLayout(next);
        setPanes(next);
      },
      counted: () => counted.current,
      intent: (appSessionId, intent) => setStubIntent(appSessionId, intent as Parameters<typeof setStubIntent>[1]),
      starts: () => [...stubLog.starts],
      answerStart: (result) => stubLog.pending.shift()?.(result),
      patches: () => [...stubLog.patches],
      dockStub: (appSessionId) => {
        stub.current.undock?.();
        stub.current.undock = dockCard(appSessionId as AppSessionId, { id: 'harness:stub', render: () => <StubCard appSessionId={appSessionId as AppSessionId} onAccept={() => void (stub.current.accepts += 1)} /> });
      },
      undockStub: () => {
        stub.current.undock?.();
        stub.current.undock = null;
      },
      stubAccepts: () => stub.current.accepts,
      failNextSend: (appSessionId) => void failSend.add(appSessionId),
      rewindWindow: (ms) => setRewindWindow(ms),
    };
    return () => {
      offs.forEach((off) => off());
      delete window.__maws_cards;
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <main className="grid h-full grid-cols-2 gap-6 overflow-auto bg-bg p-6 text-ui text-fg">
        {panes.map((pane, i) => {
          const index = i as 0 | 1;
          return (
            <section
              key={i}
              data-pane={index}
              aria-label={`pane ${index}`}
              onFocusCapture={() => useLayout.getState().focusPane(index)}
              className={`flex min-w-0 flex-col gap-3 ${pane !== null && (('shell' in pane && pane.shell) || ('wide' in pane && pane.wide)) ? 'col-span-2' : ''}`}
            >
              <button type="button" className="self-start rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted">
                pane {index}
              </button>
              {pane === null ? null : 'counter' in pane ? (
                <CounterPane onCount={() => void (counted.current += 1)} />
              ) : 'composer' in pane && pane.shell ? (
                <div className="h-[36rem] overflow-hidden rounded-md border border-border">
                  <SessionPane appSessionId={pane.composer as AppSessionId} paneIndex={index} />
                </div>
              ) : 'composer' in pane ? (
                <div className="mt-auto flex min-w-0 flex-col gap-3">
                  {pane.transcript && <TranscriptSlot key={`transcript:${pane.composer}`} appSessionId={pane.composer as AppSessionId} className="h-72" />}
                  {pane.transcript ? (
                    <ComposerColumn>
                      <Composer key={pane.composer} appSessionId={pane.composer as AppSessionId} paneIndex={index} client={composerClient} />
                    </ComposerColumn>
                  ) : (
                    <Composer key={pane.composer} appSessionId={pane.composer as AppSessionId} paneIndex={index} client={composerClient} />
                  )}
                </div>
              ) : (
                <RequestPane appSessionId={pane.appSessionId as AppSessionId} placement={pane.placement} index={index} />
              )}
            </section>
          );
        })}
      </main>
      <ComposerAppKeys />
      <WidgetDialogHost />
    </QueryClientProvider>
  );
}
