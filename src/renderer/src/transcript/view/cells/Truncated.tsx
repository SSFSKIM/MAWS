// Tool output past the DOM cap (residue *Bounded surfaces and truncation*): the model's Truncation keeps the whole
// string; the view shows its head and tail around an "N KB omitted" marker. Copy actions still copy the whole string.
import { DETAIL } from '../../model/copy';
import type { Truncation } from '../../model/rows';

export function Truncated({ text, truncation }: { text: string; truncation: Truncation | null }) {
  if (!truncation) return <>{text}</>;
  return (
    <>
      {text.slice(0, truncation.shownHead)}
      <span className="transcript-omitted">{`\n… ${DETAIL.omitted(truncation.omittedBytes)} …\n`}</span>
      {text.slice(-truncation.shownTail)}
    </>
  );
}

// A bounded output block (144 px, scrolls inside) for a tool's text output.
export function Output({ text, truncation, className }: { text: string; truncation: Truncation | null; className?: string }) {
  return (
    <pre className={`transcript-output ${className ?? ''}`}>
      <Truncated text={text} truncation={truncation} />
    </pre>
  );
}
