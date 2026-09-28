// The one Streamdown wrapper for every markdown surface (assistant text, user text, plan body, question descriptions):
// residue *Streamdown configuration*. `live` selects streaming mode for the block still arriving; a completed block is
// parsed once in static mode. Link and image components that route clicks to C5's commands join in M3.
import { Streamdown } from 'streamdown';
import { useMarkdownPlugins } from './plugins';
import { rehypePlugins, remarkPlugins, transcriptUrlTransform } from './sanitize';

const CONTROLS = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
  mermaid: { copy: true, download: false, fullscreen: true, panZoom: true },
  image: false,
} as const;
const LINK_SAFETY = { enabled: false }; // links are intercepted, not gated by a modal

export function Markdown({ markdown, live }: { markdown: string; live: boolean }) {
  const plugins = useMarkdownPlugins(markdown, live);
  return (
    <Streamdown
      mode={live ? 'streaming' : 'static'}
      isAnimating={live}
      parseIncompleteMarkdown={live}
      plugins={plugins}
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      urlTransform={transcriptUrlTransform}
      linkSafety={LINK_SAFETY}
      controls={CONTROLS}
      lineNumbers={false}
      codeBlockMaxHeight={480}
      tableMaxHeight={320}
      dir="auto"
      className="transcript-prose"
    >
      {markdown}
    </Streamdown>
  );
}
