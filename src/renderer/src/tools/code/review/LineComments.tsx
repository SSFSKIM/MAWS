// Comments on lines in a Review surface (UX wave U5b, M5; the execution document's §B and §G, decisions 4, 10 and 11).
// One surface (the panel's Review, a diff tab) mounts the card's host once, for as long as it is, shown in its toolbar (or
// where the toolbar stands while there is none: `useCardSlot`), and draws the pass of its
// session (`passKey('review', session, session)`) in its diff: the card in the library's widget row under the line of
// the store's open card when that card is its own, every other comment of the pass as a row under its line (one line of
// its words, a click that edits it, Remove). A comment is placed again from its quote at every refresh (`placeOf`); one
// the surface cannot place (`placementOf`'s table) is drawn in the row under the toolbar (`UnplacedComments`, Decision
// Log 21). While the card is open on a file of this surface, that file holds still in its scope (`HeldFile`, the
// surface's).
//
// The context carries what the diff's rows need; with no provider (a surface that takes no comments) nothing is drawn.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FileLineAnchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { CARD_WIDTH } from '../../../side/card/placement';
import { discardComment, editComment, passKey, useCommentCard, type PassComment } from '../../../side/card/store';
import { SIDE_COPY } from '../../../side/copy';
import { openCommentComposer } from '../anchor/anchor';
import { absolutePathOf, cardOffset, isUnplaced, lineText, placementOf, reviewLineAnchor, sectionStateOf, type LinePlace, type LineSide, type ScopeLines, type Unplaced } from './comment-place';
import { reviewLayout } from './measure';
import type { StackSection } from './Stack';

// An unsent comment and where it is drawn.
export interface PlacedComment extends LinePlace {
  comment: PassComment;
}

export interface LineCommentsValue {
  key: string; // the pass's key
  hostId: string;
  card: (LinePlace & { path: string; serial: number }) | null; // where this surface's open card stands (its widget row), and which card it is
  waiting: { path: string; serial: number } | null; // the open card's file while its place waits on the file's own read (the stack unfolds it)
  rowsOf(path: string): readonly PlacedComment[]; // every other comment of the file, under its line
  addable(path: string): boolean; // whether a comment on the file can be made: its add button is drawn only then
  add(path: string, block: number, side: LineSide, line: number): void; // the add button on a line
  setRow(element: HTMLElement | null): void; // the row the card is drawn in, handed to the host
}

export const LineCommentsContext = createContext<LineCommentsValue | null>(null);
export const useLineCommentsContext = () => useContext(LineCommentsContext);

// The block each comment was made in, by its id (the window's memory, as the pass is): a Last turn file's blocks number
// their lines each against its own version, so the same text near the same line can stand in two of them.
const madeIn = new Map<string, number>();

const isFileLine = (comment: PassComment): comment is PassComment & { anchor: FileLineAnchor } => comment.anchor.kind === 'file-line' && typeof comment.anchor.path === 'string';

// A comment the surface cannot place, with the kind that names the sentence over it (`UNPLACED_WORDS`).
export interface UnplacedComment {
  comment: PassComment;
  kind: Unplaced;
}

/**
 * A surface's comments over its scope (Decision Log 21: each drawn at its place, by `placementOf`): the open card's
 * line when the card is this surface's and its comment is placed (`card`), every other placed comment under its line
 * (`rows`), the comments it cannot place, oldest first, the open card's among them (`unplaced`; their place is the row
 * under the toolbar), the file the open card holds still (`holdPath`), and the opener the add button calls. `sections`
 * are the stack's while `state` is `ready`. A file's absolute identity needs no `repoRoot` (Last turn is listed before Git
 * answers, and outside Git); a relative one is placed and commented on only once the root is known.
 */
