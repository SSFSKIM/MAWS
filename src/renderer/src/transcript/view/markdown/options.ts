// The Streamdown props every transcript markdown surface shares (residue *Streamdown configuration*), used by the
// Markdown wrapper and by the per-fence mermaid renderer's nested Streamdown alike.
import { TranscriptImage } from './Image';
import { TranscriptLink } from './Link';
import { rehypePlugins, remarkPlugins, transcriptUrlTransform } from './sanitize';

export const STREAMDOWN_OPTIONS = {
  remarkPlugins,
  rehypePlugins,
  urlTransform: transcriptUrlTransform,
  linkSafety: { enabled: false }, // links are intercepted, not gated by a modal
  components: { a: TranscriptLink, img: TranscriptImage }, // clicks route to C5's commands; images only from inline data
  controls: {
    code: { copy: true, download: false },
    table: { copy: true, download: false, fullscreen: false },
    mermaid: { copy: true, download: false, fullscreen: true, panZoom: true },
    image: false,
  },
  lineNumbers: false,
  codeBlockMaxHeight: 480,
  tableMaxHeight: 320,
} as const;
