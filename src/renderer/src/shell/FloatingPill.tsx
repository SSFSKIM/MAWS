// What the float is when it is not the card. UX wave U10b (O-43; its execution document §F.3, M7): the bar, the
// composer's box alone at the bottom right of the float's layer, with two raised buttons to its right, Open conversation
// and, where a header holds Show chat (`useShowChatHeader`), Hide chat. It mounts the session's pane in its compact form,
// as the pill it replaces did (P3-G §D1.4; P4-B3, its Decision Log 9), inside `ComposerBarContext`: the composer draws its
// box alone, and whatever the pane draws above it or in its place (the queue, attached files, the `/btw` card, the tab
// notes, a setup card, a holder's notice) stands on one raised surface while something is there (the owner's answer of
// 2026-11-15 to the card "Above the bar"). Over a Browser tab the page is a native view drawn over the DOM, so the
// browser's chrome draws the inline chip at the right end of its tab row instead (`ChromePill`, the coordinator's
// ruling on P3-G M2), and the layer draws no bar while a chrome hosts it.
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { AppSessionId } from '@shared/graph/ids';
import { MaximizeIcon } from '../app/IconButton';
import { phaseWords, useMachineMark } from '../app/machine-mark';
import { ComposerBarContext } from '../composer/frame/bar';
import { LinkStatusLine } from '../lane-b/link-status';
import { displayTitle } from '../sessions/title';
import { useLayout } from '../stores/layout';
import { currentSet } from '../stores/layout-model';
import { useSessions } from '../stores/sessions';
import { SessionPane } from '../session/SessionPane';
import { CARD_MARGIN, cardOver, cardSession, focusCompactCard, hideChat, openCard, splitFloat, useFloatingCard, usePublishedPlace, useShowChatHeader, type CardHost } from './floating';
import { SESSION_MARK_WORDS, SessionMark, useSessionMark } from './SessionMark';

export const useSessionTitle = (appSessionId: AppSessionId) => useSessions((s) => displayTitle(s.records.get(appSessionId)));

// The bar's measures (B1): the box 420 px; each button 28 px, 4 px from the box and from each other, bottom-aligned with
// the box. So the bar is 484 px with both buttons and 452 px with Open conversation alone.
export const BAR = { box: 420, gap: 4, button: 28 } as const;
export const barWidth = (buttons: 1 | 2): number => BAR.box + buttons * (BAR.gap + BAR.button);

// The first control to mount after the card's Close takes the keyboard (P3-F): in one commit the chrome's chip comes
// before the layer's bar, which goes once the chrome hosts it.
function useTakesKeyboardAfterClose(self: RefObject<HTMLButtonElement | null>): void {
  useLayoutEffect(() => {
    if (!useFloatingCard.getState().pillTakesFocus) return;
    useFloatingCard.setState({ pillTakesFocus: false });
    self.current?.focus();
  }, [self]);
}

// Whether anything is drawn in the bar beside the composer's box: words or a control outside the box and outside what is
// hidden. The raised surface is drawn only then.
const HIDDEN = '[hidden], .hidden, .sr-only, [data-composer-box]';
const CONTROL = 'button, input, textarea, select, img, svg, [role="img"]';
export function drawsBesideTheBox(root: HTMLElement): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node instanceof Element && node.matches(HIDDEN) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Element ? node.matches(CONTROL) : (node.textContent ?? '').trim() !== '') return true;
  }
  return false;
}
function useDrawsBesideTheBox(surface: RefObject<HTMLElement | null>): boolean {
  const [draws, setDraws] = useState(false);
  useLayoutEffect(() => {
    const root = surface.current;
    if (!root) return;
    const read = () => setDraws(drawsBesideTheBox(root));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    return () => observer.disconnect();
  }, [surface]);
  return draws;
}

// The raised surface (B8; the owner's "A surface only while needed"): from 8 px above the topmost thing down to the box,
// which it includes, with the box's radius and the float's edge; what it holds is inset 8 px, and the box lies on its
// edge. The compact pane's own padding is taken out, and so is the composer column's side padding (`--measure-pad`,
// which `.thread-column` reads), so SessionPane.tsx is not edited (B1).
const SURFACE = 'pointer-events-auto min-w-0 flex-1 [&_:has(>.thread-column)]:py-0';
const RAISED = [
  'overflow-y-auto rounded-2xl border border-border-strong bg-bg p-2 shadow-float',
  '[&_[data-composer-box]]:-mx-2 [&_[data-composer-box]]:-mb-2 [&_[data-composer-box]]:border-x-transparent [&_[data-composer-box]]:border-b-transparent [&_[data-composer-box]]:shadow-none',
].join(' ');
// B2: each button is raised, with the box's ground, border and shadow, so its glyph reads over any page.
const RAISED_BUTTON =
  'pointer-events-auto relative inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-bg-raised text-fg-muted shadow-float outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2';