export function useLineComments(input: { appSessionId: AppSessionId; hostId: string; repoRoot: string | null; state: ScopeLines['state']; sections: readonly StackSection[] }) {
  const { appSessionId, hostId, repoRoot, state, sections } = input;
  const key = passKey('review', appSessionId, appSessionId);
  const pass = useCommentCard((s) => s.passes.get(key) ?? null);
  const open = useCommentCard((s) => s.open);
  const ours = open !== null && open.hostId === hostId && open.phase.kind === 'composing' && open.phase.pass === key ? open.phase.comment : null;
  const serial = ours !== null ? open!.serial : null;

  const placed = useMemo(() => {
    const rows = new Map<string, PlacedComment[]>();
    const unplaced: UnplacedComment[] = [];
    let card: (LinePlace & { path: string; serial: number }) | null = null;
    let holdPath: string | null = null;
    let waiting: { path: string; serial: number } | null = null;
    if (pass === null) return { rows, unplaced, card, holdPath, waiting };
    const lines: ScopeLines =
      state === 'ready' ? { state, files: sections.map((section) => ({ path: section.file.path, absolute: absolutePathOf(section.file, repoRoot), blocks: section.blocks, state: sectionStateOf(section) })) } : { state, files: [] };
    // M9: a commit's scope draws its commit's comments, every other scope those with none
    const comments = pass.comments.filter(isFileLine).sort((a, b) => Number(a.id) - Number(b.id));
    for (const comment of comments) {
      const at = placementOf(comment, lines, madeIn.get(comment.id));
      if (comment.id === ours && 'path' in at && at.path !== null) holdPath = at.path;
      if (comment.id === ours && at.kind === 'pending' && at.path !== null) waiting = { path: at.path, serial: serial! };
      if (at.kind === 'placed') {
        if (comment.id === ours) card = { ...at.place, path: at.path, serial: serial! };
        else rows.set(at.path, [...(rows.get(at.path) ?? []), { ...at.place, comment }]);
      } else if (isUnplaced(at)) unplaced.push({ comment, kind: at.kind });
    }
    return { rows, unplaced, card, holdPath, waiting };
  }, [repoRoot, state, pass, sections, ours, serial]);

  const addable = useCallback((path: string) => absolutePathOf({ path }, repoRoot) !== null, [repoRoot]);
  const add = useCallback(
    (path: string, block: number, side: LineSide, line: number) => {
      const section = sections.find((each) => each.file.path === path);
      const absolute = section ? absolutePathOf(section.file, repoRoot) : null;
      if (!section || absolute === null) return;
      const quote = lineText(section.blocks[block] ?? [], side, line);
      // A full pass adds nothing and opens the card on its newest comment, which keeps the block it was made in: only a
      // comment this add made takes the clicked block.
      const before = new Set(useCommentCard.getState().passes.get(key)?.comments.map((comment) => comment.id));
      openCommentComposer(reviewLineAnchor(absolute, line, side), { appSessionId, placement: { kind: 'card', host: 'review', hostId }, destination: 'main', ...(quote !== null && { quote }) });
      const opened = useCommentCard.getState().open;
      if (opened?.phase.kind === 'composing' && !before.has(opened.phase.comment)) madeIn.set(opened.phase.comment, block);
    },
    [sections, repoRoot, appSessionId, hostId, key],
  );

  return { key, card: placed.card, waiting: placed.waiting, unplaced: placed.unplaced, opened: ours, holdPath: placed.holdPath, rows: placed.rows, addable, add };
}

/**
 * The card host's own element (§B): the surface mounts its host once, into this element, for as long as the surface is;
 * `CardSlot` shows it where the host's chip and place line belong (the toolbar, or the line standing in the toolbar's
 * place while there is none). One element moved between them, so the host is never mounted again.
 */
export function useCardSlot(): HTMLElement {
  const [element] = useState(() => {
    const slot = document.createElement('div');
    slot.className = 'contents';
    return slot;
  });
  return element;
}

export function CardSlot({ element }: { element: HTMLElement }) {
  const place = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const parent = place.current!;
    parent.appendChild(element);
    return () => {
      if (element.parentNode === parent) parent.removeChild(element);
    };
  }, [element]);
  return <div ref={place} className="contents" />;
}

const NO_ROWS: readonly PlacedComment[] = [];
export const rowsIn = (rows: ReadonlyMap<string, readonly PlacedComment[]>, path: string): readonly PlacedComment[] => rows.get(path) ?? NO_ROWS;

