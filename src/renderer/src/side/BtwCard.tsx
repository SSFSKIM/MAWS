// The `/btw` card (UX wave U4a, decision 26; the child's O-20): a small side chat over the bottom right corner of the
// session's pane, in place of the Side pane's question view. The header "Side chat" folds it to a chip in the same corner
// or closes it until the next `/btw`; the exchanges are drawn as the view draws them (`Exchange`), each pending one with
// the transcript's own live thinking words, counting ("Thinking · 8s", from ten seconds "Still thinking · 12s"); the
// field asks ("Ask a quick question…", then "Follow up…"; Enter asks, Shift+Enter breaks the line); Clear and "Continue as
// a side thread" are the view's. The chip shows the newest waiting line while an answer is awaited and a dot for one that
// settled unseen. The session's pane mounts it as a layer over the transcript's corner (`corner`: 56 px above the
// transcript's foot, which clears the jump-to-latest control, 12 px from the right, 320 px wide or the pane less 24 px,
// up to 360 px tall); the compact pill, which draws no transcript, in the flow above its composer (`flow`). It draws
// nothing while its session's card is closed. Its state is the window's (side/store.ts, `useBtwCards`), never stored.
// U4b registers it at the card column's foot.
import { useEffect } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import type { SideExchange } from '@shared/side/question';
import { Icon, IconButton } from '../app/IconButton';
import { FIELD } from '../sessions/ui';
import { liveThinkingLabel } from '../transcript/model/copy';
import { duration } from '../transcript/model/time';
import { useTicker } from '../transcript/view/rows/parts';
import { Exchange, SideActions, useSideAsk } from './BtwView';
import { SIDE_COPY } from './copy';
import { visibleSessions } from '../session/visibility';
import { useFloatingCard } from '../shell/floating';
import { useLayout } from '../stores/layout';
import { useSessions } from '../stores/sessions';
import { btwCardOf, btwUnseen, closeBtwCard, foldBtwCard, markBtwSeen, openBtwCard, refreshSide, setBtwQuestion, sideChildrenShown, sidePaneOf, useBtwCards, useSidePane, waitingSince } from './store';

const COPY = SIDE_COPY.btw;
export type BtwCardPlacement = 'corner' | 'flow';

// Above the transcript and its jump-to-latest control (z-index 1), below menus, dialogs and toasts (their own layers).
const CORNER = 'absolute right-3 bottom-[56px] z-10';
const SURFACE = 'border border-border-strong bg-bg-overlay text-fg shadow-float';

export function BtwCard({ appSessionId, placement = 'corner' }: { appSessionId: AppSessionId; placement?: BtwCardPlacement }) {
  const view = useBtwCards((s) => btwCardOf(s, appSessionId).view);
  if (view === 'closed') return null;
  return view === 'folded' ? <FoldedChip parent={appSessionId} placement={placement} /> : <OpenCard parent={appSessionId} placement={placement} />;
}

// The waiting line, in the transcript's words without the effort (`liveThinkingLabel`, which ends with the time), counting
// once a second on this window's clock. A polite status whose time is a `role="timer"` span, as the transcript's ticking
// lines are (`TickingStatus`), so the tier's change is announced and each second's tick is not; a span, since the chip
// is a button.
function WaitingLine({ parent, exchange, className }: { parent: AppSessionId; exchange: SideExchange; className: string }) {
  const now = useTicker(true);
  const elapsed = Math.max(0, now - waitingSince(parent, exchange));
  const label = liveThinkingLabel(elapsed, null);
  const time = duration(elapsed);
  return (
    <span role="status" data-btw-waiting="" className={className}>
      {label.slice(0, label.length - time.length)}
      <span role="timer">{time}</span>
    </span>
  );
}

// Whether the session is on screen by the rule the unread mark follows (`visibleSessions`, its layout part: a pane's active
// tab not floated or covered, the child a Side pane draws, the floating card's session), whether or not it has a record (a
// terminal session on another machine has none); the window's focus is not asked. A card in the flow is the compact pill's,
// which is drawn only where it is seen.
function useOnScreen(parent: AppSessionId, placement: BtwCardPlacement): boolean {
  const panes = useSidePane((s) => s.panes);
  useFloatingCard((s) => s.closed); // drawn again when the floating card opens or closes, which `visibleSessions` reads
  const onScreen = useLayout((layout) => visibleSessions(layout, new Map([[parent, null as never]]), true, sideChildrenShown({ panes })).has(parent));
  return placement === 'flow' || onScreen;
}

