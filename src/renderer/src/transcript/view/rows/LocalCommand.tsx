// The engine's echo after a slash command (`local_command`), never a bubble. UX wave U3b (O-18; docs/doperpowers/plans/
// 2026-11-15-ux-wave-U3b-transcript-rows-find.md, decision 4 and Interfaces B): a light line under the command's bubble,
// on its side, with no frame and no heading: a dim `⎿`, then the output in muted small text, in `--danger` where all of it
// came in the error tag. The output is drawn once, through the transcript's markdown or, for a terminal's text
// (`plain`), preformatted, and that one drawing is clipped to two lines of the row's type while the disclosure
// `line:<row id>` is closed, at the bottom of its second drawn line (ruling R19), or at two lines of its type where it
// draws what is not text lines (the branch panel's finding 3). "Show more" is offered when the drawing
// is measured as cut and opens it; "Show less" closes it. So both states hold the same text. A line with no bubble of
// its command in its turn names the command first, where the engine said which it ran. Line ends are kept (ruling R4) by
// the transcript's markdown itself, whose remark-breaks draws each source line break as a break.
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { COMMAND_LINE, commandLead } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useDisclosure } from '../context';
import { Markdown } from '../markdown/Markdown';
import { closedBound, drawnLineBoxes, lineHeightOf } from './command-bound';

export function LocalCommandRow({ row }: { row: Extract<Row, { kind: 'local_command' }> }) {
  const [open, toggle] = useDisclosure(`line:${row.id}`);
  const output = useRef<HTMLDivElement>(null);
  const [bound, setBound] = useState<number | null>(null);

  // Ruling R19 and the branch panel's finding 3: closed, the output is never drawn taller than its bound (the bottom of
  // its second drawn line, or two lines of its type where what it draws is not text lines), measured at mount and again
  // on any change of its size: a narrower column wraps a line onto a third, an image finishes loading. The drawing inside
  // is observed as well as the output, whose own box the bound caps. Measured while closed only: open stays in the
  // transcript-wide disclosures while the measurement is this mount's, so an open line always offers Show less, and
  // closing measures again. An output no taller than its bound has none and no Show more.
  useLayoutEffect(() => {
    const element = output.current;
    if (!element || open) return;
    const measure = () => setBound(closedBound(drawnLineBoxes(element), element.scrollHeight, lineHeightOf(element)));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [open, row.text, row.plain]);
  const cut = bound !== null;

  // Ruling R2: a one-line output sits on the bubble's side, as wide as its words; one whose text has a line end is a block
  // of the column's width in both states, so opening it moves nothing sideways. The text decides, not a measured width.
  const block = row.text.includes('\n');
  return (
    <div className="transcript-command" data-error={row.error ? '' : undefined} data-block={block ? '' : undefined}>
      <span className="transcript-command-mark" aria-hidden="true">{COMMAND_LINE.mark}</span>
      <div className="transcript-command-body">
        <div className="transcript-command-text">
          {row.lone && row.run && <span className="transcript-command-name">{commandLead(row.run)}</span>}
          <div ref={output} className="transcript-command-output" data-open={open ? '' : undefined} data-collapsed={cut && !open ? '' : undefined} style={cut && !open ? ({ '--command-bound': `${bound}px` } as CSSProperties) : undefined}>
            {row.plain ? <pre>{row.text}</pre> : <Markdown markdown={row.text} live={false} />}
          </div>
        </div>
        {(open || cut) && (
          <button type="button" className="transcript-quiet-button" aria-expanded={open} onClick={toggle}>
            {open ? COMMAND_LINE.showLess : COMMAND_LINE.showMore}
          </button>
        )}
      </div>
    </div>
  );
}
