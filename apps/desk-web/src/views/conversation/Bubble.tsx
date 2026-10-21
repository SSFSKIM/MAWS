// A human's message as MAWS's user bubble, outside MAWS's transcript: its classes, its text through MAWS's Markdown (its
// links opening as every link in a message on the desk does, `browser-actions.ts`), its fold past 19 rendered lines, the
// time and Copy beside it on hover, and whatever the caller puts under the text inside the bubble (a delivery foot).
// MAWS's `UserRow` is not edited for the desk, so the bubble is drawn here in its shape, once, for the session view's
// tail (`project/tail/TailBubble.tsx`) and the group chat (`StreamView.tsx`). Measured while folded only, as `UserRow`
// measures it: again whenever the content's size changes (the column narrowing or widening, the text rewrapping), so
// "Show more" follows the bubble's width.
import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { formatClock } from '@shared/app/date-format';
import { TranscriptActionsProvider } from '../../../../../src/renderer/src/transcript/view/context';
import { Markdown } from '../../../../../src/renderer/src/transcript/view/markdown/Markdown';
import { BROWSER_ACTIONS } from './browser-actions';

/** Per-row copy, as MAWS's rows do it: the page may use the clipboard on a user gesture. */
export const copyText = (text: string): void => void navigator.clipboard?.writeText(text);

type Props = {
  text: string;
  /** When it was sent, where known: the time beside the bubble on hover. */
  at: string | null;
  /** What stands under the text inside the bubble: a delivery foot, or nothing. */
  foot?: ReactNode;
  /** What stands before the bubble: a line naming another human, or nothing. */
  head?: ReactNode;
} & HTMLAttributes<HTMLElement>;

export function Bubble({ text, at, foot, head, className, ...rest }: Props) {
  const content = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
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
    <section className={['transcript-user', className].filter(Boolean).join(' ')} {...rest}>
      {head}
      <div className="transcript-user-body">
        <div className="transcript-user-bubble" data-bubble="" data-open={open ? '' : undefined} data-collapsed={overflows && !open ? '' : undefined}>
          <div ref={content} className="transcript-user-content" data-user-content="">
            <div>
              <TranscriptActionsProvider actions={BROWSER_ACTIONS}>
                <Markdown markdown={text} live={false} />
              </TranscriptActionsProvider>
            </div>
          </div>
          {(open || overflows) && (
            <button type="button" className="transcript-quiet-button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? 'Show less' : 'Show more'}
            </button>
          )}
          {foot}
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
