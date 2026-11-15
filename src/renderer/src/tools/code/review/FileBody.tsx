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
//
// UX wave U5b, M5 (§G): comments on lines. Under a surface that takes them (`LineCommentsContext`), each block offers the
// library's add button on every line of either side; its widget row is opened at the place of the surface's open card
// when that card is on this file (and closed elsewhere), and holds the row the card is drawn in (`CommentRow`); each
// other unsent comment is an extend row under its line (`UnsentRows`).
import { DiffModeEnum, DiffView, SplitSide } from '@git-diff-view/react';
import '@git-diff-view/react/styles/diff-view.css';
import { getDiffViewHighlighter } from '@git-diff-view/shiki';
import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { PassComment } from '../../../side/card/store';
import { REVIEW_COPY } from '../copy';
import type { LinePlace, LineSide } from './comment-place';
import { CommentRow, UnsentRows, useLineCommentsContext, type PlacedComment } from './LineComments';
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
  path: string; // the file's identity in the stack, where its comments are drawn
  data: readonly DiffBlockData[];
  mode: ReviewMode; // as drawn: Unified where the stack is too narrow for Split
  wrap: boolean;
}

export default function FileBody({ path, data, mode, wrap }: FileBodyProps) {
  const theme = useSyncExternalStore(subscribeTheme, themeOf);
  const [shiki, setShiki] = useState<Highlighter | null>(highlighter);
  useEffect(() => {
    if (shiki) return;
    let live = true;
    void highlighterReady.then((ready) => live && ready && setShiki(ready));
    return () => void (live = false);
  }, [shiki]);

  const comments = useLineCommentsContext();
  const card = comments?.card?.path === path ? comments.card : null;
  const rows = comments ? comments.rowsOf(path) : NO_ROWS;
  const add = comments?.add;
  // The library's widget row stands at the open card's place in its block and nowhere else; each block's widget store
  // is the library's (a new one with each `data` object and each mode), told again whenever either changes.
  const hooks = useRef(new Map<number, WidgetHook>());
  const wanted = useRef<LinePlace | null>(card);
  const blocks = useMemo(
    () =>
      data.map((_, block) => ({
        onAdd: (line: number, side: SplitSide) => add?.(path, block, sideOf(side), line),
        renderWidget: ({ side, lineNumber, onClose }: { side: SplitSide; lineNumber: number; onClose(): void }) => <CommentRow path={path} place={{ block, side: sideOf(side), line: lineNumber }} onClose={onClose} />,
        onWidgetHook: (hook: WidgetHook) => {
          hooks.current.set(block, hook);
          openAt(hook, block, wanted.current);
        },
      })),
    [data, path, add],
  );
  const extend = useMemo(() => data.map((_, block) => extendOf(rows, block)), [data, rows]);

  useEffect(() => {
    wanted.current = card;
    for (const [block, hook] of hooks.current) openAt(hook, block, card);
  }, [card]);

  return (
    <>
      {data.map((block, index) => (
        <div key={index} data-review-block={index} className={index > 0 ? 'border-t border-border' : undefined}>
          <BlockBoundary block={block}>
            <DiffView<readonly PassComment[]>
              data={block}
              diffViewMode={mode === 'split' ? DiffModeEnum.Split : DiffModeEnum.Unified}
              diffViewWrap={wrap}
              diffViewTheme={theme}
              diffViewFontSize={12}
              diffViewHighlight={shiki !== null}
              registerHighlighter={shiki ?? undefined}
              {...(comments && {
                diffViewAddWidget: true,
                onAddWidgetClick: blocks[index].onAdd,
                renderWidgetLine: blocks[index].renderWidget,
                onCreateUseWidgetHook: blocks[index].onWidgetHook,
                extendData: extend[index],
                renderExtendLine: renderUnsent,
              })}
            />
          </BlockBoundary>
        </div>
      ))}
    </>
  );
}

const NO_ROWS: readonly PlacedComment[] = [];
const sideOf = (side: SplitSide): LineSide => (side === SplitSide.old ? 'old' : 'new');
type WidgetHook = { getReadonlyState(): { widgetSide?: SplitSide; widgetLineNumber?: number; setWidget(at: { side?: SplitSide; lineNumber?: number }): void } };

// A block's widget at `place` when it is in that block, else closed; nothing when it already stands there.
function openAt(hook: WidgetHook, block: number, place: LinePlace | null): void {
  const state = hook.getReadonlyState();
  const side = place?.block === block ? (place.side === 'old' ? SplitSide.old : SplitSide.new) : undefined;
  const line = place?.block === block ? place.line : undefined;
  if (state.widgetSide === side && state.widgetLineNumber === line) return;
  state.setWidget(side === undefined ? {} : { side, lineNumber: line });
}

// The library's extend rows of a block: its unsent comments by side and line.
function extendOf(rows: readonly PlacedComment[], block: number) {
  const oldFile: Record<string, { data: readonly PassComment[] }> = {};
  const newFile: Record<string, { data: readonly PassComment[] }> = {};
  for (const row of rows) {
    if (row.block !== block) continue;
    const side = row.side === 'old' ? oldFile : newFile;
    side[row.line] = { data: [...(side[row.line]?.data ?? []), row.comment] };
  }
  return { oldFile, newFile };
}

const renderUnsent = ({ data, side }: { data: readonly PassComment[]; side: SplitSide }) => <UnsentRows comments={data} side={sideOf(side)} />;

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
