// A markdown file rendered (C8c execution document, Interfaces *Viewer kinds and caps*): C6's `Markdown` (static, its
// sanitising pipeline), the scroll kept across hidden tabs and handed to the Source view as a ratio on the toggle.
import { useLayoutEffect, useRef } from 'react';
import { Markdown } from '../../../transcript';
import { viewState, type ViewerEntry } from './viewer-store';

export function MarkdownView({ entry }: { entry: ViewerEntry }) {
  const scroller = useRef<HTMLDivElement>(null);
  const { tabId } = entry;
  useLayoutEffect(() => {
    const el = scroller.current!;
    const saved = viewState(tabId);
    if (saved.ratioPending && saved.ratio !== null) el.scrollTop = saved.ratio * Math.max(0, el.scrollHeight - el.clientHeight);
    else el.scrollTop = saved.renderedScroll;
    saved.ratioPending = false;
    return () => void Object.assign(viewState(tabId), { renderedScroll: el.scrollTop, ratio: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) });
  }, [tabId]);
  return (
    <div ref={scroller} data-markdown-view className="h-full min-h-0 overflow-auto px-6 py-4">
      <div className="mx-auto max-w-[var(--measure)]">
        <Markdown markdown={entry.text} live={false} />
      </div>
    </div>
  );
}
