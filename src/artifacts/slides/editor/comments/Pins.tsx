// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Stage and overlay", D9; M7): the comment pins on
// the stage's overlay: one per element of the shown slide that carries an open thread, at the element's top-right as it
// is drawn (its measured bounds, in screen px at the zoom), so a pin follows its element through a move, a resize, a
// restyle, a re-order of slides and a republish, all of which keep the id it is anchored by. Orphans have no element to
// pin to; the rail lists them.
//
// P4-B2 (D16 of docs/doperpowers/plans/2026-10-21-p4-b2-slides-boards.md; the prior art's V1, V2, V12, V13): a pin opens
// its popover (the controller's `pressPin`), not the rail. The threads are read at once from the threads map
// (`useOpenDeckThreads`), whether an element is drawn from the canvas (`canvas.node`); the pins stand in slide order, so
// Tab walks them as the slide reads, each saying whether its popover is open; none is drawn while ⌥⌘⇧J hides them.
// After each placement that moved a pin, the pins tell the controller (`pinMoves`), so the popover re-places in that pass.
import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react';
import type { SlideCanvas } from '../../canvas';
import type { Box } from '../../geometry';
import type { DeckThread } from '../../threads';
import { measure } from '../transform/measure';
import { samePin, useDeckCommentsApi, type DeckCommentsApi } from './controller';
import { COMMENTS_COPY as C } from './copy';
import { useOpenDeckThreads } from './use-threads';
import { separatePins, targetNumber } from './targets';
import './comments.css';

interface Props {
  canvas: SlideCanvas;
  slideId: string;
  scale: number;
  /** Changes with every update the replica takes: the pins are measured again. */
  version: number;
}

export function CommentPins(props: Props) {
  const api = useDeckCommentsApi();
  return api && !api.pinsHidden ? <Pins api={api} {...props} /> : null;
}

/** The open threads of `slideId`, by element, oldest first. */
export function threadsByElement(threads: readonly DeckThread[], slideId: string): Map<string, DeckThread[]> {
  const out = new Map<string, DeckThread[]>();
  for (const t of threads) if (t.slideId === slideId) out.set(t.elementId, [...(out.get(t.elementId) ?? []), t]);
  return out;
}

/** `ids` in the order their nodes are drawn on the canvas (the slide's reading order); ids not drawn are dropped. */
export function inSlideOrder(canvas: SlideCanvas, ids: Iterable<string>): string[] {
  const drawn = [...ids].flatMap((id) => {
    const node = canvas.node(id);
    return node ? [{ id, node }] : [];
  });
  // a node before another in the tree reads first (DOCUMENT_POSITION_FOLLOWING: the other follows it)
  return drawn.sort((a, b) => (a.node === b.node ? 0 : a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map((d) => d.id);
}

function Pins({ api, canvas, slideId, scale, version }: Props & { api: DeckCommentsApi }) {
  const open = useOpenDeckThreads(api.session.doc);
  const byElement = useMemo(() => threadsByElement(open, slideId), [open, slideId]);
  const [boxes, setBoxes] = useState<readonly [string, Box][]>([]);
  // fix wave 1: measured again after every layout pass too, so a token or a face that moves an element moves its pin
  const [laidOut, setLaidOut] = useState(0);
  useEffect(() => canvas.onLayout(() => setLaidOut((n) => n + 1)), [canvas]);
  useLayoutEffect(() => {
    const next = inSlideOrder(canvas, byElement.keys()).flatMap((id): [string, Box][] => {
      const m = measure(canvas, id, scale);
      return m ? [[id, m.bounds]] : [];
    });
    setBoxes((was) => (samePinBoxes(was, next) ? was : next)); // unchanged geometry renders nothing and tells nobody
  }, [canvas, byElement, scale, version, laidOut]);
  const { pinMoves } = api;
  useLayoutEffect(() => pinMoves.placed(), [boxes, pinMoves]);
  const positions = separatePins(boxes.map(([, box]) => ({ x: (box.x + box.w) * scale, y: box.y * scale })), canvas.size.h * scale);
  return (
    <>
      {boxes.map(([elementId], index) => {
        const threads = byElement.get(elementId);
        if (!threads) return null;
        return <PinButton key={elementId} api={api} slideId={slideId} elementId={elementId} threads={threads} number={targetNumber(api.session.doc, open, threads[0]!)} style={{ left: positions[index]!.x, top: positions[index]!.y }} data={{ 'data-comment-pin': elementId }} />;
      })}
    </>
  );
}

/**
 * One pin (P4-B2): its element's open threads (a count past one), the key the popover finds it by (`data-pin-key`),
 * whether its popover is open, and a press that opens or closes it. The deck's and the design's.
 */
export function PinButton({ api, slideId, elementId, threads, style, data, number }: { number?: number; api: DeckCommentsApi; slideId: string; elementId: string; threads: readonly DeckThread[]; style: CSSProperties; data: Record<`data-${string}`, string> }) {
  const latest = threads[threads.length - 1]!;
  const label = `${C.pin(latest.quote, threads.length)}${number === undefined ? '' : ` · Element ${number}`}`;
  const target = { slideId, elementId };
  return (
    <button
      type="button"
      className="deck-comment-pin"
      {...data}
      data-pin-key={pinKey(target)}
      data-threads={threads.map((t) => t.id).join(' ')}
      data-active={threads.some((t) => t.id === api.active) || undefined}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={samePin(api.popover, target)}
      title={label}
      style={style}
      // a pointer's press moves no focus by itself (an empty compose card blurred would be discarded before its own pin
      // could reveal it); the press's outcome decides where the keyboard goes: the card's field, the popover's, or here
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => {
        const pin = event.currentTarget;
        const did = api.pressPin(
          target,
          threads.map((t) => t.id),
        );
        if (did !== 'card') pin.focus({ preventScroll: true });
      }}
    >
      {number === undefined ? (threads.length > 1 ? threads.length : '') : number}
    </button>
  );
}

/** The key a pin carries (`data-pin-key`) and the popover finds it by. */
export const pinKey = ({ slideId, elementId }: { slideId: string; elementId: string }): string => `${slideId}/${elementId}`;

/** The pin drawn for `target` in `root`, if any. */
export function pinNode(root: ParentNode, target: { slideId: string; elementId: string }): HTMLElement | null {
  const key = pinKey(target);
  return [...root.querySelectorAll<HTMLElement>('[data-pin-key]')].find((node) => node.dataset.pinKey === key) ?? null;
}

/** Two placements of a slide's pins are the same: the same elements in the same order at the same boxes. */
export function samePinBoxes(a: readonly (readonly [string, Box])[], b: readonly (readonly [string, Box])[]): boolean {
  return a.length === b.length && a.every(([id, box], i) => {
    const [other, at] = b[i]!;
    return id === other && box.x === at.x && box.y === at.y && box.w === at.w && box.h === at.h;
  });
}
