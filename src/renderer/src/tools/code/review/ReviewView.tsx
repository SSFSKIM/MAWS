// Review's diff body (C8c execution document, M3's decisions; ruled 2026-09-29, O2): one file's hunks in
// `@git-diff-view/react`, unified or split, wrapped or not, highlighted through `@git-diff-view/shiki` (which shares
// C6's shiki and creates its highlighter when imported, so it is imported here only). Loaded on first use through
// React.lazy behind ReviewShell, so the main chunk carries none of the library, its stylesheet or the highlighter.
//
// The library draws a diff from one unified-diff string (R8: `diffViewHunks`) with no file contents, and scrolls
// horizontally only; this body is the vertical scroller. A file is one block or more: a git scope's file is one, a
// Last turn file one per edit, since each edit's hunks are numbered against a different version of the file and the
// library drops or re-sorts hunks that overlap or run backwards within one diff (M3 review). Hunks are counted across
// the blocks. Hunk navigation scrolls to the hunk's first row (found by its line number, since the library draws a
// hunk's header row only where a gap precedes it), and scrolling by hand reports the hunk at the top, so the counter
// stays honest; a jump's own scroll event reports nothing, and at the end of the scroller the hunk jumped to stands
// (a hunk in the last screenful cannot reach the top).
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

// A hunk's row inside its block: the one showing its first line's number (unified rows carry `data-line-{new,old}-num`,
// split rows `data-line-num` on their side), or the header row the library drew above it when a gap precedes it.
function anchorOf(block: Element, hunk: string): HTMLElement | null {
  const { side, line } = hunkAnchor(hunk);
  const cell =
    block.querySelector(`tr[data-state="diff"]:not([data-side]) [data-line-${side}-num="${line}"]`) ??
    block.querySelector(`tr[data-state="diff"][data-side="${side}"] [data-line-num="${line}"]`);
  const row = cell?.closest<HTMLElement>('tr') ?? null;
  const header = row ? block.querySelector<HTMLElement>(`tr[data-state="hunk"][data-line="${row.dataset.line}-hunk"]:not([data-side="new"])`) : null;
  return header ?? row;
}
// Every hunk's anchor, in order across the blocks.
function anchorsIn(el: HTMLElement, blocks: readonly (readonly string[])[]): (HTMLElement | null)[] {
  const elements = el.querySelectorAll('[data-review-block]');
  return blocks.flatMap((hunks, b) => hunks.map((hunk) => (elements[b] ? anchorOf(elements[b], hunk) : null)));
}
const offsetIn = (el: HTMLElement, anchor: HTMLElement) => anchor.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
const atEnd = (el: HTMLElement) => el.scrollTop >= el.scrollHeight - el.clientHeight - 1;

export interface ReviewViewProps {
  file: { path: string; oldPath: string | null; blocks: readonly (readonly string[])[] };
  mode: ReviewMode;
  wrap: boolean;
  hunk: number; // across the blocks
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

  // Kept while the file's blocks are the same array, so DiffView parses a diff once, not on every render.
  const { path, oldPath, blocks } = file;
  const data = useMemo(
    () => blocks.map((hunks) => ({ oldFile: { fileName: oldPath ?? path }, newFile: { fileName: path }, hunks: diffViewHunks({ path, oldPath, hunks }) })),
    [path, oldPath, blocks],
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
  const jumping = useRef(false); // a jump moved the scroller: its own scroll event is not the owner's
  useLayoutEffect(() => {
    if (navigated.current === navigate) return;
    navigated.current = navigate;
    const el = scroller.current!;
    const anchor = anchorsIn(el, file.blocks)[hunk];
    if (!anchor) return;
    const top = Math.max(0, Math.min(offsetIn(el, anchor), el.scrollHeight - el.clientHeight));
    if (Math.abs(top - el.scrollTop) < 1) return; // no move, so no scroll event to ignore
    jumping.current = true;
    el.scrollTop = top;
  }, [navigate, hunk, file.blocks]);

  // The hunk whose first row is at or above the top of the scroller (the first before any has scrolled past).
  const scrolled = () => {
    if (jumping.current) {
      jumping.current = false;
      return;
    }
    const el = scroller.current!;
    let current = 0;
    anchorsIn(el, file.blocks).forEach((anchor, index) => {
      if (anchor && offsetIn(el, anchor) <= el.scrollTop + 4) current = index;
    });
    if (current < hunk && atEnd(el)) return; // a later hunk in the last screenful stands
    if (current !== hunk) onHunk(current);
  };

  return (
    <div ref={scroller} data-review-body onScroll={scrolled} className="review-diff min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
      {data.map((block, index) => (
        <div key={index} data-review-block={index} className={index > 0 ? 'border-t border-border' : undefined}>
          <DiffView
            data={block}
            diffViewMode={mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
            diffViewWrap={wrap}
            diffViewTheme={theme}
            diffViewFontSize={12}
            diffViewHighlight={shiki !== null}
            registerHighlighter={shiki ?? undefined}
          />
        </div>
      ))}
    </div>
  );
}
