// Comments on lines in a Review surface (UX wave U5b, M5; the execution document's §B and §G, decisions 4, 10 and 11).
// One surface (the panel's Review, a diff tab) mounts the card's host once, for as long as it is, shown in its toolbar (or
// where the toolbar stands while there is none: `useCardSlot`), and draws the pass of its
// session (`passKey('review', session, session)`) in its diff: the card in the library's widget row under the line of
// the store's open card when that card is its own, every other comment of the pass as a row under its line (one line of
// its words, a click that edits it, Remove). A comment is placed again from its quote at every refresh (`placeOf`); one
// whose line left the diff stays in the pass and the chip and is drawn under no line; its card, opened, stands in a row
// under the toolbar (`LineLeftRow`, Decision Log 20). While the card is open on a file of this surface, that file holds
// still in its scope (`HeldFile`, the surface's).
//
// The context carries what the diff's rows need; with no provider (a surface that takes no comments) nothing is drawn.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FileLineAnchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { CARD_WIDTH } from '../../../side/card/placement';
import { discardComment, editComment, passKey, useCommentCard, type PassComment } from '../../../side/card/store';
import { SIDE_COPY } from '../../../side/copy';
import { openCommentComposer } from '../anchor/anchor';
import { REVIEW_COPY } from '../copy';
import { absolutePathOf, cardOffset, lineText, placeOf, reviewLineAnchor, type LinePlace, type LineSide } from './comment-place';
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
  rowsOf(path: string): readonly PlacedComment[]; // every other comment of the file, under its line
  add(path: string, block: number, side: LineSide, line: number): void; // the add button on a line
  setRow(element: HTMLElement | null): void; // the row the card is drawn in, handed to the host
}

export const LineCommentsContext = createContext<LineCommentsValue | null>(null);
export const useLineCommentsContext = () => useContext(LineCommentsContext);

// The block each comment was made in, by its id (the window's memory, as the pass is): a Last turn file's blocks number
// their lines each against its own version, so the same text near the same line can stand in two of them.
const madeIn = new Map<string, number>();

const isFileLine = (comment: PassComment): comment is PassComment & { anchor: FileLineAnchor } => comment.anchor.kind === 'file-line' && typeof comment.anchor.path === 'string';

/**
 * A surface's comments over its stack's sections: the open card's place when the card is this surface's (`card`), or
 * that its comment's line is in none of them (`away`: its file is not in the scope, or its loaded diff has no line with
 * the quote), the file it holds still (`holdPath`), every other comment placed under its line, and the opener the add
 * button calls. `repoRoot` null (the status not read yet): no comment is placed or made.
 */
export function useLineComments(input: { appSessionId: AppSessionId; hostId: string; repoRoot: string | null; sections: readonly StackSection[] }) {
  const { appSessionId, hostId, repoRoot, sections } = input;
  const key = passKey('review', appSessionId, appSessionId);
  const pass = useCommentCard((s) => s.passes.get(key) ?? null);
  const open = useCommentCard((s) => s.open);
  const ours = open !== null && open.hostId === hostId && open.phase.kind === 'composing' && open.phase.pass === key ? open.phase.comment : null;
  const serial = ours !== null ? open!.serial : null;

  const placed = useMemo(() => {
    const rows = new Map<string, PlacedComment[]>();
    let card: (LinePlace & { path: string; serial: number }) | null = null;
    let holdPath: string | null = null;
    let waiting = false; // our card's file is in the scope and its own read has not answered: its place is not known yet
    if (repoRoot === null || pass === null) return { rows, card, holdPath, away: false };
    const comments = pass.comments.filter(isFileLine); // M9: a commit's scope draws its commit's comments, every other scope those with none
    for (const section of sections) {
      const path = absolutePathOf(section.file, repoRoot);
      for (const comment of comments) {
        if (comment.anchor.path !== path) continue;
        const place = placeOf(comment, section.blocks, madeIn.get(comment.id));
        if (comment.id === ours) {
          holdPath = section.file.path;
          if (place !== null) card = { ...place, path: section.file.path, serial: serial! };
          else if (section.hunks === null) waiting = true;
          continue;
        }
        if (place === null) continue;
        const list = rows.get(section.file.path) ?? [];
        list.push({ ...place, comment });
        rows.set(section.file.path, list);
      }
    }
    return { rows, card, holdPath, away: ours !== null && card === null && !waiting };
  }, [repoRoot, pass, sections, ours, serial]);

  const add = useCallback(
    (path: string, block: number, side: LineSide, line: number) => {
      const section = sections.find((each) => each.file.path === path);
      if (!section || repoRoot === null) return;
      const quote = lineText(section.blocks[block] ?? [], side, line);
      openCommentComposer(reviewLineAnchor(absolutePathOf(section.file, repoRoot), line, side), { appSessionId, placement: { kind: 'card', host: 'review', hostId }, destination: 'main', ...(quote !== null && { quote }) });
      const opened = useCommentCard.getState().open;
      if (opened?.phase.kind === 'composing') madeIn.set(opened.phase.comment, block);
    },
    [sections, repoRoot, appSessionId, hostId],
  );

  return { key, card: placed.card, away: placed.away, holdPath: placed.holdPath, rows: placed.rows, add };
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

/** Whether this surface's host has a comment's card open (the composing phase: a comment of its pass). */
export const useComposingHere = (hostId: string): boolean => useCommentCard((s) => s.open !== null && s.open.hostId === hostId && s.open.phase.kind === 'composing');

/**
 * The row under the toolbar, above the stack, where the card of a comment whose line is not in this diff stands (§B,
 * Decision Log 20; D11): one line saying so (`REVIEW_COPY.lineLeftDiff`), and under it the element the card is drawn in.
 * The comment is read, edited, sent and removed there; it is never attached to another line.
 */
export function LineLeftRow({ onRow }: { onRow(element: HTMLElement | null): void }) {
  return (
    <div data-review-line-left="" className="flex shrink-0 flex-col gap-1.5 border-b border-border px-3 py-2">
      <p data-review-line-left-words="" className="m-0 text-ui-sm text-fg-muted">
        {REVIEW_COPY.lineLeftDiff}
      </p>
      <div ref={onRow} data-review-card-row="away" className="whitespace-normal" />
    </div>
  );
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
        </div>
      ))}
    </div>
  );
}