function OpenCard({ parent, placement }: { parent: AppSessionId; placement: BtwCardPlacement }) {
  const question = useBtwCards((s) => btwCardOf(s, parent).question);
  const side = useSideAsk(parent, { question, setQuestion: (next) => setBtwQuestion(parent, next) });
  const exchanges = useSidePane((s) => sidePaneOf(s, parent).exchanges);
  const onScreen = useOnScreen(parent, placement);
  useEffect(() => {
    if (onScreen) markBtwSeen(parent, exchanges ?? []); // open on screen: every settled one is seen
  }, [parent, exchanges, onScreen]);
  const { log, field, shown, setQuestion, canAsk, note, refusal } = side;
  const box = placement === 'corner' ? `${CORNER} w-[320px] max-w-[calc(100%-24px)] max-h-[min(360px,calc(100%-68px))]` : 'w-full max-h-[360px]';
  return (
    <section data-btw-card={placement} aria-label={COPY.card} className={`${box} flex min-h-0 flex-col overflow-hidden rounded-lg ${SURFACE} text-ui`}>
      <header className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border pr-1 pl-3">
        <h2 className="m-0 min-w-0 flex-1 truncate text-ui font-semibold">{COPY.card}</h2>
        <IconButton label={COPY.fold} onClick={() => foldBtwCard(parent)}>
          <Icon className="size-3.5">
            <path d="M4 8h8" />
          </Icon>
        </IconButton>
        <IconButton label={COPY.close} onClick={() => closeBtwCard(parent)}>
          <span aria-hidden className="text-ui leading-none">
            ×
          </span>
        </IconButton>
      </header>
      {shown.length > 0 && (
        <div ref={log} role="log" aria-label={COPY.log} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {shown.map((exchange) => (
              <Exchange
                key={exchange.id}
                exchange={exchange}
                canRetry={canAsk}
                onRetry={() => void side.retry(exchange)}
                waiting={<WaitingLine parent={parent} exchange={exchange} className="block text-ui-sm text-fg-muted" />}
              />
            ))}
          </ol>
        </div>
      )}
      <div className={`flex shrink-0 flex-col gap-2 px-3 py-2.5 ${shown.length > 0 ? 'border-t border-border' : ''}`}>
        {note !== null && <p className="m-0 text-ui-sm text-fg-muted">{note}</p>}
        {refusal !== null && (
          <p role="alert" className="m-0 text-ui-sm break-words text-danger">
            {refusal}
          </p>
        )}
        <textarea
          ref={field}
          aria-label={COPY.field}
          placeholder={shown.length === 0 ? COPY.askFirst : COPY.followUp}
          rows={1}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={side.onKeyDown}
          className={`${FIELD} max-h-24 min-h-[32px] resize-none leading-snug placeholder:text-fg-faint`}
        />
        <SideActions side={side} />
      </div>
    </section>
  );
}

// The folded card: its word, the newest waiting line while an answer is awaited, and a dot for one that settled unseen. It
// lists the log as the open card does, at its mount and when the session's process changes (the panel's finding 8): a
// remote session forgotten while no pane drew it opens again with no `remote.reopened`, and an answer that settled then
// would otherwise wait for the card's opening.
function FoldedChip({ parent, placement }: { parent: AppSessionId; placement: BtwCardPlacement }) {
  const process = useSessions((s) => s.engine.get(parent)?.process ?? null);
  useEffect(() => void refreshSide(parent), [parent, process]);
  const exchanges = useSidePane((s) => sidePaneOf(s, parent).exchanges) ?? [];
  const unseen = useBtwCards((s) => btwUnseen(btwCardOf(s, parent), exchanges));
  const awaited = exchanges.findLast((e) => e.state === 'pending');
  const place = placement === 'corner' ? CORNER : 'self-end';
  return (
    <button
      type="button"
      data-btw-chip={placement}
      aria-label={COPY.card}
      title={COPY.unfold}
      onClick={() => openBtwCard(parent)}
      className={`${place} inline-flex h-7 max-w-[calc(100%-24px)] items-center gap-2 rounded-full px-3 text-ui-sm outline-accent hover:bg-bg-hover focus-visible:outline-2 ${SURFACE}`}
    >
      <span className="shrink-0">{COPY.card}</span>
      {awaited !== undefined && <WaitingLine parent={parent} exchange={awaited} className="min-w-0 truncate text-fg-muted" />}
      {unseen && <span data-btw-unseen="" role="img" aria-label={COPY.unseen} className="block size-[5px] shrink-0 rounded-full bg-info" />}
    </button>
  );
}