// The bar of the `host` region's float (§F.3, §F.4). The glyphs are the owner's answer of 2026-11-15 to the card "Bar
// glyphs": the pane header's expand glyph for Open conversation, a plain × for Hide chat, as the card's own Close. The
// session's mark stands at Open conversation's upper right, outside the glyph (B5). Its height is published as the open
// card's place is (B6), so a scrolling artifact under it keeps that room at its end.
export function Bar({ host, appSessionId, area, bounds }: { host: CardHost; appSessionId: AppSessionId; area: RefObject<HTMLElement | null>; bounds: { height: number } }) {
  const title = useSessionTitle(appSessionId);
  const mark = useSessionMark(appSessionId);
  const hides = useShowChatHeader();
  const machine = useMachineMark(appSessionId);
  const words = phaseWords(machine.phase, machine.name); // B4: the link's phase words above the box, as the tab says them
  const paneIndex = useLayout((s) => splitFloat(s.main)?.pane ?? currentSet(s.main).focusedPane);
  const self = useRef<HTMLElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const open = useRef<HTMLButtonElement>(null);
  useTakesKeyboardAfterClose(open);
  usePublishedPlace(self, area, host);
  const raised = useDrawsBesideTheBox(surface);
  const style = { right: CARD_MARGIN, bottom: CARD_MARGIN, width: barWidth(hides ? 2 : 1), maxWidth: `calc(100% - ${2 * CARD_MARGIN}px)`, '--measure-pad': '0px' } as CSSProperties;
  return (
    <section ref={self} role="region" aria-label="Chat" data-pane="card" data-compact-session={appSessionId} data-chat-presentation="bar" className="pointer-events-none absolute flex items-end gap-1" style={style}>
      <div
        ref={surface}
        data-bar-surface=""
        data-raised={raised || undefined}
        className={raised ? `${SURFACE} ${RAISED}` : SURFACE}
        style={raised ? { maxHeight: Math.max(0, bounds.height - 2 * CARD_MARGIN) } : undefined}
        onPointerDownCapture={focusCompactCard}
        onFocusCapture={focusCompactCard}
      >
        {words !== null && <LinkStatusLine phase={machine.phase} words={words} />}
        <ComposerBarContext.Provider value>
          <SessionPane key={appSessionId} appSessionId={appSessionId} paneIndex={paneIndex} compact />
        </ComposerBarContext.Provider>
      </div>
      <button ref={open} type="button" aria-label="Open conversation" title={title} onClick={() => openCard()} className={RAISED_BUTTON}>
        <MaximizeIcon />
        {mark && <SessionMark mark={mark} className="absolute -top-1 -right-1" />}
      </button>
      {hides && (
        <button type="button" aria-label="Hide chat" title="Hide chat" onClick={hideChat} className={RAISED_BUTTON}>
          <span aria-hidden className="text-ui leading-none">
            ×
          </span>
        </button>
      )}
    </section>
  );
}

// The chip in a browser chrome's row (`inline`), at the row's chip height, while the float over its surface is closed:
// the session's title, its unread dot, and a click that brings the card back. Its name is kept: the Browser's scenes
// read it (M7 decision 9, 10).
export function Pill({ appSessionId }: { appSessionId: AppSessionId }) {
  const title = useSessionTitle(appSessionId);
  const unread = useSessions((s) => s.records.get(appSessionId)?.unread === true);
  const self = useRef<HTMLButtonElement>(null);
  useTakesKeyboardAfterClose(self);
  return (
    <button
      ref={self}
      type="button"
      aria-label="Show session card"
      title={unread ? `${title} · Unread` : title}
      data-floating-pill="inline"
      onClick={() => openCard()}
      className="inline-flex h-6 shrink-0 items-center gap-2 rounded-full border border-border-strong bg-bg-raised px-3 text-ui-sm text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2"
    >
      <span className="max-w-[220px] truncate">{title}</span>
      {unread && <span aria-label={SESSION_MARK_WORDS.unread} role="img" className="block size-[5px] shrink-0 rounded-full bg-info" />}
    </button>
  );
}

// The chip in a browser chrome's row, while the float over its surface is closed: the chrome renders it only where its
// pane holds the page. Hosting it tells the layer to draw no bar (before paint, so no frame shows two).
export function ChromePill({ surface }: { surface: 'panel' | 'main' }) {
  const session = useLayout((s) => (cardOver(s, surface) ? cardSession(s) : null));
  const closed = useFloatingCard((s) => s.closed);
  const shown = session !== null && closed;
  useLayoutEffect(() => (shown ? useFloatingCard.getState().hostPill() : undefined), [shown]);
  return shown ? <Pill appSessionId={session} /> : null;
}
