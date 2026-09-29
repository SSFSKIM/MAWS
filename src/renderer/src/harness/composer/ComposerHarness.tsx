// The composer and card harness page (`#composer`; C7 execution document, M2 and Acceptance item 2): two panes, each
// showing a session's waiting request in one X4 placement (docked in the frame, in a focusable article as C5's
// Overview card holds it, in a hover card, inline), over the app's real stores and C5's real key dispatcher, with the
// engine behind them (C3's replay under MAWS_ENGINE_REPLAY=1). Main blocks navigation, so an end-to-end test cannot
// change the query within a launch: it launches its replay through `window.maws` and tells the page what to show
// through `window.__maws_cards`. `?session=<appSessionId>&placement=<placement>` sets pane 0 on load for manual use,
// and `?theme=dark` the theme. M3 and M4 add the editor and the composer to this page.
import { useEffect, useRef, useState } from 'react';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { connectShell } from '../../ipc/events';
import { connectKeys } from '../../keymap/dispatcher';
import { useKeyChord } from '../../keymap/useKeyChord';
import { RequestCard } from '../../request-card';
import { selectPendingOf, useAttention } from '../../stores/attention';
import type { CardsHarnessApi, HarnessPane, HarnessPlacement } from './api';

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

export function ComposerHarness() {
  const [panes, setPanes] = useState(initialPanes);
  const counted = useRef(0);

  useEffect(() => {
    const theme = new URLSearchParams(location.search).get('theme');
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    const offs = [connectShell(), connectKeys()];
    window.__maws_cards = { show: (next) => setPanes(next), counted: () => counted.current };
    return () => {
      offs.forEach((off) => off());
      delete window.__maws_cards;
    };
  }, []);

  return (
    <main className="grid h-full grid-cols-2 gap-6 overflow-auto bg-bg p-6 text-ui text-fg">
      {panes.map((pane, i) => {
        const index = i as 0 | 1;
        return (
          <section key={i} data-pane={index} aria-label={`pane ${index}`} className="flex min-w-0 flex-col gap-3">
            <button type="button" className="self-start rounded-sm border border-border px-2 py-0.5 text-ui-sm text-fg-muted">
              pane {index}
            </button>
            {pane === null ? null : 'counter' in pane ? (
              <CounterPane onCount={() => void (counted.current += 1)} />
            ) : (
              <RequestPane appSessionId={pane.appSessionId as AppSessionId} placement={pane.placement} index={index} />
            )}
          </section>
        );
      })}
    </main>
  );
}
