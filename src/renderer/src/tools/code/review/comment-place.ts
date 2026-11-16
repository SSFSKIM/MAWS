// A comment on a line of Review's diff (UX wave U5b, M5; the execution document's §G, decisions 10 and 11): the line's
// text a comment quotes, the anchor Review makes for it, the place an unsent comment is drawn at, found again from its
// quote at every refresh, and where the card stands in the row under its line. Pure; no React and no diff library.
//
// A comment's place is `(commit, path, block, side, line)`: `block` is the edit's index in Last turn and 0 elsewhere;
// `commit` is the commit whose diff it was made on (UX wave U5b-2, M9), read from the comment's own anchor: a commit's
// scope draws only its own commit's comments, every other scope only those with none (`ofScope`).
import type { FileLineAnchor } from '@shared/anchor/anchor';
import { commitLineAnchor, fileLineAnchor } from '../anchor/anchor';
import { REVIEW_COPY } from '../copy';
import { tooLarge, type ReviewFile } from './review-model';

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
 * surface cannot place has the row under the toolbar for its place). The one predicate, by this table, closed over every
 * state a scope and a file's section can be in (`SECTION_STATES`, from `sectionStateOf`):
 *
 *   the case          when                                                    the answer        the sentence over it
 *   on-commit         made on a commit the scope is not (first, whatever else) `on-commit`       `REVIEW_COPY.onCommit(sha)`
 *   scope-reading     the scope's list not read yet                           `pending`         none: nothing listed
 *   scope-empty       the scope read with no files, or not readable           `no-files`        `REVIEW_COPY.fileNotInScope`
 *   not-in-scope      the scope holds no section for the comment's file       `not-in-scope`    `REVIEW_COPY.fileNotInScope`
 *   reading           its section's own read running (asked, not answered)    `pending`         none: nothing listed
 *   folded-unread     folded in a scope past the cap, its read not asked      `pending`         none (the open card's reveal unfolds it)
 *   line-found        drawn, a line's text is the quote                       `placed`          none: under that line
 *   line-not-found    drawn, no line's text is the quote                      `line-left`       `REVIEW_COPY.lineLeftDiff`
 *   binary            binary: a completed read with no lines                  `line-left`       `REVIEW_COPY.lineLeftDiff`
 *   failed            its own read ended in failure                           `diff-not-shown`  `REVIEW_COPY.diffNotShown`
 *   too-large         too large to draw (its hunks known, no lines drawn)     `diff-not-shown`  `REVIEW_COPY.diffNotShown`
 *
 * A section's diff is the hunks the surface draws (a file under an open card holds still, decision 10). Each completed
 * state is told apart from pending: only a read still running, or one not asked yet, lists nothing.
 */
export type Placement =
  | { kind: 'placed'; path: string; place: LinePlace }
  | { kind: 'line-left'; path: string }
  | { kind: 'diff-not-shown'; path: string }
  | { kind: 'not-in-scope' }
  | { kind: 'no-files' }
  | { kind: 'on-commit'; commit: string } // UX wave U5b-2 (Decision Log 37): made on a commit other than the scope's
  | { kind: 'pending'; path: string | null };
export type Unplaced = Extract<Placement, { kind: 'line-left' | 'diff-not-shown' | 'not-in-scope' | 'no-files' | 'on-commit' }>['kind'];

// The states a file's section can be in, as the predicate reads them.
export const SECTION_STATES = ['reading', 'folded-unread', 'lines', 'binary', 'failed', 'too-large'] as const;
export type SectionState = (typeof SECTION_STATES)[number];

/** A section's state from what it holds (`StackSection`'s fields), in the order its body tells them. */
export function sectionStateOf(section: { hunks: readonly string[] | null; binary: boolean; failed: string | null; folded: boolean; fetch: boolean }): SectionState {
  if (section.hunks === null && section.failed !== null) return 'failed'; // its body says so first, a binary's as much as a text file's
  if (section.binary) return 'binary';
  if (section.hunks === null) return section.folded && !section.fetch ? 'folded-unread' : 'reading';
  return tooLarge({ hunks: section.hunks }) ? 'too-large' : 'lines';
}

export type PlacementCase = 'on-commit' | 'scope-reading' | 'scope-empty' | 'not-in-scope' | Exclude<SectionState, 'lines'> | 'line-found' | 'line-not-found';

// The table's answers, one per case (`lines` splits by the quote).
export const PLACEMENT_TABLE: Readonly<Record<PlacementCase, Placement['kind']>> = {
  'on-commit': 'on-commit',
  'scope-reading': 'pending',
  'scope-empty': 'no-files',
  'not-in-scope': 'not-in-scope',
  reading: 'pending',
  'folded-unread': 'pending',
  'line-found': 'placed',
  'line-not-found': 'line-left',
  binary: 'line-left',
  failed: 'diff-not-shown',
  'too-large': 'diff-not-shown',
};

// The surface's scope as the predicate reads it: `reading` while its list is not read yet, `none` while it cannot be read.
export interface ScopeLines {
  state: 'reading' | 'none' | 'ready';
  commit?: string | null; // UX wave U5b-2: the commit whose diff the scope is; absent or null, a scope of no commit
  // `path`, the stack's identity; `absolute`, the path a comment on the file names (`anchorPathOf`)
  files: readonly { path: string; absolute: string | null; blocks: readonly (readonly string[])[]; state: SectionState }[];
}

// The sentence over each kind of comment the surface cannot place (the table's last column). A commit's comment's sentence
// names its commit, so it is a function of the hash, and the row stands one per commit and file (`UnplacedComments`).
export const UNPLACED_WORDS: Readonly<Record<Exclude<Unplaced, 'on-commit'>, string> & { 'on-commit': (sha: string) => string }> = {
  'line-left': REVIEW_COPY.lineLeftDiff,
  'not-in-scope': REVIEW_COPY.fileNotInScope,
  'no-files': REVIEW_COPY.fileNotInScope,
  'diff-not-shown': REVIEW_COPY.diffNotShown,
  'on-commit': REVIEW_COPY.onCommit,
};

// The order the sentences stand in the row under the toolbar when more than one kind is present, each with its kinds; a
// commit's comments last (UX wave U5b-2), their sentence the commit's (`words` null).
export const UNPLACED_ORDER: readonly { name: string; words: string | null; kinds: readonly Unplaced[] }[] = [
  { name: 'line-left', words: UNPLACED_WORDS['line-left'], kinds: ['line-left'] },
  { name: 'not-in-diff', words: UNPLACED_WORDS['not-in-scope'], kinds: ['not-in-scope', 'no-files'] },
  { name: 'diff-not-shown', words: UNPLACED_WORDS['diff-not-shown'], kinds: ['diff-not-shown'] },
  { name: 'on-commit', words: null, kinds: ['on-commit'] },
];

export const isUnplaced = (placement: Placement): placement is Extract<Placement, { kind: Unplaced }> => placement.kind in UNPLACED_WORDS;

/** The table's answer for a comment in a scope; `block` is the block the comment was made in, when known (`placeOf`). */
export function placementOf(comment: { anchor: FileLineAnchor; quote?: string | null }, scope: ScopeLines, block?: number): Placement {
  const { commit } = comment.anchor;
  if (commit !== undefined && commit !== (scope.commit ?? null)) return { kind: 'on-commit', commit }; // first, whatever the scope holds
  if (scope.state === 'reading') return { kind: 'pending', path: null };
  if (scope.state === 'none' || scope.files.length === 0) return { kind: 'no-files' };
  const file = scope.files.find((each) => each.absolute === comment.anchor.path);
  if (!file) return { kind: 'not-in-scope' };
  const place = file.state === 'lines' ? placeOf(comment, file.blocks, block) : null;
  const answer = PLACEMENT_TABLE[file.state === 'lines' ? (place ? 'line-found' : 'line-not-found') : file.state];
  switch (answer) {
    case 'placed':
      return { kind: 'placed', path: file.path, place: place! };
    case 'line-left':
    case 'diff-not-shown':
    case 'pending':
      return { kind: answer, path: file.path };
    default:
      return { kind: 'not-in-scope' }; // not reached: a file's case answers one of the four above
  }
}

/**
 * The anchor of a comment on a line of Review's diff (§G): the file's absolute path and the line, with `side: 'old'` for a
 * line of the old side. Card 4 ("Removed line", the owner's answer at its recommended option, "No, the line says it") is
 * built here: the label is `<file>:<line>` for either side, with no "· before"; the comment's words say "Before the
 * change:" (`quotedComment`).
 */
export function reviewLineAnchor(path: string, line: number, side: LineSide, commit: string | null = null): FileLineAnchor {
  if (commit !== null) return commitLineAnchor(path, line, side, commit); // UX wave U5b-2 (§A): `path` the commit's, relative
  const anchor = fileLineAnchor(path, line);
  return side === 'old' ? { ...anchor, side: 'old' } : anchor;
}

/**
 * UX wave U5b-2: whether a surface draws a comment at all: a commit's scope takes no comment made on no commit (its lines are
 * the commit's); every other comment is drawn, by `placementOf` (a commit's comment in another scope under its own reason).
 */
export const ofScope = (anchor: Pick<FileLineAnchor, 'commit'>, commit: string | null): boolean => commit === null || anchor.commit !== undefined;

/**
 * The path a comment on a file of the stack names (§A): in a commit's scope the path as that commit's diff names it,
 * relative to the repository; elsewhere the absolute path (`absolutePathOf`).
 */
export function anchorPathOf(file: Pick<ReviewFile, 'path'>, repoRoot: string | null, commit: string | null): string | null {
  return commit !== null ? file.path : absolutePathOf(file, repoRoot);
}

/**
 * The absolute path a comment on a file of the stack names: an absolute identity as it is (Last turn's, which needs no
 * repository), a git scope's file joined to the repository's root; null for a relative one while the root is not known.
 */
export function absolutePathOf(file: Pick<ReviewFile, 'path'>, repoRoot: string | null): string | null {
  if (file.path.startsWith('/')) return file.path;
  return repoRoot === null ? null : `${repoRoot.replace(/\/+$/, '')}/${file.path}`;
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