/**
 * The row the library opens under a line, drawn by `renderWidgetLine` (§G): the element the card is drawn in, handed to the
 * host while it is the place of this surface's open card. The card stands from the code's left edge where the gutter
 * and its width fit, else from the row's (`cardOffset`, D3; card 5 with `inlineCard`). A widget the library opened
 * elsewhere (its own add button's, before the card it asked for is drawn) is closed again.
 */
export function CommentRow({ path, place, onClose }: { path: string; place: LinePlace; onClose(): void }) {
  const comments = useLineCommentsContext();
  const card = comments?.card ?? null;
  const mine = card !== null && card.path === path && card.block === place.block && card.side === place.side && card.line === place.line;
  const setRow = comments?.setRow;
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!mine) onClose();
  }, [mine, onClose]);
  useLayoutEffect(() => {
    if (!mine || !element || !setRow) return;
    setRow(element);
    return () => setRow(null);
  }, [mine, element, setRow]);
  const offset = useCodeEdge(element, place.side);

  if (!mine) return null;
  return <div ref={setElement} data-review-card-row={`${place.side}:${place.line}`} style={{ paddingLeft: offset }} className="py-1.5 pr-3 whitespace-normal" />;
}

// Where a row under a line starts (D3, the card's rule, which the unsent rows follow): past the line numbers' gutter of
// its side where the gutter and the card's width fit in the row, else at the row's left edge.
function useCodeEdge(element: HTMLElement | null, side: LineSide): number {
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const table = element.closest('table');
      const gutter = table?.querySelector(side === 'old' ? 'td.diff-line-old-num' : 'td.diff-line-new-num') ?? table?.querySelector('td.diff-line-num') ?? null;
      setOffset(cardOffset(reviewLayout.width(element), gutter ? reviewLayout.width(gutter) : 0, CARD_WIDTH));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, side]);
  return offset;
}

/**
 * The unsent comments under one line, drawn by `renderExtendLine` (§G; card 6, "Unsent row", the owner's answer at its
 * recommended option, is built here: one line each, its first words shortened). A click on the words edits that comment
 * in the card; Remove drops it; each target is at least 24 px tall (D6).
 */
export function UnsentRows({ comments, side }: { comments: readonly PassComment[]; side: LineSide }) {
  const context = useLineCommentsContext();
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const offset = useCodeEdge(element, side);
  if (!context) return null;
  const { key, hostId } = context;
  return (
    <div ref={setElement} data-review-unsent="" style={{ paddingLeft: offset }} className="flex flex-col gap-0.5 py-1 pr-3 whitespace-normal">
      {comments.map((comment) => (
        <div key={comment.id} data-review-unsent-comment={comment.id} style={{ maxWidth: CARD_WIDTH }} className="flex w-full min-w-0 items-center gap-1 rounded-sm border border-border bg-bg-raised text-ui-sm">
          <button type="button" data-review-unsent-edit="" title={comment.text.trim()} onClick={() => editComment(key, comment.id, hostId)} className="flex min-h-6 min-w-0 flex-1 items-center truncate rounded-sm px-2 text-left text-fg outline-accent hover:bg-bg-hover focus-visible:outline-2">
            <span className="min-w-0 truncate">{comment.text.trim()}</span>
          </button>
          <RemoveComment passKey={key} comment={comment} />
        </div>
      ))}
    </div>
  );
}

/** Remove on an unsent comment's row (card 6): drops it from its pass; a 24 px target (D6); off while it is in flight. */
export function RemoveComment({ passKey: key, comment }: { passKey: string; comment: PassComment }) {
  return (
    <button
      type="button"
      data-review-unsent-remove=""
      aria-label={SIDE_COPY.card.removeComment}
      title={SIDE_COPY.card.removeComment}
      disabled={comment.flight !== null}
      onClick={() => discardComment(key, comment.id)}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted outline-accent hover:bg-bg-hover hover:text-fg focus-visible:outline-2 disabled:text-fg-faint"
    >
      <svg viewBox="0 0 16 16" aria-hidden className="size-2.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
        <path d="m4 4 8 8M12 4l-8 8" />
      </svg>
    </button>
  );
}
