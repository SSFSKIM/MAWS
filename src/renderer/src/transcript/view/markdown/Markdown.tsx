// The one Streamdown wrapper for every markdown surface (assistant text, user text, plan body, question descriptions):
// residue *Streamdown configuration*. `live` selects streaming mode for the block still arriving; a completed block is
// parsed once in static mode, and loses its caret.
import { useMemo } from 'react';
import { Streamdown } from 'streamdown';
import { MermaidFence } from './MermaidFence';
import { STREAMDOWN_OPTIONS } from './options';
import { code, math } from './plugins';
import { holdBackTable } from './streaming';

// Every `mermaid` fence renders through MermaidFence: code until the mermaid module has loaded and its fence has
// closed, and the first closed fence loads the module.
const PLUGINS = { code, math, renderers: [{ language: 'mermaid', component: MermaidFence }] };

export interface MarkdownProps {
  markdown: string;
  live: boolean;
}

export function Markdown({ markdown: text, live }: MarkdownProps) {
  const markdown = useMemo(() => (live ? holdBackTable(text) : text), [text, live]);
  return (
    <Streamdown
      {...STREAMDOWN_OPTIONS}
      mode={live ? 'streaming' : 'static'}
      isAnimating={live}
      caret={live ? 'block' : undefined}
      parseIncompleteMarkdown={live}
      plugins={PLUGINS}
      dir="auto"
      className={live ? 'transcript-prose transcript-prose-live' : 'transcript-prose'}
    >
      {markdown}
    </Streamdown>
  );
}
