// P3-C (docs/doperpowers/plans/2026-10-12-p3-c-presentations.md, D8 "Stage and overlay", D9; M7): the comment pins on
// the stage's overlay: one per element of the shown slide that carries an open thread, at the element's top-right as it
// is drawn (its measured bounds, in screen px at the zoom), so a pin follows its element through a move, a resize, a
// restyle, a re-order of slides and a republish, all of which keep the id it is anchored by. A pin opens the threads
// rail on the element's latest open thread. Orphans have no element to pin to; the rail lists them.
import { useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react';
import type { SlideCanvas } from '../../canvas';
import type { Box } from '../../geometry';
import type { DeckThreadState } from '../../threads';
import { measure } from '../transform/measure';
import { useDeckCommentsApi, type DeckCommentsApi } from './controller';
import { COMMENTS_COPY as C } from './copy';
import { useDeckThreadStates } from './use-threads';
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
  return api ? <Pins api={api} {...props} /> : null;
}

function Pins({ api, canvas, slideId, scale, version }: Props & { api: DeckCommentsApi }) {
  const threads = useDeckThreadStates(api.session.doc);
  // the open threads of this slide's live elements, by element, oldest first
  const byElement = useMemo(() => {
    const out = new Map<string, DeckThreadState[]>();
    for (const t of threads) if (t.slideId === slideId && t.status === 'open' && t.live) out.set(t.elementId, [...(out.get(t.elementId) ?? []), t]);
    return out;
  }, [threads, slideId]);
  const [boxes, setBoxes] = useState<Map<string, Box>>(new Map());
  // fix wave 1: measured again after every layout pass too, so a token or a face that moves an element moves its pin
  const [laidOut, setLaidOut] = useState(0);
  useEffect(() => canvas.onLayout(() => setLaidOut((n) => n + 1)), [canvas]);
  useLayoutEffect(() => {
    const next = new Map<string, Box>();
    for (const id of byElement.keys()) {
      const m = canvas.node(id) ? measure(canvas, id, scale) : null;
      if (m) next.set(id, m.bounds);
    }
    setBoxes(next);
  }, [canvas, byElement, scale, version, laidOut]);
  return (
    <>
      {[...byElement].map(([elementId, list]) => {
        const box = boxes.get(elementId);
        if (!box) return null;
        const latest = list[list.length - 1]!;
        const style: CSSProperties = { left: (box.x + box.w) * scale, top: box.y * scale };
        return (
          <button
            key={elementId}
            type="button"
            className="deck-comment-pin"
            data-comment-pin={elementId}
            data-threads={list.map((t) => t.id).join(' ')}
            data-active={list.some((t) => t.id === api.active) || undefined}
            aria-label={C.pin(latest.quote, list.length)}
            title={C.pin(latest.quote, list.length)}
            style={style}
            onClick={() => api.openRail(latest.id)}
          >
            {list.length > 1 ? list.length : ''}
          </button>
        );
      })}
    </>
  );
}
