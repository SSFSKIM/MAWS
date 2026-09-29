// The renderer for `mermaid` fences once the mermaid module has loaded (plugins.ts): a fence whose closing fence is
// present renders as a diagram, any other renders as code, so a diagram never draws from partial source. Completeness
// comes from Streamdown's incomplete-block flag (the last block of a streaming answer) and from the surface's own text
// (the trailing fence that never closed, live or not). The fence is re-rendered through a nested Streamdown, with the
// mermaid plugin for a diagram and without it for code, so both keep Streamdown's own blocks and controls.
import { createContext, useContext } from 'react';
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
  return (
    <Streamdown {...STREAMDOWN_OPTIONS} mode="static" plugins={complete && mermaid ? { code, mermaid } : CODE_ONLY}>
      {complete ? `${opening}\n${source}\n\`\`\`` : `${opening}\n${source}`}
    </Streamdown>
  );
}
