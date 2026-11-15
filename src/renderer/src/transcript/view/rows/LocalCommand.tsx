// The engine's echo after a slash command (`local_command`), never a bubble. UX wave U3b (O-18; docs/doperpowers/plans/
// 2026-11-15-ux-wave-U3b-transcript-rows-find.md, decision 4 and Interfaces B): a light line under the command's bubble,
// on its side, with no frame and no heading: a dim `⎿`, then the output in muted small text, in `--danger` where all of it
// came in the error tag. The output is drawn once, through the transcript's markdown or, for a terminal's text
// (`plain`), preformatted, and that one drawing is clipped to two lines of the row's type while the disclosure
// `line:<row id>` is closed. "Show more" is offered when the closed drawing is measured as cut, as the bubble measures its
// fold (rows/User.tsx), and opens it; "Show less" closes it. So both states hold the same text. A line with no bubble of
// its command in its turn names the command first, where the engine said which it ran.
import { useLayoutEffect, useRef, useState } from 'react';
import { COMMAND_LINE, commandLead } from '../../model/copy';
import type { Row } from '../../model/rows';
import { useDisclosure } from '../context';
import { Markdown } from '../markdown/Markdown';

export function LocalCommandRow({ row }: { row: Extract<Row, { kind: 'local_command' }> }) {
  const [open, toggle] = useDisclosure(`line:${row.id}`);
  const output = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  // Measured while closed only: an open line has no bound. Open stays in the transcript-wide disclosures while the
  // measurement is this mount's, so an open line always offers Show less, and closing measures again. The line's own
  // box is observed too: a narrower column wraps a one-line output onto a third line.
  useLayoutEffect(() => {
    const element = output.current;
    if (!element || open) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined' || !element.firstElementChild) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [open, row.text, row.plain]);

  return (
    <div className="transcript-command" data-error={row.error ? '' : undefined}>
      <div className="transcript-command-line">
        <span className="transcript-command-mark" aria-hidden="true">{COMMAND_LINE.mark}</span>
        {row.lone && row.run && <span className="transcript-command-name">{commandLead(row.run)}</span>}
        <div ref={output} className="transcript-command-output" data-open={open ? '' : undefined} data-collapsed={overflows && !open ? '' : undefined}>
          {row.plain ? <pre>{row.text}</pre> : <Markdown markdown={row.text} live={false} />}
        </div>
      </div>
      {(open || overflows) && (
        <button type="button" className="transcript-quiet-button" aria-expanded={open} onClick={toggle}>
          {open ? COMMAND_LINE.showLess : COMMAND_LINE.showMore}
        </button>
      )}
    </div>
  );
}
