// The composer seam (E5 execution document, Interfaces *The comment gutter and the anchor seam*; P1 spec §3 C and X10):
// what a comment is about, as E5 produces it, and the one call that opens the comment composer for it. The composer is
// E3's (the shared component and its destination control); E3 registers it here and E5 never re-implements it. Until
// then the editor's placeholder sheet shows the anchor. No CodeMirror here: the seam is in the main chunk.
import { sha256Hex } from '@shared/composer/sha256';
import type { Anchor, FileLineAnchor } from '@shared/anchor/anchor';
import type { AppSessionId } from '@shared/graph/ids';
import { showAnchor } from '../editor/EditorDialogs';

// X10's file-line anchor, as E5 produces it: since E3 a member of the shared union (`@shared/anchor/anchor`), which the
// composer seam takes whole so E6's, E4's and E2's producers call the same opener.
export type { FileLineAnchor } from '@shared/anchor/anchor';

export type CommentComposerOpener = (anchor: Anchor, context: { appSessionId: AppSessionId }) => void;

const basename = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

export const fileLineAnchor = (path: string, line: number): FileLineAnchor => ({ kind: 'file-line', locator: `${path}#L${line}`, label: `${basename(path)}:${line}`, path, line });

// X10's pr-line anchor, as E6 produces it (E6 execution document, Design §9): a line of a pull request's diff.
export interface PrLineAnchor {
  kind: 'pr-line';
  locator: string; // the line's own address on the PR's files page: `<pageUrl>#diff-<sha256 hex of path><L|R><line>`
  label: string; // `<path>:<line> · PR #<prNumber>`, fitted to X10's label rule (prLineLabel)
  pageUrl: string; // the PR's files page, `<prUrl>/files`
  path: string; // repository-relative, as the PR's diff names the file
  line: number; // 1-based, on `side`
  side: 'old' | 'new';
  prNumber: number;
}

// X10's label rule (E3's AnchorSchema): at most 200 characters, no control characters. Git allows both in a path, so
// the label shows a control character as U+FFFD and elides a long path from its start, keeping the basename, the line
// and the PR number; `path` and `locator` stay exact.
const LABEL_MAX = 200;
// eslint-disable-next-line no-control-regex -- the control characters are what is matched
const CONTROL = /[\x00-\x1f\x7f]/g;
const prLineLabel = (path: string, line: number, prNumber: number): string => {
  const shown = path.replace(CONTROL, '�');
  const suffix = `:${line} · PR #${prNumber}`;
  if (shown.length + suffix.length <= LABEL_MAX) return `${shown}${suffix}`;
  let tail = shown.slice(shown.length - (LABEL_MAX - 1 - suffix.length));
  if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1); // never half a surrogate pair
  return `…${tail}${suffix}`;
};

// GitHub addresses a diff line by the SHA-256 of the file's repository-relative path and the side's letter (L the old
// file, R the new one), the `id` its files page gives the line's cell; GitHub documents none of it.
export const prLineAnchor = (input: { prUrl: string; prNumber: number; path: string; line: number; side: 'old' | 'new' }): PrLineAnchor => {
  const { prUrl, prNumber, path, line, side } = input;
  const pageUrl = `${prUrl}/files`;
  return {
    kind: 'pr-line',
    locator: `${pageUrl}#diff-${sha256Hex(path)}${side === 'old' ? 'L' : 'R'}${line}`,
    label: prLineLabel(path, line, prNumber),
    pageUrl,
    path,
    line,
    side,
    prNumber,
  };
};

// Registrations, the latest last; each its own record, so a disposer removes its own even when one opener is
// registered twice.
const registrations: { open: CommentComposerOpener }[] = [];

// E3's composer; later registrations win, and the disposer restores the one before.
export function registerCommentComposer(open: CommentComposerOpener): () => void {
  const registration = { open };
  registrations.push(registration);
  return () => {
    const at = registrations.indexOf(registration);
    if (at !== -1) registrations.splice(at, 1);
  };
}

// The registered composer, else the placeholder sheet naming the anchor.
export function openCommentComposer(anchor: Anchor, context: { appSessionId: AppSessionId }): void {
  const registration = registrations.at(-1);
  if (registration) registration.open(anchor, context);
  else showAnchor(anchor, context.appSessionId);
}
