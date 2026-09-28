// The one Streamdown wrapper for every markdown surface (assistant text, user text, plan body, question descriptions):
// residue *Streamdown configuration*. `live` selects streaming mode for the block still arriving; a completed block is
// parsed once in static mode. Link and image components that route clicks to C5's commands join in M3.
import { useMemo } from 'react';
import { Streamdown } from 'streamdown';
import { MermaidFence, OpenMermaidFence } from './MermaidFence';
import { STREAMDOWN_OPTIONS } from './options';
import { code, math, mermaidFences, useMermaidLoader, useMermaidPlugin } from './plugins';

// Before the mermaid module loads, every fence is code; after, MermaidFence decides per fence.
const PLUGINS = { code, math };
const PLUGINS_WITH_DIAGRAMS = { code, math, renderers: [{ language: 'mermaid', component: MermaidFence }] };

export function Markdown({ markdown, live }: { markdown: string; live: boolean }) {
  const fences = useMemo(() => mermaidFences(markdown), [markdown]);
  useMermaidLoader(fences.closed);
  const mermaidLoaded = useMermaidPlugin() !== null;
  return (
    <OpenMermaidFence.Provider value={fences.open}>
      <Streamdown
        {...STREAMDOWN_OPTIONS}
        mode={live ? 'streaming' : 'static'}
        isAnimating={live}
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
