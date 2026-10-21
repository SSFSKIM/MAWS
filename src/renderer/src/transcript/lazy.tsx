// The transcript's heavy components as the public surface exports them: the virtualised list (with the slot that mounts
// one) and the Markdown module (Streamdown's wrapper, its code and math plugins) are chunks of their own, so the app's
// entry chunk carries neither. Same names and props as the modules they wrap. The chunks start loading as soon as this
// module is evaluated, beside the entry rather than in it, so a first transcript seldom waits; until its chunk has
// loaded a component shows nothing. A module the entry reaches imports Markdown from here, never from view/markdown: a
// static import there moves it into the entry, and Vite's build says so ("dynamically imported by … but also
// statically imported by …"). The list comes through view/transcript-view.ts.
import { lazy, Suspense, useState, type ComponentType } from 'react';
import type { MarkdownProps } from './view/markdown/Markdown';
import type { TranscriptProps } from './view/Transcript';
import type { TranscriptSlotProps } from './view/TranscriptSlot';

// A chunk's component, drawn in an instance's first commit once the chunk has loaded (React.lazy suspends the first
// instance it ever renders even then, so a first consumer's layout, a log pinned to its end, met an empty commit). An
// instance mounted before the chunk arrives keeps its Suspense boundary for life: the arrival never remounts it.
function fromChunk<P extends object>(chunk: Promise<ComponentType<P>>): ComponentType<P> {
  let loaded: ComponentType<P> | null = null;
  chunk.then(
    (component) => (loaded = component),
    () => {}, // a chunk that fails to load fails through the lazy component, under the consumer's error boundary
  );
  const Lazy = lazy(() => chunk.then((component) => ({ default: component })));
  return function FromChunk(props: P) {
    const [Loaded] = useState(() => loaded);
    if (Loaded) return <Loaded {...props} />;
    return (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}

const view = import('./view/transcript-view');
export const Transcript = fromChunk<TranscriptProps>(view.then((module) => module.Transcript));
export const TranscriptSlot = fromChunk<TranscriptSlotProps>(view.then((module) => module.TranscriptSlot));
export const Markdown = fromChunk<MarkdownProps>(import('./view/markdown/Markdown').then((module) => module.Markdown));
