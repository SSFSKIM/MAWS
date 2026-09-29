// Tool output past the DOM cap (residue *Bounded surfaces and truncation*): anything over 64 KB shows its first 32 KB
// and last 16 KB around an "N KB omitted" marker; the model keeps the whole string, and copy actions copy all of it.
// Every output branch of the work area renders through one of these, so no expanded cell can put an unbounded
// payload into the virtualised list.
import { TRUNCATE_OVER, truncationOf } from '../../model/cells';
import { DETAIL } from '../../model/copy';
import type { Cell } from '../../model/rows';
import { useActions } from '../context';
import { Markdown } from '../markdown/Markdown';

export function Truncated({ text }: { text: string }) {
  const truncation = truncationOf(text);
  if (!truncation) return <>{text}</>;
  return (
    <>
      {text.slice(0, truncation.shownHead)}
      <span className="transcript-omitted" data-omitted="">{`\n… ${DETAIL.omitted(truncation.omittedBytes)} …\n`}</span>
      {text.slice(-truncation.shownTail)}
    </>
  );
}

// A bounded output block (144 px, scrolls inside) for a tool's text output.
export function Output({ text, className }: { text: string; className?: string }) {
  return (
    <pre className={`transcript-output ${className ?? ''}`}>
      <Truncated text={text} />
    </pre>
  );
}

// Where a detail stopped rendering a result made of parts (blocks, diff lines): what was left out, and the route to it.
export function Omitted({ cell, text }: { cell: Cell; text: string }) {
  const actions = useActions();
  return (
    <div className="transcript-omitted-row" data-omitted="">
      <span className="transcript-omitted">{text}</span>
      <button type="button" onClick={() => actions.openFullLog(cell)}>
        {DETAIL.openFullLog}
      </button>
    </div>
  );
}

// Tool-supplied markdown (MCP text blocks): rendered as markdown up to the cap, as capped plain text beyond it.
export function CappedMarkdown({ text }: { text: string }) {
  return text.length > TRUNCATE_OVER ? <Output text={text} /> : <Markdown markdown={text} live={false} />;
}
