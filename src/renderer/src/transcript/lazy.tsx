// The transcript's heavy components as the public surface exports them: each module (Streamdown, Shiki, KaTeX and the
// virtualised list behind them) is a chunk of its own, rendered inside its own Suspense boundary, so the app's entry
// chunk carries none of them. Same names and props as the modules they wrap. The chunks start loading as soon as this
// module is evaluated, beside the entry rather than in it, so a first transcript seldom waits; until its chunk has
// loaded a component shows nothing.
import { lazy, Suspense } from 'react';
import type { MarkdownProps } from './view/markdown/Markdown';
import type { TranscriptProps } from './view/Transcript';
import type { TranscriptSlotProps } from './view/TranscriptSlot';

const transcript = import('./view/Transcript');
const slot = import('./view/TranscriptSlot');
const markdown = import('./view/markdown/Markdown');
const LazyTranscript = lazy(() => transcript.then((module) => ({ default: module.Transcript })));
const LazyTranscriptSlot = lazy(() => slot.then((module) => ({ default: module.TranscriptSlot })));
const LazyMarkdown = lazy(() => markdown.then((module) => ({ default: module.Markdown })));

export function Transcript(props: TranscriptProps) {
  return (
    <Suspense fallback={null}>
      <LazyTranscript {...props} />
    </Suspense>
  );
}

export function TranscriptSlot(props: TranscriptSlotProps) {
  return (
    <Suspense fallback={null}>
      <LazyTranscriptSlot {...props} />
    </Suspense>
  );
}

export function Markdown(props: MarkdownProps) {
  return (
    <Suspense fallback={null}>
      <LazyMarkdown {...props} />
    </Suspense>
  );
}
