// The renderer for `mermaid` fences once the mermaid module has loaded (plugins.ts): a fence whose closing fence is
// present renders as a diagram, any other renders as code, so a diagram never draws from partial source. Completeness
// comes from Streamdown's incomplete-block flag (the last block of a streaming answer) and from the fence's own parse
// (plugins.ts marks a fence that never closed, live or not, in its metastring). The fence is re-rendered through a
// nested Streamdown, with the mermaid plugin for a diagram and without it for code, so both keep Streamdown's own
// blocks and controls.
//
// A closed fence keeps showing as code until its diagram has drawn: Streamdown's diagram block is an empty frame while
// mermaid lays it out (about a third of a second, longer for the first diagram of a page load), so the diagram renders
// hidden beside the code and replaces it once its SVG is in place. A diagram mermaid cannot draw stays as its code, with
// a muted line saying so.
import { useEffect, useMemo, useState } from 'react';
import { Streamdown, type CustomRendererProps } from 'streamdown';
import { DIAGRAM } from '../../model/copy';
import { STREAMDOWN_OPTIONS } from './options';
import { code, openFenceOf, useMermaidLoader, useMermaidPlugin } from './plugins';

const CODE_ONLY = { code };

export function MermaidFence({ code: source, isIncomplete, meta: marked }: CustomRendererProps) {
  const mermaid = useMermaidPlugin();
  const { open, meta } = openFenceOf(marked);
  const complete = !isIncomplete && !open;
  useMermaidLoader(complete);
  const opening = `\`\`\`mermaid${meta ? ` ${meta}` : ''}`;
  const fenced = complete ? `${opening}\n${source}\n\`\`\`` : `${opening}\n${source}`;
  const diagram = complete && mermaid !== null;
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const outcome = useOutcome(root, diagram ? source : null);
  const withDiagrams = useMemo(() => (mermaid ? { code, mermaid } : CODE_ONLY), [mermaid]);
  return (
    <div className="transcript-mermaid" data-drawn={outcome === 'drawn' ? '' : undefined}>
      {diagram && (
        <div ref={setRoot} className="transcript-mermaid-diagram">
          <Streamdown {...STREAMDOWN_OPTIONS} mode="static" plugins={withDiagrams} mermaid={FAILURE_MARKER}>
            {fenced}
          </Streamdown>
        </div>
      )}
      {outcome !== 'drawn' && (
        <Streamdown {...STREAMDOWN_OPTIONS} mode="static" plugins={CODE_ONLY}>
          {fenced}
        </Streamdown>
      )}
      {outcome === 'failed' && <p className="transcript-mermaid-failed">{DIAGRAM.failed}</p>}
    </div>
  );
}

// Streamdown's error box for a diagram mermaid rejected, replaced by a marker the hidden diagram's observer reads: the
// fence stays as its code, with one muted line saying the diagram could not be drawn.
const FAILURE_MARKER = { errorComponent: () => <span data-mermaid-failed="" /> };

// What became of the diagram of `source` (null: none is drawing) in `root`, the diagram's element: its SVG is in
// place, mermaid rejected it, or neither yet.
function useOutcome(root: HTMLElement | null, source: string | null): 'drawing' | 'drawn' | 'failed' {
  const [settled, setSettled] = useState<{ source: string; outcome: 'drawn' | 'failed' } | null>(null);
  useEffect(() => {
    if (source === null || !root) return;
    const check = () => {
      if (root.querySelector('[data-streamdown="mermaid"] [role="img"] > svg')) setSettled({ source, outcome: 'drawn' });
      else if (root.querySelector('[data-mermaid-failed]')) setSettled({ source, outcome: 'failed' });
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [root, source]);
  return source !== null && settled?.source === source ? settled.outcome : 'drawing';
}
