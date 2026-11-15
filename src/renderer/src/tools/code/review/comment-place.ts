// A comment on a line of Review's diff (UX wave U5b, M5; the execution document's §G, decisions 10 and 11): the line's
// text a comment quotes, the anchor Review makes for it, the place an unsent comment is drawn at, found again from its
// quote at every refresh, and where the card stands in the row under its line. Pure; no React and no diff library.
//
// A comment's place is `(commit, path, block, side, line)`: `block` is the edit's index in Last turn and 0 elsewhere;
// `commit` is null until U5b-2 (M9) shows a commit's diff and fills it.
import type { FileLineAnchor } from '@shared/anchor/anchor';
import { fileLineAnchor } from '../anchor/anchor';
import { REVIEW_COPY } from '../copy';
import type { ReviewFile } from './review-model';

export type LineSide = 'old' | 'new';

// A line of one block of a file's diff.
export interface LinePlace {
  block: number;
  side: LineSide;
  line: number;
}

// Where an unsent comment belongs, as M9 consumes it (it fills `commit`).
export interface CommentPlace extends LinePlace {
  commit: string | null;
  path: string; // the file's identity in the stack (`ReviewFile.path`): its section, where the comment is drawn
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Every line a block's hunks show on each side, with its text (the diff's prefix dropped): a removed line on the old side,
// an added one on the new, a context line on both.
export function diffLines(hunks: readonly string[]): { side: LineSide; line: number; text: string }[] {
  const out: { side: LineSide; line: number; text: string }[] = [];
  for (const hunk of hunks) {
    const lines = hunk.split('\n');
    const match = HUNK_HEADER.exec(lines[0] ?? '');
    if (!match) continue;
    let old = Number(match[1]);
    let neu = Number(match[2]);
    for (const raw of lines.slice(1)) {
      const prefix = raw[0];
      const text = raw.slice(1);
      if (prefix === '-') {
        out.push({ side: 'old', line: old, text });
        old += 1;
      } else if (prefix === '+') {
        out.push({ side: 'new', line: neu, text });
        neu += 1;
      } else if (prefix === ' ') {
        out.push({ side: 'old', line: old, text }, { side: 'new', line: neu, text });
        old += 1;
        neu += 1;
      }
    }
  }
  return out;
}

/** The text a line of a block shows on a side, without its diff prefix (the quote); null when the block has no such line. */
export function lineText(hunks: readonly string[], side: LineSide, line: number): string | null {
  return diffLines(hunks).find((each) => each.side === side && each.line === line)?.text ?? null;
}

/**
 * Where an unsent comment is drawn in a file's blocks (decision 11): on its side, the line whose text equals its quote,
 * the nearest to the line its anchor names, in the block it was made in when that is known (`block`); without a quote, the
 * line its anchor names. Null when no line of the diff holds it: the comment stays in its pass and its chip, under no line.
 */
export function placeOf(comment: { anchor: FileLineAnchor; quote?: string | null }, blocks: readonly (readonly string[])[], block?: number): LinePlace | null {
  const side: LineSide = comment.anchor.side ?? 'new';
  const quote = comment.quote ?? null;
  const want = comment.anchor.line;
  let best: LinePlace | null = null;
  let bestScore: [number, number] = [Infinity, Infinity];
  for (let index = 0; index < blocks.length; index++) {
    for (const each of diffLines(blocks[index])) {
      if (each.side !== side || (quote === null ? each.line !== want : each.text !== quote)) continue;
      const score: [number, number] = [block === undefined || block === index ? 0 : 1, Math.abs(each.line - want)];
      if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
        best = { block: index, side, line: each.line };
        bestScore = score;
      }
    }
  }
  return best;
}

