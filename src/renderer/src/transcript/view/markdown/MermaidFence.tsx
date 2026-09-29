// The renderer for `mermaid` fences once the mermaid module has loaded (plugins.ts): a fence whose closing fence is
// present renders as a diagram, any other renders as code, so a diagram never draws from partial source. Completeness
// comes from Streamdown's incomplete-block flag (the last block of a streaming answer) and from the surface's own text
// (the trailing fence that never closed, live or not). The fence is re-rendered through a nested Streamdown, with the
// mermaid plugin for a diagram and without it for code, so both keep Streamdown's own blocks and controls.
//
// A closed fence keeps showing as code until its diagram has drawn: Streamdown's diagram block is an empty frame while
// mermaid lays it out (about a third of a second, longer for the first diagram of a page load), so the diagram renders
// hidden beside the code and replaces it once its SVG is in place. A diagram mermaid cannot draw stays as its code.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Streamdown, type CustomRendererProps } from 'streamdown';
import { STREAMDOWN_OPTIONS } from './options';
import { code, useMermaidPlugin } from './plugins';

// The source of the surface's trailing unterminated mermaid fence, or null (Markdown.tsx provides it).
export const OpenMermaidFence = createContext<string | null>(null);

const CODE_ONLY = { code };

export function MermaidFence({ code: source, isIncomplete, meta }: CustomRendererProps) {
  const mermaid = useMermaidPlugin();
  const open = useContext(OpenMermaidFence);
  const complete = !isIncomplete && (open === null || open.trimEnd() !== source.trimEnd());
  const opening = `\`\`\`mermaid${meta ? ` ${meta}` : ''}`;
  const fenced = complete ? `${opening}\n${source}\n\`\`\`` : `${opening}\n${source}`;
  const diagram = complete && mermaid !== null;
  const drawn = useDrawn(diagram ? source : null);
  const withDiagrams = useMemo(() => (mermaid ? { code, mermaid } : CODE_ONLY), [mermaid]);
  return (
    <div className="transcript-mermaid" data-drawn={drawn.ready ? '' : undefined}>
      {diagram && (
        <div ref={drawn.ref} className="transcript-mermaid-diagram">
          <Streamdown {...STREAMDOWN_OPTIONS} mode="static" plugins={withDiagrams}>
            {fenced}
          </Streamdown>
        </div>
      )}
      {!drawn.ready && (
        <Streamdown {...STREAMDOWN_OPTIONS} mode="static" plugins={CODE_ONLY}>
          {fenced}
        </Streamdown>
      )}
    </div>
  );
}

// Whether the diagram of `source` (null: none is drawing) has its SVG in the element `ref` names.
function useDrawn(source: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  const [drawnFor, setDrawnFor] = useState<string | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (source === null || !root) return;
    const check = () => {
      if (root.querySelector('[data-streamdown="mermaid"] [role="img"] > svg')) setDrawnFor(source);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [source]);
  return { ref, ready: source !== null && drawnFor === source };
}
