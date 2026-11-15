// One file's diff in the stack (UX wave U5b, M3; the execution document's §F; the successor of ReviewView.tsx, which the
// acting pane still draws through until U5b-2 deletes both): the file's blocks in `@git-diff-view/react`, unified or
// split, wrapped or not, highlighted through `@git-diff-view/shiki` (which shares C6's shiki and creates its
// highlighter when imported, so it is imported here only). Loaded on first use through React.lazy behind the section,
// so the main chunk carries none of the library, its stylesheet or the highlighter (ruled 2026-09-29, O2).
//
// The body is not a scroller: the stack is the one scroller and each body is as tall as its rows. A file is one block
// or more: a git scope's file is one, a Last turn file one per edit, since each edit's hunks are numbered against a
// different version of the file and the library drops or re-sorts hunks that overlap or run backwards within one diff
// (C8c M3 review). The section hands each block's `data` object over kept while the file's text is equal: a new
// object remounts the library's rows, and any open widget row with them (P2).
import { DiffModeEnum, DiffView } from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view.css';
import { getDiffViewHighlighter } from '@git-diff-view/shiki';
import { Component, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { REVIEW_COPY } from '../copy';
import type { ReviewMode } from './view-state';

type Highlighter = Awaited<ReturnType<typeof getDiffViewHighlighter>>;

// What the library draws one block from (R8: `diffViewHunks`, one unified-diff string per block).
export interface DiffBlockData {
  oldFile: { fileName: string };
  newFile: { fileName: string };
  hunks: string[];
}

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

export interface FileBodyProps {
  data: readonly DiffBlockData[];
  mode: ReviewMode; // as drawn: Unified where the stack is too narrow for Split
  wrap: boolean;
}

export default function FileBody({ data, mode, wrap }: FileBodyProps) {
  const theme = useSyncExternalStore(subscribeTheme, themeOf);
  const [shiki, setShiki] = useState<Highlighter | null>(highlighter);
  useEffect(() => {
    if (shiki) return;
    let live = true;
    void highlighterReady.then((ready) => live && ready && setShiki(ready));
    return () => void (live = false);
  }, [shiki]);

  return (
    <>
      {data.map((block, index) => (
        <div key={index} data-review-block={index} className={index > 0 ? 'border-t border-border' : undefined}>
          <BlockBoundary block={block}>
            <DiffView
              data={block}
              diffViewMode={mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
              diffViewWrap={wrap}
              diffViewTheme={theme}
              diffViewFontSize={12}
              diffViewHighlight={shiki !== null}
              registerHighlighter={shiki ?? undefined}
            />
          </BlockBoundary>
        </div>
      ))}
    </>
  );
}

// The diff view throws while rendering a diff its parser rejects; uncaught, that would unmount the whole window (C8c
// M4: found over a fixture's unprefixed context lines). One block says so instead, and tries again when its diff changes.
interface BlockBoundaryState {
  error: string | null; // the diff view's message for this block, or null while it draws
  block: unknown; // the block the error belongs to
}

class BlockBoundary extends Component<{ block: unknown; children: ReactNode }, BlockBoundaryState> {
  state: BlockBoundaryState = { error: null, block: this.props.block };

  static getDerivedStateFromError(error: unknown): Partial<BlockBoundaryState> {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  static getDerivedStateFromProps(props: { block: unknown }, state: BlockBoundaryState): Partial<BlockBoundaryState> | null {
    return props.block === state.block ? null : { error: null, block: props.block };
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <p role="status" className="px-3 py-2 text-ui-sm text-fg-muted">
        {REVIEW_COPY.unavailable(this.state.error)}
      </p>
    );
  }
}
