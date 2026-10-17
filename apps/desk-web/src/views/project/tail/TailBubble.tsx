// A send not yet in the transcript, at the session view's tail (the owner's 1B): MAWS's user bubble — its classes, its
// text through MAWS's Markdown, its fold past 19 lines, the time and Copy beside it on hover — with the send's delivery
// state as the bubble's foot, and the whole bubble tinted when the send will not arrive (`data-state`, the desk's
// stylesheet). MAWS's `UserRow` is not edited in this round, so the bubble is drawn here in its shape.
import { useLayoutEffect, useRef, useState } from 'react';
import { formatClock } from '../../../../../../src/renderer/src/app/date-format';
import { Markdown } from '../../../../../../src/renderer/src/transcript/view/markdown/Markdown';
import { copyText } from '../../../../../../src/renderer/src/transcript/view/rows/parts';
import type { FootState } from '../../../conversation/tail';
import { DeliveryFoot } from './DeliveryFoot';

export function TailBubble({ text, at, foot }: { text: string; at: string | null; foot: { state: FootState; words: string; reason: string | null } }) {
  const content = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  // Measured while folded only, as MAWS's `UserRow` measures it: again whenever the content's size changes (the center
  // narrowing or widening, the text rewrapping), so "Show more" follows the bubble's width.
  useLayoutEffect(() => {
    const element = content.current;
    if (!element || open) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined' || !element.firstElementChild) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [open, text]);
  const time = at === null ? NaN : Date.parse(at);
  return (
    <section className="transcript-user desk-tail-send" aria-label="Your message, not in the transcript yet" data-state={foot.state} data-testid="tail-send">
      <div className="transcript-user-body">
        <div className="transcript-user-bubble" data-bubble="" data-open={open ? '' : undefined} data-collapsed={overflows && !open ? '' : undefined}>
          <div ref={content} className="transcript-user-content" data-user-content="">
            <div>
              <Markdown markdown={text} live={false} />
            </div>
          </div>
          {(open || overflows) && (
            <button type="button" className="transcript-quiet-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? 'Show less' : 'Show more'}
            </button>
          )}
          <DeliveryFoot {...foot} />
        </div>
        <div className="transcript-user-actions">
          {!Number.isNaN(time) && <span>{formatClock(time)}</span>}
          <button type="button" onClick={() => copyText(text)}>
            Copy
          </button>
        </div>
      </div>
    </section>
  );
}