/**
 * Whether a surface can place a comment, and where (Decision Log 21: a comment is always drawn at its place; one the
 * surface cannot place has the row under the toolbar for its place). The one predicate, by this table:
 *
 *   the scope            its file            its file's diff        the answer      drawn                         the sentence over it
 *   read, with files     held, read          a line has the quote   `placed`        under that line               none
 *   read, with files     held, read          no line has it         `line-left`     the row under the toolbar     `REVIEW_COPY.lineLeftDiff`
 *   read, with files     not held            -                      `not-in-scope`  the row under the toolbar     `REVIEW_COPY.fileNotInScope`
 *   empty or unreadable  -                   -                      `no-files`      the row under the toolbar     `REVIEW_COPY.fileNotInScope`
 *   still being read     -                   -                      `pending`       nowhere yet (not unplaceable) none
 *   read, with files     held, not read yet  -                      `pending`       nowhere yet (not unplaceable) none
 *
 * A held file's diff is the hunks the surface draws (a file under an open card holds still, decision 10).
 */
export type Placement =
  | { kind: 'placed'; path: string; place: LinePlace }
  | { kind: 'line-left'; path: string }
  | { kind: 'not-in-scope' }
  | { kind: 'no-files' }
  | { kind: 'pending'; path: string | null };
export type Unplaced = Extract<Placement, { kind: 'line-left' | 'not-in-scope' | 'no-files' }>['kind'];

// The surface's scope as the predicate reads it: `reading` while its list is not read yet, `none` while it cannot be read.
export interface ScopeLines {
  state: 'reading' | 'none' | 'ready';
  files: readonly { path: string; absolute: string; blocks: readonly (readonly string[])[]; read: boolean }[]; // `path`, the stack's identity
}

// The sentence over each kind of comment the surface cannot place (the table's last column).
export const UNPLACED_WORDS: Readonly<Record<Unplaced, string>> = { 'line-left': REVIEW_COPY.lineLeftDiff, 'not-in-scope': REVIEW_COPY.fileNotInScope, 'no-files': REVIEW_COPY.fileNotInScope };

export const isUnplaced = (placement: Placement): placement is Extract<Placement, { kind: Unplaced }> => placement.kind in UNPLACED_WORDS;

/** The table's answer for a comment in a scope; `block` is the block the comment was made in, when known (`placeOf`). */
export function placementOf(comment: { anchor: FileLineAnchor; quote?: string | null }, scope: ScopeLines, block?: number): Placement {
  if (scope.state === 'reading') return { kind: 'pending', path: null };
  if (scope.state === 'none' || scope.files.length === 0) return { kind: 'no-files' };
  const file = scope.files.find((each) => each.absolute === comment.anchor.path);
  if (!file) return { kind: 'not-in-scope' };
  if (!file.read) return { kind: 'pending', path: file.path };
  const place = placeOf(comment, file.blocks, block);
  return place ? { kind: 'placed', path: file.path, place } : { kind: 'line-left', path: file.path };
}

/**
 * The anchor of a comment on a line of Review's diff (§G): the file's absolute path and the line, with `side: 'old'` for a
 * line of the old side. Card 4 ("Removed line", the owner's answer at its recommended option, "No, the line says it") is
 * built here: the label is `<file>:<line>` for either side, with no "· before"; the comment's words say "Before the
 * change:" (`quotedComment`).
 */
export function reviewLineAnchor(path: string, line: number, side: LineSide): FileLineAnchor {
  const anchor = fileLineAnchor(path, line);
  return side === 'old' ? { ...anchor, side: 'old' } : anchor;
}

/** The absolute path a comment on a file of the stack names: a git scope's file joined to the repository's root. */
export function absolutePathOf(file: Pick<ReviewFile, 'path'>, repoRoot: string): string {
  return file.path.startsWith('/') ? file.path : `${repoRoot.replace(/\/+$/, '')}/${file.path}`;
}

/**
 * Where the card stands in the row under its line (D3; card 5, "The card's usual width", at its recommended option, with
 * `inlineCard`): from the code's left edge, past the line numbers' gutter, where the gutter and the card's width fit in
 * the row; from the row's left edge where they do not. In Split the row is the side's that holds the line, so the card
 * stands under that side. The offset in pixels from the row's left edge.
 */
export function cardOffset(row: number, gutter: number, card: number): number {
  return gutter > 0 && gutter + card <= row ? gutter : 0;
}
