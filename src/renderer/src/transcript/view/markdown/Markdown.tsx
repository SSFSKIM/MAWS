// The one Streamdown wrapper for every markdown surface (assistant text, user text, plan body, question descriptions):
// residue *Streamdown configuration*. `live` selects streaming mode for the block still arriving; a completed block is
// parsed once in static mode, and loses its caret.
import { useMemo } from 'react';
import { Streamdown } from 'streamdown';
import { MermaidFence, OpenMermaidFence } from './MermaidFence';
import { STREAMDOWN_OPTIONS } from './options';
import { code, math, mermaidFences, useMermaidLoader, useMermaidPlugin } from './plugins';
import { holdBackTable } from './streaming';

// Before the mermaid module loads, every fence is code; after, MermaidFence decides per fence.
const PLUGINS = { code, math };
const PLUGINS_WITH_DIAGRAMS = { code, math, renderers: [{ language: 'mermaid', component: MermaidFence }] };

export interface MarkdownProps {
  markdown: string;
  live: boolean;
}

export function Markdown({ markdown: text, live }: MarkdownProps) {
  const markdown = useMemo(() => (live ? holdBackTable(text) : text), [text, live]);
  const fences = useMemo(() => mermaidFences(markdown), [markdown]);
  useMermaidLoader(fences.closed);
  const mermaidLoaded = useMermaidPlugin() !== null;
  return (
    <OpenMermaidFence.Provider value={fences.open}>
      <Streamdown
        {...STREAMDOWN_OPTIONS}
        mode={live ? 'streaming' : 'static'}
        isAnimating={live}
        caret={live ? 'block' : undefined}
        parseIncompleteMarkdown={live}
        plugins={mermaidLoaded ? PLUGINS_WITH_DIAGRAMS : PLUGINS}
        dir="auto"
        className="transcript-prose"
      >
        {markdown}
      </Streamdown>
    </OpenMermaidFence.Provider>
  );
}
