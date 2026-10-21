// The transcript's heavy components as the public surface exports them: the virtualised list (with the slot that mounts
// one) and the Markdown module (Streamdown's wrapper, its code and math plugins) are chunks of their own, rendered inside
// their own Suspense boundaries, so the app's entry chunk carries neither. Same names and props as the modules they
// wrap. The chunks start loading as soon as this module is evaluated, beside the entry rather than in it, so a first
// transcript seldom waits; until its chunk has loaded a component shows nothing. A module the entry reaches imports
// Markdown from here, never from view/markdown: a static import there moves it into the entry, and Vite's build says
// so ("dynamically imported by … but also statically imported by …"). The list comes through view/transcript-view.ts.
import { lazy, Suspense } from 'react';
import type { MarkdownProps } from './view/markdown/Markdown';
import type { TranscriptProps } from './view/Transcript';
import type { TranscriptSlotProps } from './view/TranscriptSlot';

const view = import('./view/transcript-view');
const markdown = import('./view/markdown/Markdown');
const LazyTranscript = lazy(() => view.then((module) => ({ default: module.Transcript })));
const LazyTranscriptSlot = lazy(() => view.then((module) => ({ default: module.TranscriptSlot })));
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
