// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the P4 spec's §4.3, binding on the shared card
// and on "only the human activates a thread"; the prior art's V2, V5, V7): one pin's open threads on a deck's slide or a
// design's board, each drawn by X36's `ThreadCard` as the document's margin draws it: compacted while inactive, oldest
// first, with its place among them, no quote (the pin sits on the element). Placed by the card's own placement
// (`cardPosition`), hidden until placed and while the pin is off the stage. One thread is active: the asked one, else the
// newest; the human moves it (a click on a card, R on a compacted one, J and K), and nothing else does: an agent's reply
// or new thread leaves it where it is, and only a resolve that takes it out of the list gives way to the newest. When the
// popover first shows, the active card's reply field takes the keyboard (ThreadCard focuses only after its own click),
// scrolled into view in the popover's own capped box and nowhere else, as is a card J or K moves to. Escape, U and Escape in the reply field exit; the drafts are the host's (`drafts`, `onDraftChange`), so closing keeps
// them. Portable: the binding (slides/editor/comments/PinPopover.tsx) places it and closes it.
import { useEffect, useRef, useState } from 'react';
import { cardPosition, type CardStyle } from './placement';
import { ThreadCard, type ThreadCardThread } from './ThreadCard';
import './comments.css';

export interface ThreadPopoverProps {
  /** The pin's open threads, oldest first. */
  threads: readonly ThreadCardThread[];
  /** The thread to activate on opening, when it is one of `threads`; else the newest. */
  initial?: string | null;
  /** Where it stands in its host (the card's placement); null until placed, drawn hidden. */
  placement: CardStyle | null;
  /** Its pin is off the stage: drawn hidden, kept mounted. */
  hidden?: boolean;
  /** The dialog's accessible name. */
  label: string;
  /** Each thread's reply draft, the host's. */
  drafts: ReadonlyMap<string, string>;
  onDraftChange(threadId: string, text: string): void;
  onReply(threadId: string, body: string): void;
  onResolve(threadId: string): void;
  onReopen(threadId: string): void;
  /** Escape, U, or Escape in a reply field: the host closes it (the drafts stay the host's). */
  onExit(): void;
  /** The thread the human made active (on opening, a click, R, J or K). */
  onActiveChange?(threadId: string): void;
  readOnly?: boolean;
}

export function ThreadPopover({ threads, initial = null, placement, hidden = false, label, drafts, onDraftChange, onReply, onResolve, onReopen, onExit, onActiveChange, readOnly = false }: ThreadPopoverProps) {
  const root = useRef<HTMLDivElement | null>(null);
  const newest = threads.at(-1)?.id ?? null;
  const [chosen, setChosen] = useState<string | null>(() => (initial !== null && threads.some((t) => t.id === initial) ? initial : newest));
  // the human's choice while it is listed; a thread resolved away gives way to the newest, which becomes the choice, so
  // a thread an agent adds next leaves it active
  const active = chosen !== null && threads.some((t) => t.id === chosen) ? chosen : newest;
  if (active !== chosen) setChosen(active);
  const shown = placement !== null && !hidden;

  // the keyboard: to the active card's reply field the first time the popover shows (else to the card); to a card J or K
  // made active; and to the active card when the card holding it was resolved away (`AFTER_RESOLVE`)
  const focused = useRef(false);
  const focusCard = useRef<string | null>(null);
  useEffect(() => {
    const node = root.current;
    if (!node || !shown || active === null) return;
    const card = cardOf(node, active);
    let to: HTMLElement | null = null;
    if (!focused.current) {
      focused.current = true;
      to = card?.querySelector<HTMLElement>('textarea') ?? card;
    } else if (focusCard.current === active || focusCard.current === AFTER_RESOLVE) {
      to = card;
    }
    focusCard.current = null;
    if (!to) return;
    // never scrolling anything around it (the stage's scroll is its own), but in view in its own scroll box
    to.focus({ preventScroll: true });
    scrollIntoBox(node, to);
  }, [shown, active]);

  // the host hears every change of the active thread, the first one included
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (active === null || told.current === active) return;
    told.current = active;
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  const step = (from: string, by: 1 | -1) => {
    const at = threads.findIndex((t) => t.id === from);
    const next = threads[at + by];
    if (!next) return;
    focusCard.current = next.id;
    setChosen(next.id);
  };
  const resolve = (threadId: string) => {
    const node = root.current;
    if (node && cardOf(node, threadId)?.contains(node.ownerDocument.activeElement)) focusCard.current = AFTER_RESOLVE;
    onResolve(threadId);
  };
  const style = placement === null ? null : cardPosition(placement);
  return (
    <div
      ref={root}
      role="dialog"
      aria-label={label}
      className="thread-popover"
      data-pin-popover=""
      data-placement={placement?.mode}
      style={{ ...style, visibility: shown ? undefined : 'hidden' }}
    >
      {threads.map((thread, i) => (
        <ThreadCard
          key={thread.id}
          thread={thread}
          active={thread.id === active}
          compact
          onActivate={() => setChosen(thread.id)}
          onReply={(body) => onReply(thread.id, body)}
          onResolve={() => resolve(thread.id)}
          onReopen={() => onReopen(thread.id)}
          draft={drafts.get(thread.id) ?? ''}
          onDraftChange={(text) => onDraftChange(thread.id, text)}
          onNext={() => step(thread.id, 1)}
          onPrevious={() => step(thread.id, -1)}
          onExit={onExit}
          position={{ index: i + 1, count: threads.length }}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

const AFTER_RESOLVE = '\0resolved'; // no thread's id

/** Scrolls `box` (and nothing else) the least that shows `node`, its top first when it is taller than the box. */
function scrollIntoBox(box: HTMLElement, node: HTMLElement): void {
  const b = box.getBoundingClientRect();
  const n = node.getBoundingClientRect();
  if (n.top < b.top || n.height > b.height) box.scrollTop -= b.top - n.top;
  else if (n.bottom > b.bottom) box.scrollTop += n.bottom - b.bottom;
}

/** A thread's card in the popover. */
function cardOf(root: HTMLElement, threadId: string): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('[data-thread]')].find((node) => node.dataset.thread === threadId) ?? null;
}
