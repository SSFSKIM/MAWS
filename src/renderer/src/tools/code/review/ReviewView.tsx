// Review's diff body (C8c execution document, M3's decisions; ruled 2026-09-29, O2): one file's hunks in
// `@git-diff-view/react`, unified or split, wrapped or not, highlighted through `@git-diff-view/shiki` (which shares
// C6's shiki and creates its highlighter when imported, so it is imported here only). Loaded on first use through
// React.lazy behind ReviewShell, so the main chunk carries none of the library, its stylesheet or the highlighter.
//
// The library draws each file from one unified-diff string (R8: `diffViewHunks`) with no file contents, and scrolls
// horizontally only; this body is the vertical scroller. Hunk navigation scrolls to the hunk's first row (found by its
// line number, since the library draws a hunk's header row only where a gap precedes it), and scrolling by hand reports
// the hunk at the top, so the counter stays honest.
import { DiffModeEnum, DiffView } from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view.css';
import { getDiffViewHighlighter } from '@git-diff-view/shiki';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { diffViewHunks, hunkAnchor } from './review-model';
import type { ReviewMode } from './view-state';

type Highlighter = Awaited<ReturnType<typeof getDiffViewHighlighter>>;

// One highlighter for the app, asked for when this chunk first loads; the view paints plain until it is ready.
let highlighter: Highlighter | null = null;
const highlighterReady: Promise<Highlighter | null> = getDiffViewHighlighter().then(
  (ready) => (highlighter = ready),
  () => null,
);

// The page's theme, as the shell and the harness set it on the root element.
const themeOf = (): 'light' | 'dark' => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
function subscribeTheme(listener: () => void): () => void {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

// A hunk's row: the one showing its first line's number (unified rows carry `data-line-{new,old}-num`, split rows
// `data-line-num` on their side), or the header row the library drew above it when a gap precedes the hunk.
function anchorOf(el: HTMLElement, hunk: string): HTMLElement | null {
  const { side, line } = hunkAnchor(hunk);
  const cell = el.querySelector(`tr[data-state="diff"]:not([data-side]) [data-line-${side}-num="${line}"], tr[data-state="diff"][data-side="${side}"] [data-line-num="${line}"]`);
  const row = cell?.closest<HTMLElement>('tr') ?? null;
  const header = row ? el.querySelector<HTMLElement>(`tr[data-state="hunk"][data-line="${row.dataset.line}-hunk"]:not([data-side="new"])`) : null;
  return header ?? row;
}
const anchorsIn = (el: HTMLElement, hunks: readonly string[]): (HTMLElement | null)[] => hunks.map((hunk) => anchorOf(el, hunk));
const offsetIn = (el: HTMLElement, anchor: HTMLElement) => anchor.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;

export interface ReviewViewProps {
  file: { path: string; oldPath: string | null; hunks: string[] };
  mode: ReviewMode;
  wrap: boolean;
  hunk: number;
  navigate: number; // changes when a button moved the hunk: scroll to it
  initialScrollTop: number; // restored when the view mounts (it is keyed by the file)
  onHunk(hunk: number): void; // scrolling by hand moved the hunk at the top
  onLeave(scrollTop: number): void; // the offset to restore next time
}

export default function ReviewView({ file, mode, wrap, hunk, navigate, initialScrollTop, onHunk, onLeave }: ReviewViewProps) {
  const theme = useSyncExternalStore(subscribeTheme, themeOf);
  const [shiki, setShiki] = useState<Highlighter | null>(highlighter);
  useEffect(() => {
    if (shiki) return;
    let live = true;
    void highlighterReady.then((ready) => live && ready && setShiki(ready));
    return () => void (live = false);
  }, [shiki]);

  const data = useMemo(
    () => ({ oldFile: { fileName: file.oldPath ?? file.path }, newFile: { fileName: file.path }, hunks: diffViewHunks(file) }),
    [file],
  );

  // The offset is restored on mount and handed back on unmount; in between it is the scroller's own, so scrolling
  // renders nothing but a changed hunk.
  const scroller = useRef<HTMLDivElement>(null);
  const initial = useRef(initialScrollTop);
  const leave = useRef(onLeave);
  useLayoutEffect(() => {
    leave.current = onLeave;
  });
  useLayoutEffect(() => {
    const el = scroller.current!;
    el.scrollTop = initial.current;
    return () => leave.current(el.scrollTop);
  }, []);

  const navigated = useRef(navigate);
  useLayoutEffect(() => {
    if (navigated.current === navigate) return;
    navigated.current = navigate;
    const el = scroller.current!;
    const anchor = anchorOf(el, file.hunks[hunk] ?? '');
    if (anchor) el.scrollTop = offsetIn(el, anchor);
  }, [navigate, hunk, file.hunks]);

  // The hunk whose header is at or above the top of the scroller (the first before any has scrolled past).
  const scrolled = () => {
    const el = scroller.current!;
    let current = 0;
    anchorsIn(el, file.hunks).forEach((anchor, index) => {
      if (anchor && offsetIn(el, anchor) <= el.scrollTop + 4) current = index;
    });
    if (current !== hunk) onHunk(current);
  };

  return (
    <div ref={scroller} data-review-body onScroll={scrolled} className="review-diff min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      <DiffView
        data={data}
        diffViewMode={mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
        diffViewWrap={wrap}
        diffViewTheme={theme}
        diffViewFontSize={12}
        diffViewHighlight={shiki !== null}
        registerHighlighter={shiki ?? undefined}
      />
    </div>
  );
}
